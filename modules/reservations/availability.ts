import { and, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { reservations, roomCategories, rooms, stays } from "@/lib/db/schema";
import type { ReservationStatus } from "@/lib/db/schema/enums";
import { conflict, notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";
import { addDays, eachNight, localDate } from "@/lib/timezones";

/**
 * Availability rules (Phase 9). All dates are the property's local calendar dates; a booking
 * occupies the nights [arrival, departure).
 * - Sellable rooms of a category: live rooms that are in service or under short maintenance
 *   (out_of_order / inactive rooms are not sold; ANALYTICS_REPORTING.md).
 * - Load on a night = occupying bookings (confirmed / checked_in) + walk-in stays (stays with
 *   no booking) in that category. Load may never exceed sellable rooms: no overbooking.
 * - An assigned room can hold only one occupying booking or stay per night.
 * Callers hold the category row lock (lockCategory) so concurrent bookings are serialised.
 */

export const OCCUPYING: ReservationStatus[] = ["confirmed", "checked_in"];
export const SELLABLE_STATUSES = ["active", "maintenance"] as const;

/** Locks a live category of the caller's property (SELECT … FOR UPDATE). */
export async function lockCategory(tx: Db, ctx: TenantContext, propertyId: string, categoryId: string) {
  const id = z.uuid().safeParse(categoryId);
  if (!id.success) throw notFound("Room type not found.");
  const [cat] = await tx
    .select({ id: roomCategories.id, name: roomCategories.name, capacity: roomCategories.capacity })
    .from(roomCategories)
    .where(
      and(
        eq(roomCategories.id, id.data),
        eq(roomCategories.propertyId, propertyId),
        eq(roomCategories.tenantId, ctx.tenantId),
        isNull(roomCategories.archivedAt),
      ),
    )
    .for("update");
  if (!cat) throw notFound("Room type not found.");
  return cat;
}

/** A stay occupies nights from its check-in date until its expected checkout date, and at least tonight while in house. */
export function stayNights(checkInAt: Date, expectedCheckoutAt: Date, today: string, timezone: string) {
  const from = localDate(checkInAt, timezone);
  const due = localDate(expectedCheckoutAt, timezone);
  const to = due > today ? due : addDays(today, 1);
  return { from: from < today ? from : today, to };
}

/** An in-house booking past its departure date (overstay) still occupies tonight. */
export const bookingEnd = (r: { status: ReservationStatus; departureDate: string }, today: string) =>
  r.status === "checked_in" && r.departureDate <= today ? addDays(today, 1) : r.departureDate;

export interface LoadOptions {
  excludeReservationId?: string;
}

/** Sellable rooms and per-night load of a category for [from, to). */
export async function categoryLoad(
  tx: Db,
  tenantId: string,
  propertyId: string,
  categoryId: string,
  from: string,
  to: string,
  today: string,
  timezone: string,
  opts: LoadOptions = {},
) {
  const [[{ sellable }], bookings, walkIns] = await Promise.all([
    tx
      .select({ sellable: sql<number>`count(*)::int` })
      .from(rooms)
      .where(
        and(
          eq(rooms.tenantId, tenantId),
          eq(rooms.propertyId, propertyId),
          eq(rooms.categoryId, categoryId),
          isNull(rooms.archivedAt),
          inArray(rooms.operationalStatus, [...SELLABLE_STATUSES]),
        ),
      ),
    tx
      .select({ id: reservations.id, arrivalDate: reservations.arrivalDate, departureDate: reservations.departureDate, status: reservations.status })
      .from(reservations)
      .where(
        and(
          eq(reservations.tenantId, tenantId),
          eq(reservations.propertyId, propertyId),
          eq(reservations.categoryId, categoryId),
          inArray(reservations.status, OCCUPYING),
          lt(reservations.arrivalDate, to),
          opts.excludeReservationId ? ne(reservations.id, opts.excludeReservationId) : undefined,
        ),
      ),
    walkInStays(tx, tenantId, propertyId, { categoryId }),
  ]);
  const load = new Map<string, number>();
  const add = (a: string, b: string) => {
    for (const night of eachNight(a > from ? a : from, b < to ? b : to)) load.set(night, (load.get(night) ?? 0) + 1);
  };
  for (const b of bookings) add(b.arrivalDate, bookingEnd(b, today));
  for (const s of walkIns) {
    const n = stayNights(s.checkInAt, s.expectedCheckoutAt, today, timezone);
    add(n.from, n.to);
  }
  return { sellable, load };
}

/** Checked-in stays that did not come from a booking (walk-ins), optionally for one category or room. */
export async function walkInStays(tx: Db, tenantId: string, propertyId: string, where: { categoryId?: string; roomId?: string }) {
  return tx
    .select({ stayId: stays.id, roomId: stays.roomId, checkInAt: stays.checkInAt, expectedCheckoutAt: stays.expectedCheckoutAt })
    .from(stays)
    .innerJoin(rooms, eq(rooms.id, stays.roomId))
    .leftJoin(reservations, eq(reservations.stayId, stays.id))
    .where(
      and(
        eq(stays.tenantId, tenantId),
        eq(stays.propertyId, propertyId),
        eq(stays.status, "checked_in"),
        isNull(reservations.id),
        where.categoryId ? eq(rooms.categoryId, where.categoryId) : undefined,
        where.roomId ? eq(stays.roomId, where.roomId) : undefined,
      ),
    );
}

/** Throws a clear conflict naming the first full night. */
export async function assertCapacity(
  tx: Db,
  ctx: TenantContext,
  propertyId: string,
  category: { id: string; name: string },
  from: string,
  to: string,
  today: string,
  timezone: string,
  opts: LoadOptions = {},
) {
  const { sellable, load } = await categoryLoad(tx, ctx.tenantId, propertyId, category.id, from, to, today, timezone, opts);
  for (const night of eachNight(from, to)) {
    if ((load.get(night) ?? 0) + 1 > sellable) {
      throw conflict(
        sellable === 0
          ? `There are no sellable ${category.name} rooms.`
          : `No ${category.name} rooms left on ${night}. Choose other dates or another room type.`,
      );
    }
  }
}

/** The room has no other occupying booking or in-house stay overlapping [from, to). */
export async function assertRoomFree(
  tx: Db,
  ctx: TenantContext,
  propertyId: string,
  room: { id: string; roomCode: string },
  from: string,
  to: string,
  today: string,
  timezone: string,
  opts: { excludeReservationId?: string; ignoreStays?: boolean } = {},
) {
  const clashes = await tx
    .select({ code: reservations.code, arrivalDate: reservations.arrivalDate, departureDate: reservations.departureDate, status: reservations.status })
    .from(reservations)
    .where(
      and(
        eq(reservations.tenantId, ctx.tenantId),
        eq(reservations.roomId, room.id),
        inArray(reservations.status, OCCUPYING),
        lt(reservations.arrivalDate, to),
        opts.excludeReservationId ? ne(reservations.id, opts.excludeReservationId) : undefined,
      ),
    );
  const clash = clashes.find((c) => bookingEnd(c, today) > from);
  if (clash) throw conflict(`Room ${room.roomCode} is reserved (${clash.code}) from ${clash.arrivalDate} to ${clash.departureDate}.`);
  if (opts.ignoreStays) return;
  const inHouse = await walkInStays(tx, ctx.tenantId, propertyId, { roomId: room.id });
  for (const s of inHouse) {
    const n = stayNights(s.checkInAt, s.expectedCheckoutAt, today, timezone);
    if (n.from < to && n.to > from) throw conflict(`Room ${room.roomCode} is occupied until ${n.to}.`);
  }
}

/** Reservation rows overlapping a window (calendar). */
export async function bookingsInWindow(tx: Db, tenantId: string, propertyId: string, from: string, to: string) {
  return tx
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        eq(reservations.propertyId, propertyId),
        inArray(reservations.status, OCCUPYING),
        lt(reservations.arrivalDate, to),
        gt(reservations.departureDate, addDays(from, -400)),
      ),
    );
}
