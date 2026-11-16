import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { floors, guests, housekeepingTasks, rooms, stays } from "@/lib/db/schema";
import { conflict, notFound } from "@/lib/errors";
import { can, type TenantContext } from "@/lib/permissions/authorize";
import { localDate, zonedToUtc } from "@/lib/timezones";
import { nameSchema, optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { ensureTask } from "@/modules/housekeeping/service";
import { READINESS_LABEL, roomReadiness } from "@/modules/housekeeping/readiness";
import { lockRoom, setHousekeepingStatus } from "@/modules/housekeeping/room-lock";
import { requireProperty } from "@/modules/properties/access";
import { isUniqueViolation } from "@/modules/rooms/db-errors";
import { roomNaturalOrder } from "@/modules/rooms/rooms";

/**
 * Reception: check-in and check-out (CORE_WORKFLOWS.md §7–8). Not a reservation system.
 * - Check-in only into a READY room (in service, not occupied, cleaned and inspected per
 *   property policy). One active stay per room: row lock + partial unique index.
 * - Check-out closes the stay, sets housekeeping to dirty and creates exactly one cleaning
 *   task in the same transaction. It never marks the room ready.
 * Audit metadata never contains guest names or contact details.
 */

export const checkInSchema = z.object({
  roomId: z.uuid("Choose a room"),
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
  adults: z.coerce.number().int().min(1).max(20).default(1),
  checkoutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a checkout date"),
  checkoutTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM")
    .default("11:00"),
  notes: optionalText(500),
});
export type CheckInInput = z.input<typeof checkInSchema>;

export async function checkIn(db: Db, ctx: TenantContext, propertyId: string, raw: CheckInInput, now: Date = new Date()) {
  const property = await requireProperty(db, ctx, propertyId, "stay.check_in", { write: true });
  const input = checkInSchema.parse(raw);
  const expectedCheckoutAt = zonedToUtc(input.checkoutDate, input.checkoutTime, property.timezone);
  if (expectedCheckoutAt.getTime() <= now.getTime()) {
    throw new z.ZodError([{ code: "custom", path: ["checkoutDate"], message: "Checkout must be in the future", input: input.checkoutDate }]);
  }
  try {
    return await db.transaction(async (tx) => {
      const room = await lockRoom(tx, ctx, property.id, input.roomId);
      const readiness = roomReadiness(room);
      if (readiness !== "ready") {
        throw conflict(`Room ${room.roomCode} can't be allocated: ${READINESS_LABEL[readiness].toLowerCase()}.`);
      }
      const [guest] = await tx
        .insert(guests)
        .values({ tenantId: ctx.tenantId, name: input.guestName, phone: input.phone, email: input.email })
        .returning({ id: guests.id });
      const [stay] = await tx
        .insert(stays)
        .values({
          tenantId: ctx.tenantId,
          propertyId: property.id,
          roomId: room.id,
          guestId: guest.id,
          adults: input.adults,
          checkInAt: now,
          expectedCheckoutAt,
          notes: input.notes,
          checkedInByUserId: ctx.userId,
        })
        .returning();
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "stay.checked_in",
        entityType: "stay",
        entityId: stay.id,
        metadata: { propertyId: property.id, roomCode: room.roomCode },
      });
      return stay;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("This room was just allocated to someone else.");
    throw err;
  }
}

export async function checkOut(db: Db, ctx: TenantContext, propertyId: string, stayId: string, raw: { note?: string } = {}) {
  const property = await requireProperty(db, ctx, propertyId, "stay.check_out", { write: true });
  const note = optionalText(300).parse(raw.note);
  const id = z.uuid().safeParse(stayId);
  if (!id.success) throw notFound("Stay not found.");
  return db.transaction(async (tx) => {
    const [stay] = await tx
      .select()
      .from(stays)
      .where(and(eq(stays.id, id.data), eq(stays.tenantId, ctx.tenantId), eq(stays.propertyId, property.id)))
      .for("update");
    if (!stay) throw notFound("Stay not found.");
    // A double tap or a second receptionist: the first wins, the second gets a clear answer.
    if (stay.status !== "checked_in") throw conflict("This guest has already checked out.");
    const room = await lockRoom(tx, ctx, property.id, stay.roomId);
    const now = new Date();
    await tx
      .update(stays)
      .set({ status: "checked_out", checkedOutAt: now, checkedOutByUserId: ctx.userId, notes: note ?? stay.notes })
      .where(eq(stays.id, stay.id));
    await setHousekeepingStatus(tx, ctx, room, "dirty", "Guest checked out");
    const task = await ensureTask(tx, ctx, room, "cleaning", "checkout", { stayId: stay.id });
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "stay.checked_out",
      entityType: "stay",
      entityId: stay.id,
      metadata: { propertyId: property.id, roomCode: room.roomCode, cleaningTaskId: task.id },
    });
    return { stayId: stay.id, cleaningTaskId: task.id };
  });
}

/** In-house guests (front desk). Requires stay.view; includes guest contact for reception. */
export async function listInHouse(db: Db, ctx: TenantContext, propertyId: string, now: Date = new Date()) {
  const property = await requireProperty(db, ctx, propertyId, "stay.view");
  const rows = await db
    .select({
      stayId: stays.id,
      roomId: rooms.id,
      roomCode: rooms.roomCode,
      guestName: guests.name,
      phone: guests.phone,
      adults: stays.adults,
      checkInAt: stays.checkInAt,
      expectedCheckoutAt: stays.expectedCheckoutAt,
    })
    .from(stays)
    .innerJoin(rooms, eq(rooms.id, stays.roomId))
    .innerJoin(guests, and(eq(guests.id, stays.guestId), eq(guests.tenantId, stays.tenantId)))
    .where(and(eq(stays.tenantId, ctx.tenantId), eq(stays.propertyId, property.id), eq(stays.status, "checked_in")))
    .orderBy(asc(stays.expectedCheckoutAt));
  const today = localDate(now, property.timezone);
  return {
    property,
    stays: rows.map((r) => ({
      ...r,
      overdue: r.expectedCheckoutAt.getTime() < now.getTime(),
      departsToday: localDate(r.expectedCheckoutAt, property.timezone) === today,
    })),
  };
}

/** Rooms that can be allocated right now (ready per readiness rules). */
export async function listAvailableRooms(db: Db, ctx: TenantContext, propertyId: string) {
  const property = await requireProperty(db, ctx, propertyId, "stay.check_in");
  const pending = await db
    .select({ roomId: housekeepingTasks.roomId })
    .from(housekeepingTasks)
    .where(
      and(
        eq(housekeepingTasks.tenantId, ctx.tenantId),
        eq(housekeepingTasks.propertyId, property.id),
        eq(housekeepingTasks.taskType, "inspection"),
        inArray(housekeepingTasks.status, ["open", "in_progress"]),
      ),
    );
  const pendingIds = new Set(pending.map((p) => p.roomId));
  const rows = await db
    .select({
      id: rooms.id,
      roomCode: rooms.roomCode,
      floorName: floors.name,
      operationalStatus: rooms.operationalStatus,
      housekeepingStatus: rooms.housekeepingStatus,
      stayId: stays.id,
    })
    .from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId))
    .leftJoin(stays, and(eq(stays.roomId, rooms.id), eq(stays.status, "checked_in")))
    .where(and(eq(rooms.tenantId, ctx.tenantId), eq(rooms.propertyId, property.id), isNull(rooms.archivedAt)))
    .orderBy(asc(floors.sortOrder), ...roomNaturalOrder);
  return rows
    .filter((r) => roomReadiness({ ...r, occupied: Boolean(r.stayId), pendingInspection: pendingIds.has(r.id) }) === "ready")
    .map((r) => ({ id: r.id, roomCode: r.roomCode, floorName: r.floorName }));
}

/** Current stay of a room for the room page (stay.view only; otherwise just "occupied"). */
export async function currentStay(db: Db, ctx: TenantContext, propertyId: string, roomId: string) {
  const property = await requireProperty(db, ctx, propertyId, "room.view");
  const [row] = await db
    .select({ stayId: stays.id, guestName: guests.name, checkInAt: stays.checkInAt, expectedCheckoutAt: stays.expectedCheckoutAt })
    .from(stays)
    .innerJoin(guests, and(eq(guests.id, stays.guestId), eq(guests.tenantId, stays.tenantId)))
    .where(and(eq(stays.tenantId, ctx.tenantId), eq(stays.propertyId, property.id), eq(stays.roomId, roomId), eq(stays.status, "checked_in")));
  if (!row) return null;
  // Occupancy is visible to anyone who can see rooms; the guest name only to stay.view holders.
  return can(ctx, "stay.view", { propertyId: property.id }) ? row : { ...row, guestName: null };
}
