import { randomInt } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { floors, guestPortalSettings, guests, properties, reservations, roomCategories, rooms, stays } from "@/lib/db/schema";
import type { ReservationStatus } from "@/lib/db/schema/enums";
import { conflict, notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";
import { addDays, eachNight, localDate, zonedToUtc } from "@/lib/timezones";
import { nameSchema, optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { READINESS_LABEL, roomReadiness } from "@/modules/housekeeping/readiness";
import { lockRoom } from "@/modules/housekeeping/room-lock";
import { requireProperty } from "@/modules/properties/access";
import { isUniqueViolation } from "@/modules/rooms/db-errors";
import { roomNaturalOrder } from "@/modules/rooms/rooms";
import { insertStay, roomCategoryId } from "@/modules/stays/service";
import { enqueueWebhookEvent } from "@/modules/integrations/webhooks";
import {
  assertCapacity,
  assertRoomFree,
  bookingEnd,
  bookingsInWindow,
  categoryLoad,
  lockCategory,
  OCCUPYING,
  SELLABLE_STATUSES,
  stayNights,
  walkInStays,
} from "./availability";

/**
 * Reservations and the availability calendar (Phase 9, PRD "Later releases").
 * - Never overbooks a room type and never double-books an assigned room (availability.ts).
 * - Check-in from a booking goes through the same readiness rules as a walk-in (ready room
 *   only) and links the stay; check-out completes the booking.
 * - Guest details are tenant-private; audit metadata carries only the booking code.
 */

export const RESERVATION_SOURCES = ["direct", "phone", "email", "walk_in", "ota", "api"] as const;
export const MAX_NIGHTS = 90;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const reservationSchema = z
  .object({
    categoryId: z.uuid("Choose a room type"),
    roomId: z
      .union([z.literal(""), z.uuid()])
      .optional()
      .transform((v) => (v ? v : null)),
    guestName: nameSchema("Guest name"),
    phone: z
      .string()
      .trim()
      .regex(/^$|^\+?[0-9 ()-]{5,20}$/, "Use digits, spaces, + ( ) or -")
      .optional()
      .transform((v) => (v ? v : null)),
    email: z
      .union([z.literal(""), z.email("Enter a valid email").max(254)])
      .optional()
      .transform((v) => (v ? v.toLowerCase() : null)),
    arrivalDate: z.string().regex(DATE, "Choose an arrival date"),
    departureDate: z.string().regex(DATE, "Choose a departure date"),
    adults: z.coerce.number().int().min(1, "At least 1 guest").max(20),
    source: z.enum(RESERVATION_SOURCES).default("direct"),
    externalRef: optionalText(80),
    notes: optionalText(500),
  })
  .refine((v) => v.departureDate > v.arrivalDate, { path: ["departureDate"], message: "Departure must be after arrival" })
  .refine((v) => eachNight(v.arrivalDate, v.departureDate).length <= MAX_NIGHTS, {
    path: ["departureDate"],
    message: `At most ${MAX_NIGHTS} nights per booking`,
  });
export type ReservationInput = z.input<typeof reservationSchema>;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => "R" + Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

function dateError(field: string, message: string, input: string) {
  return new z.ZodError([{ code: "custom", path: [field], message, input }]);
}

async function propertyFor(db: Db, ctx: TenantContext, propertyId: string, permission: "reservation.view" | "reservation.manage") {
  return requireProperty(db, ctx, propertyId, permission, { write: permission === "reservation.manage" });
}

/** Room assigned to a booking must be live, of the booked type, and sellable. */
async function lockAssignedRoom(tx: Db, ctx: TenantContext, propertyId: string, roomId: string, categoryId: string) {
  const [room] = await tx
    .select({ id: rooms.id, roomCode: rooms.roomCode, categoryId: rooms.categoryId, operationalStatus: rooms.operationalStatus })
    .from(rooms)
    .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, propertyId), eq(rooms.tenantId, ctx.tenantId), isNull(rooms.archivedAt)))
    .for("update");
  if (!room) throw notFound("Room not found.");
  if (room.categoryId !== categoryId) throw conflict(`Room ${room.roomCode} is not of the booked room type.`);
  if (!(SELLABLE_STATUSES as readonly string[]).includes(room.operationalStatus)) {
    throw conflict(`Room ${room.roomCode} is out of service.`);
  }
  return room;
}

export interface ActorOptions {
  now?: Date;
  /** Audit actor: a staff user (default) or an integration API key. */
  actor?: { type: "user" } | { type: "api_key"; keyId: string };
}

function auditActor(ctx: TenantContext, opts: ActorOptions) {
  return opts.actor?.type === "api_key"
    ? { actorUserId: null, actorType: "api_key" as const, extra: { apiKeyId: opts.actor.keyId } }
    : { actorUserId: ctx.userId, actorType: "user" as const, extra: {} };
}

export async function createReservation(db: Db, ctx: TenantContext, propertyId: string, raw: ReservationInput, opts: ActorOptions = {}) {
  const property = await propertyFor(db, ctx, propertyId, "reservation.manage");
  const input = reservationSchema.parse(raw);
  const now = opts.now ?? new Date();
  const today = localDate(now, property.timezone);
  if (input.arrivalDate < today) throw dateError("arrivalDate", "Arrival can't be in the past", input.arrivalDate);
  if (input.arrivalDate > addDays(today, 730)) throw dateError("arrivalDate", "Bookings open up to 2 years ahead", input.arrivalDate);

  // Imports from another system are idempotent on (source, external reference).
  if (input.externalRef) {
    const existing = await findByExternalRef(db, ctx.tenantId, input.source, input.externalRef);
    if (existing) {
      if (existing.propertyId !== property.id) throw conflict("This external reference belongs to another property.");
      return { reservation: existing, duplicate: true };
    }
  }
  const actor = auditActor(ctx, opts);
  for (let attempt = 0; ; attempt++) {
    try {
      const reservation = await db.transaction(async (tx) => {
        const category = await lockCategory(tx, ctx, property.id, input.categoryId);
        let roomId: string | null = null;
        if (input.roomId) {
          const room = await lockAssignedRoom(tx, ctx, property.id, input.roomId, category.id);
          await assertRoomFree(tx, ctx, property.id, room, input.arrivalDate, input.departureDate, today, property.timezone);
          roomId = room.id;
        }
        await assertCapacity(tx, ctx, property.id, category, input.arrivalDate, input.departureDate, today, property.timezone);
        const [guest] = await tx
          .insert(guests)
          .values({ tenantId: ctx.tenantId, name: input.guestName, phone: input.phone, email: input.email })
          .returning({ id: guests.id });
        const [row] = await tx
          .insert(reservations)
          .values({
            tenantId: ctx.tenantId,
            propertyId: property.id,
            categoryId: category.id,
            roomId,
            guestId: guest.id,
            code: newCode(),
            arrivalDate: input.arrivalDate,
            departureDate: input.departureDate,
            adults: input.adults,
            source: input.source,
            externalRef: input.externalRef,
            notes: input.notes,
            createdByUserId: actor.actorUserId,
          })
          .returning();
        await writeAudit(tx, {
          tenantId: ctx.tenantId,
          actorUserId: actor.actorUserId,
          actorType: actor.actorType,
          action: "reservation.created",
          entityType: "reservation",
          entityId: row.id,
          metadata: { propertyId: property.id, code: row.code, nights: eachNight(row.arrivalDate, row.departureDate).length, ...actor.extra },
        });
        await enqueueWebhookEvent(tx, ctx.tenantId, "reservation.created", reservationEvent(row));
        return row;
      });
      return { reservation, duplicate: false };
    } catch (err) {
      if (isUniqueViolation(err)) {
        if (input.externalRef) {
          const winner = await findByExternalRef(db, ctx.tenantId, input.source, input.externalRef);
          if (winner) return { reservation: winner, duplicate: true };
        }
        if (attempt < 3) continue; // booking-code collision: try another code
      }
      throw err;
    }
  }
}

async function findByExternalRef(db: Db, tenantId: string, source: string, externalRef: string) {
  const [row] = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.tenantId, tenantId), eq(reservations.source, source), eq(reservations.externalRef, externalRef)));
  return row;
}

async function lockReservation(tx: Db, ctx: TenantContext, propertyId: string, reservationId: string) {
  const id = z.uuid().safeParse(reservationId);
  if (!id.success) throw notFound("Reservation not found.");
  const [row] = await tx
    .select()
    .from(reservations)
    .where(and(eq(reservations.id, id.data), eq(reservations.tenantId, ctx.tenantId), eq(reservations.propertyId, propertyId)))
    .for("update");
  if (!row) throw notFound("Reservation not found.");
  return row;
}

/** Change dates, room type, room, party size, guest contact or notes of a confirmed booking. */
export async function updateReservation(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  reservationId: string,
  raw: ReservationInput,
  opts: ActorOptions = {},
) {
  const property = await propertyFor(db, ctx, propertyId, "reservation.manage");
  const input = reservationSchema.parse(raw);
  const today = localDate(opts.now ?? new Date(), property.timezone);
  const actor = auditActor(ctx, opts);
  return db.transaction(async (tx) => {
    const current = await lockReservation(tx, ctx, property.id, reservationId);
    if (current.status !== "confirmed") throw conflict("Only confirmed bookings can be changed.");
    // A late arrival keeps its original date; any new arrival date must be today or later.
    if (input.arrivalDate !== current.arrivalDate && input.arrivalDate < today) {
      throw dateError("arrivalDate", "Arrival can't be in the past", input.arrivalDate);
    }
    if (input.departureDate <= today) throw dateError("departureDate", "Departure must be after today", input.departureDate);
    const category = await lockCategory(tx, ctx, property.id, input.categoryId);
    let roomId: string | null = null;
    const opt = { excludeReservationId: current.id };
    if (input.roomId) {
      const room = await lockAssignedRoom(tx, ctx, property.id, input.roomId, category.id);
      await assertRoomFree(tx, ctx, property.id, room, input.arrivalDate, input.departureDate, today, property.timezone, opt);
      roomId = room.id;
    }
    await assertCapacity(tx, ctx, property.id, category, input.arrivalDate, input.departureDate, today, property.timezone, opt);
    await tx
      .update(guests)
      .set({ name: input.guestName, phone: input.phone, email: input.email })
      .where(and(eq(guests.id, current.guestId), eq(guests.tenantId, ctx.tenantId)));
    const [row] = await tx
      .update(reservations)
      .set({
        categoryId: category.id,
        roomId,
        arrivalDate: input.arrivalDate,
        departureDate: input.departureDate,
        adults: input.adults,
        notes: input.notes,
      })
      .where(eq(reservations.id, current.id))
      .returning();
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: actor.actorUserId,
      actorType: actor.actorType,
      action: "reservation.updated",
      entityType: "reservation",
      entityId: row.id,
      metadata: { propertyId: property.id, code: row.code, ...actor.extra },
    });
    await enqueueWebhookEvent(tx, ctx.tenantId, "reservation.updated", reservationEvent(row));
    return row;
  });
}

const cancelSchema = z.object({ reason: optionalText(200) });

/** Cancel (any time before check-in) or mark a no-show (once the arrival date has come). */
export async function closeReservation(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  reservationId: string,
  to: Extract<ReservationStatus, "cancelled" | "no_show">,
  raw: { reason?: string } = {},
  opts: ActorOptions = {},
) {
  const property = await propertyFor(db, ctx, propertyId, "reservation.manage");
  const { reason } = cancelSchema.parse(raw);
  const now = opts.now ?? new Date();
  const actor = auditActor(ctx, opts);
  return db.transaction(async (tx) => {
    const current = await lockReservation(tx, ctx, property.id, reservationId);
    if (current.status !== "confirmed") {
      if (current.status === to) return current; // idempotent
      throw conflict(current.status === "checked_in" ? "The guest has already checked in." : "This booking is already closed.");
    }
    if (to === "no_show" && current.arrivalDate > localDate(now, property.timezone)) {
      throw conflict("A booking can be marked as no-show only from its arrival date.");
    }
    const [row] = await tx
      .update(reservations)
      .set({ status: to, cancelledAt: now, cancelReason: reason })
      .where(eq(reservations.id, current.id))
      .returning();
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: actor.actorUserId,
      actorType: actor.actorType,
      action: to === "cancelled" ? "reservation.cancelled" : "reservation.no_show",
      entityType: "reservation",
      entityId: row.id,
      metadata: { propertyId: property.id, code: row.code, ...actor.extra },
    });
    await enqueueWebhookEvent(tx, ctx.tenantId, to === "cancelled" ? "reservation.cancelled" : "reservation.no_show", reservationEvent(row));
    return row;
  });
}

/** Thin webhook payload: no guest details. */
export function reservationEvent(r: typeof reservations.$inferSelect) {
  return {
    reservationId: r.id,
    code: r.code,
    propertyId: r.propertyId,
    categoryId: r.categoryId,
    roomId: r.roomId,
    arrivalDate: r.arrivalDate,
    departureDate: r.departureDate,
    adults: r.adults,
    status: r.status,
    source: r.source,
    externalRef: r.externalRef,
  };
}

/**
 * Check in a booking: the chosen room must be READY (same rules as a walk-in). Moving to a
 * different room type re-checks that type's availability for the remaining nights.
 */
export async function checkInReservation(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  reservationId: string,
  raw: { roomId?: string },
  now: Date = new Date(),
) {
  const property = await requireProperty(db, ctx, propertyId, "stay.check_in", { write: true });
  const today = localDate(now, property.timezone);
  try {
    return await db.transaction(async (tx) => {
      const res = await lockReservation(tx, ctx, property.id, reservationId);
      if (res.status === "checked_in") throw conflict("This guest has already checked in.");
      if (res.status !== "confirmed") throw conflict("This booking is closed.");
      if (res.arrivalDate > today) throw conflict(`This booking arrives on ${res.arrivalDate}. Change the arrival date to check in early.`);
      if (res.departureDate <= today) throw conflict("The departure date has passed. Change the dates first.");
      const roomId = raw.roomId || res.roomId;
      if (!roomId) throw new z.ZodError([{ code: "custom", path: ["roomId"], message: "Choose a room", input: "" }]);
      const category = await lockCategory(tx, ctx, property.id, await roomCategoryId(tx, ctx, property.id, roomId));
      const room = await lockRoom(tx, ctx, property.id, roomId);
      const readiness = roomReadiness(room);
      if (readiness !== "ready") throw conflict(`Room ${room.roomCode} can't be allocated: ${READINESS_LABEL[readiness].toLowerCase()}.`);
      const opt = { excludeReservationId: res.id };
      if (category.id !== res.categoryId) {
        await assertCapacity(tx, ctx, property.id, category, today, res.departureDate, today, property.timezone, opt);
      }
      await assertRoomFree(tx, ctx, property.id, room, today, res.departureDate, today, property.timezone, { ...opt, ignoreStays: true });
      const [settings] = await tx
        .select({ checkOutTime: guestPortalSettings.checkOutTime })
        .from(guestPortalSettings)
        .where(and(eq(guestPortalSettings.propertyId, property.id), eq(guestPortalSettings.tenantId, ctx.tenantId)));
      const expectedCheckoutAt = zonedToUtc(res.departureDate, settings?.checkOutTime ?? "11:00", property.timezone);
      const stay = await insertStay(tx, ctx, property.id, room, {
        guestId: res.guestId,
        adults: res.adults,
        expectedCheckoutAt,
        notes: res.notes,
        now,
        reservationCode: res.code,
      });
      await tx
        .update(reservations)
        .set({ status: "checked_in", stayId: stay.id, roomId: room.id, categoryId: category.id })
        .where(eq(reservations.id, res.id));
      return { stay, code: res.code, roomCode: room.roomCode };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("This room was just allocated to someone else.");
    throw err;
  }
}

// ---------------------------------------------------------------- reads

export type ReservationView = "upcoming" | "arrivals" | "in_house" | "closed";

export async function listReservations(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  opts: { view?: ReservationView; q?: string; now?: Date; limit?: number } = {},
) {
  const property = await propertyFor(db, ctx, propertyId, "reservation.view");
  const today = localDate(opts.now ?? new Date(), property.timezone);
  const view = opts.view ?? "upcoming";
  const q = opts.q?.trim().slice(0, 60);
  const where = and(
    eq(reservations.tenantId, ctx.tenantId),
    eq(reservations.propertyId, property.id),
    view === "upcoming" ? and(eq(reservations.status, "confirmed"), gte(reservations.departureDate, today)) : undefined,
    view === "arrivals" ? and(eq(reservations.status, "confirmed"), lte(reservations.arrivalDate, today)) : undefined,
    view === "in_house" ? eq(reservations.status, "checked_in") : undefined,
    view === "closed" ? inArray(reservations.status, ["completed", "cancelled", "no_show"]) : undefined,
    q ? or(ilike(reservations.code, `%${q}%`), ilike(guests.name, `%${q}%`), ilike(guests.phone, `%${q}%`)) : undefined,
  );
  const rows = await db
    .select({
      id: reservations.id,
      code: reservations.code,
      status: reservations.status,
      arrivalDate: reservations.arrivalDate,
      departureDate: reservations.departureDate,
      adults: reservations.adults,
      source: reservations.source,
      externalRef: reservations.externalRef,
      notes: reservations.notes,
      guestName: guests.name,
      phone: guests.phone,
      email: guests.email,
      categoryId: reservations.categoryId,
      categoryName: roomCategories.name,
      roomId: reservations.roomId,
      roomCode: rooms.roomCode,
    })
    .from(reservations)
    .innerJoin(guests, and(eq(guests.id, reservations.guestId), eq(guests.tenantId, reservations.tenantId)))
    .innerJoin(roomCategories, eq(roomCategories.id, reservations.categoryId))
    .leftJoin(rooms, eq(rooms.id, reservations.roomId))
    .where(where)
    .orderBy(view === "closed" ? desc(reservations.updatedAt) : asc(reservations.arrivalDate), asc(reservations.code))
    .limit(Math.min(opts.limit ?? 200, 500));
  return {
    property,
    today,
    reservations: rows.map((r) => ({
      ...r,
      nights: eachNight(r.arrivalDate, r.departureDate).length,
      late: r.status === "confirmed" && r.arrivalDate < today,
    })),
  };
}

export async function getReservation(db: Db, ctx: TenantContext, propertyId: string, reservationId: string) {
  const property = await propertyFor(db, ctx, propertyId, "reservation.view");
  const id = z.uuid().safeParse(reservationId);
  if (!id.success) throw notFound("Reservation not found.");
  const [row] = await db
    .select({ r: reservations, guestName: guests.name, phone: guests.phone, email: guests.email, roomCode: rooms.roomCode, categoryName: roomCategories.name })
    .from(reservations)
    .innerJoin(guests, and(eq(guests.id, reservations.guestId), eq(guests.tenantId, reservations.tenantId)))
    .innerJoin(roomCategories, eq(roomCategories.id, reservations.categoryId))
    .leftJoin(rooms, eq(rooms.id, reservations.roomId))
    .where(and(eq(reservations.id, id.data), eq(reservations.tenantId, ctx.tenantId), eq(reservations.propertyId, property.id)));
  if (!row) throw notFound("Reservation not found.");
  return { property, ...row };
}

/** Room types with sellable counts and live rooms (forms). */
export async function bookingOptions(db: Db, ctx: TenantContext, propertyId: string) {
  const property = await propertyFor(db, ctx, propertyId, "reservation.view");
  const [cats, roomRows] = await Promise.all([
    db
      .select({ id: roomCategories.id, name: roomCategories.name, capacity: roomCategories.capacity })
      .from(roomCategories)
      .where(and(eq(roomCategories.tenantId, ctx.tenantId), eq(roomCategories.propertyId, property.id), isNull(roomCategories.archivedAt)))
      .orderBy(asc(roomCategories.name)),
    db
      .select({ id: rooms.id, roomCode: rooms.roomCode, categoryId: rooms.categoryId })
      .from(rooms)
      .innerJoin(floors, eq(floors.id, rooms.floorId))
      .where(
        and(
          eq(rooms.tenantId, ctx.tenantId),
          eq(rooms.propertyId, property.id),
          isNull(rooms.archivedAt),
          inArray(rooms.operationalStatus, [...SELLABLE_STATUSES]),
        ),
      )
      .orderBy(asc(floors.sortOrder), ...roomNaturalOrder),
  ]);
  return { property, categories: cats, rooms: roomRows };
}

/** Free rooms of each type per night for a date range (quote before booking / API). */
export async function availability(db: Db, ctx: TenantContext, propertyId: string, from: string, to: string, now: Date = new Date()) {
  const property = await propertyFor(db, ctx, propertyId, "reservation.view");
  if (!DATE.test(from) || !DATE.test(to) || to <= from || eachNight(from, to).length > 62) {
    throw dateError("to", "Choose a range of 1 to 62 nights", to);
  }
  const today = localDate(now, property.timezone);
  const { categories } = await bookingOptions(db, ctx, property.id);
  const out = [];
  for (const c of categories) {
    const { sellable, load } = await categoryLoad(db, ctx.tenantId, property.id, c.id, from, to, today, property.timezone);
    const nights = eachNight(from, to).map((date) => ({ date, available: Math.max(0, sellable - (load.get(date) ?? 0)) }));
    out.push({ categoryId: c.id, name: c.name, sellable, nights, bookable: nights.every((n) => n.available > 0) });
  }
  return { property, from, to, categories: out };
}

export interface CalendarSegment {
  kind: "booking" | "stay";
  id: string;
  label: string;
  code: string | null;
  status: ReservationStatus | "in_house";
  from: string;
  to: string;
}

/**
 * Room × night grid for `days` nights from `start`: assigned bookings and in-house stays per
 * room, plus per-type free and unassigned counts per night.
 */
export async function reservationCalendar(db: Db, ctx: TenantContext, propertyId: string, start: string, days = 14, now: Date = new Date()) {
  const property = await propertyFor(db, ctx, propertyId, "reservation.view");
  const today = localDate(now, property.timezone);
  const from = DATE.test(start) ? start : today;
  const span = Math.min(Math.max(days, 1), 31);
  const to = addDays(from, span);
  const nights = eachNight(from, to);
  const [{ categories, rooms: roomRows }, bookings, walkIns, guestRows] = await Promise.all([
    bookingOptions(db, ctx, property.id),
    bookingsInWindow(db, ctx.tenantId, property.id, from, to),
    walkInStays(db, ctx.tenantId, property.id, {}),
    db
      .select({ stayId: stays.id, guestName: guests.name })
      .from(stays)
      .innerJoin(guests, and(eq(guests.id, stays.guestId), eq(guests.tenantId, stays.tenantId)))
      .where(and(eq(stays.tenantId, ctx.tenantId), eq(stays.propertyId, property.id), eq(stays.status, "checked_in"))),
  ]);
  const bookingGuests = bookings.length
    ? await db
        .select({ id: guests.id, name: guests.name })
        .from(guests)
        .where(and(eq(guests.tenantId, ctx.tenantId), inArray(guests.id, [...new Set(bookings.map((b) => b.guestId))])))
    : [];
  const guestName = new Map(bookingGuests.map((g) => [g.id, g.name]));
  const stayGuest = new Map(guestRows.map((g) => [g.stayId, g.guestName]));
  const clip = (a: string, b: string) => ({ from: a > from ? a : from, to: b < to ? b : to });

  const segmentsByRoom = new Map<string, CalendarSegment[]>();
  const push = (roomId: string, seg: CalendarSegment) => {
    if (seg.from >= seg.to) return;
    segmentsByRoom.set(roomId, [...(segmentsByRoom.get(roomId) ?? []), seg]);
  };
  const unassigned = new Map<string, Map<string, number>>();
  const booked = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, cat: string, a: string, b: string) => {
    const inner = m.get(cat) ?? new Map<string, number>();
    for (const n of eachNight(a > from ? a : from, b < to ? b : to)) inner.set(n, (inner.get(n) ?? 0) + 1);
    m.set(cat, inner);
  };
  for (const b of bookings) {
    const end = bookingEnd(b, today);
    if (end <= from) continue;
    bump(booked, b.categoryId, b.arrivalDate, end);
    if (b.roomId) {
      push(b.roomId, { kind: "booking", id: b.id, label: guestName.get(b.guestId) ?? "Guest", code: b.code, status: b.status, ...clip(b.arrivalDate, end) });
    } else {
      bump(unassigned, b.categoryId, b.arrivalDate, end);
    }
  }
  const roomCategory = new Map(roomRows.map((r) => [r.id, r.categoryId]));
  for (const s of walkIns) {
    const n = stayNights(s.checkInAt, s.expectedCheckoutAt, today, property.timezone);
    const cat = roomCategory.get(s.roomId);
    if (cat) bump(booked, cat, n.from, n.to);
    push(s.roomId, { kind: "stay", id: s.stayId, label: stayGuest.get(s.stayId) ?? "Guest", code: null, status: "in_house", ...clip(n.from, n.to) });
  }
  return {
    property,
    today,
    from,
    to,
    nights,
    categories: categories.map((c) => {
      const catRooms = roomRows.filter((r) => r.categoryId === c.id);
      return {
        ...c,
        rooms: catRooms.map((r) => ({ id: r.id, roomCode: r.roomCode, segments: segmentsByRoom.get(r.id) ?? [] })),
        free: nights.map((n) => catRooms.length - (booked.get(c.id)?.get(n) ?? 0)),
        unassigned: nights.map((n) => unassigned.get(c.id)?.get(n) ?? 0),
      };
    }),
  };
}

export { OCCUPYING };

/**
 * Night audit (daily cron): a confirmed booking whose arrival day has fully passed in the
 * property's timezone, without check-in, becomes a no-show. This frees its room-type capacity
 * automatically. Idempotent; audited as "system".
 */
export async function sweepNoShows(db: Db, now: Date = new Date(), limit = 500) {
  const due = await db
    .select({ id: reservations.id, tenantId: reservations.tenantId })
    .from(reservations)
    .innerJoin(properties, and(eq(properties.id, reservations.propertyId), eq(properties.tenantId, reservations.tenantId)))
    .where(
      and(
        eq(reservations.status, "confirmed"),
        sql`${reservations.arrivalDate} < (${now.toISOString()}::timestamptz at time zone ${properties.timezone})::date`,
      ),
    )
    .limit(limit);
  let changed = 0;
  for (const r of due) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(reservations)
        .set({ status: "no_show", cancelledAt: now, cancelReason: "Automatic: not checked in by the end of the arrival day" })
        .where(and(eq(reservations.id, r.id), eq(reservations.status, "confirmed")))
        .returning();
      if (!row) return;
      changed++;
      await writeAudit(tx, {
        tenantId: row.tenantId,
        actorUserId: null,
        actorType: "system",
        action: "reservation.no_show",
        entityType: "reservation",
        entityId: row.id,
        metadata: { propertyId: row.propertyId, code: row.code, automatic: true },
      });
      await enqueueWebhookEvent(tx, row.tenantId, "reservation.no_show", reservationEvent(row));
    });
  }
  return changed;
}
