import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { auditLogs, guests, reservations } from "@/lib/db/schema";
import type { TenantContext } from "@/lib/permissions/authorize";
import { addDays, localDate } from "@/lib/timezones";
import { finishCleaning, inspectRoom, startCleaning } from "@/modules/housekeeping/service";
import { applyRetention } from "@/modules/privacy/retention";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { changeRoomStatus, createRoom } from "@/modules/rooms/rooms";
import {
  availability,
  checkInReservation,
  closeReservation,
  createReservation,
  listReservations,
  reservationCalendar,
  updateReservation,
  type ReservationInput,
} from "@/modules/reservations/service";
import { checkIn, checkOut } from "@/modules/stays/service";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

const today = () => localDate(new Date(), "Asia/Kolkata");
const d = (n: number) => addDays(today(), n);

describe("reservations and availability (Phase 9)", () => {
  let db: Db;
  let A: TenantFixture;
  let B: TenantFixture;
  let reception: TenantContext;
  let housekeeper: TenantContext;
  let floorId: string;
  let deluxe: string; // 2 rooms
  let suite: string; // 1 room
  const room: Record<string, string> = {};

  const book = (over: Partial<ReservationInput> = {}, ctx: TenantContext = reception) =>
    createReservation(db, ctx, A.propertyId, {
      categoryId: deluxe,
      guestName: "Meera Iyer",
      phone: "+91 98000 00000",
      arrivalDate: d(10),
      departureDate: d(12),
      adults: 2,
      ...over,
    }).then((r) => r.reservation);

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Booking Hotel" });
    B = await createTenantFixture(db, { hotelName: "Other Booking Hotel" });
    reception = await addStaff(db, A, "receptionist", null);
    housekeeper = await addStaff(db, A, "housekeeping", null);
    floorId = (await createFloor(db, A.ctx, A.propertyId, { name: "F1" })).id;
    deluxe = (await createCategory(db, A.ctx, A.propertyId, { name: "Deluxe", capacity: 2 })).id;
    suite = (await createCategory(db, A.ctx, A.propertyId, { name: "Suite", capacity: 4 })).id;
    for (const [code, cat] of [
      ["D1", deluxe],
      ["D2", deluxe],
      ["S1", suite],
    ] as const) {
      room[code] = (await createRoom(db, A.ctx, A.propertyId, { roomCode: code, floorId, categoryId: cat })).id;
    }
  });

  it("creates a booking with a short code and audits it without guest details", async () => {
    const r = await book();
    expect(r.code).toMatch(/^R[A-Z2-9]{6}$/);
    expect(r).toMatchObject({ status: "confirmed", arrivalDate: d(10), departureDate: d(12), roomId: null });
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, r.id));
    expect(audit[0].action).toBe("reservation.created");
    expect(JSON.stringify(audit)).not.toContain("Meera");
  });

  it("validates dates", async () => {
    await expect(book({ arrivalDate: d(-1), departureDate: d(1) })).rejects.toThrow(/past/);
    await expect(book({ arrivalDate: d(3), departureDate: d(3) })).rejects.toThrow(/after arrival/);
    await expect(book({ arrivalDate: d(1), departureDate: d(200) })).rejects.toThrow(/90 nights/);
  });

  it("never overbooks a room type, and frees capacity on cancel", async () => {
    // Suite has one room: one booking fits, a second overlapping one does not, a back-to-back one does.
    const first = await book({ categoryId: suite, arrivalDate: d(20), departureDate: d(23) });
    await expect(book({ categoryId: suite, arrivalDate: d(22), departureDate: d(24) })).rejects.toThrow(/No Suite rooms left on/);
    await book({ categoryId: suite, arrivalDate: d(23), departureDate: d(25) });
    const avail = await availability(db, reception, A.propertyId, d(20), d(25));
    const s = avail.categories.find((c) => c.name === "Suite")!;
    expect(s.nights.map((n) => n.available)).toEqual([0, 0, 0, 0, 0]);
    expect(s.bookable).toBe(false);
    await closeReservation(db, reception, A.propertyId, first.id, "cancelled", { reason: "Changed plans" });
    await book({ categoryId: suite, arrivalDate: d(21), departureDate: d(23) });
  });

  it("concurrent bookings for the last room: exactly one wins", async () => {
    const results = await Promise.allSettled([
      book({ categoryId: suite, arrivalDate: d(40), departureDate: d(41), guestName: "One" }),
      book({ categoryId: suite, arrivalDate: d(40), departureDate: d(41), guestName: "Two" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("never double-books an assigned room and checks the room's type", async () => {
    await book({ roomId: room.D1, arrivalDate: d(30), departureDate: d(33) });
    await expect(book({ roomId: room.D1, arrivalDate: d(32), departureDate: d(34) })).rejects.toThrow(/Room D1 is reserved/);
    await expect(book({ roomId: room.S1, arrivalDate: d(50), departureDate: d(51) })).rejects.toThrow(/not of the booked room type/);
    // D2 is still free for the same nights.
    await book({ roomId: room.D2, arrivalDate: d(32), departureDate: d(34) });
  });

  it("out-of-order rooms are not sold", async () => {
    const cat = (await createCategory(db, A.ctx, A.propertyId, { name: "Cabin", capacity: 2 })).id;
    const cabin = (await createRoom(db, A.ctx, A.propertyId, { roomCode: "C1", floorId, categoryId: cat })).id;
    await changeRoomStatus(db, A.ctx, A.propertyId, cabin, { dimension: "operational", status: "out_of_order" });
    await expect(book({ categoryId: cat, arrivalDate: d(5), departureDate: d(6) })).rejects.toThrow(/no sellable Cabin rooms/);
  });

  it("walk-ins respect bookings: no promised room, no sold-out type", async () => {
    const cat = (await createCategory(db, A.ctx, A.propertyId, { name: "Twin", capacity: 2 })).id;
    const t1 = (await createRoom(db, A.ctx, A.propertyId, { roomCode: "T1", floorId, categoryId: cat })).id;
    const t2 = (await createRoom(db, A.ctx, A.propertyId, { roomCode: "T2", floorId, categoryId: cat })).id;
    await book({ categoryId: cat, roomId: t1, arrivalDate: d(0), departureDate: d(2) });
    await expect(checkIn(db, reception, A.propertyId, { roomId: t1, guestName: "Walk In", checkoutDate: d(1) })).rejects.toThrow(
      /Room T1 is reserved/,
    );
    await book({ categoryId: cat, arrivalDate: d(1), departureDate: d(3) }); // unassigned, takes the last Twin on d(1)
    // T2 tonight only is fine; two nights would sell a room that isn't there.
    await expect(checkIn(db, reception, A.propertyId, { roomId: t2, guestName: "Walk In", checkoutDate: d(2) })).rejects.toThrow(
      /No Twin rooms left/,
    );
    await checkIn(db, reception, A.propertyId, { roomId: t2, guestName: "Walk In", checkoutDate: d(1) });
    // And the in-house walk-in now blocks new Twin bookings for tonight.
    await expect(book({ categoryId: cat, arrivalDate: d(0), departureDate: d(1) })).rejects.toThrow(/No Twin rooms left/);
  });

  it("checks a booking in to a ready room, links the stay, and completes on checkout", async () => {
    const cat = (await createCategory(db, A.ctx, A.propertyId, { name: "Family", capacity: 4 })).id;
    const f1 = (await createRoom(db, A.ctx, A.propertyId, { roomCode: "F1", floorId, categoryId: cat })).id;
    const future = await book({ categoryId: cat, arrivalDate: d(3), departureDate: d(4) });
    await expect(checkInReservation(db, reception, A.propertyId, future.id, { roomId: f1 })).rejects.toThrow(/arrives on/);

    const r = await book({ categoryId: cat, arrivalDate: d(0), departureDate: d(2), guestName: "Kabir Shah" });
    await expect(checkInReservation(db, reception, A.propertyId, r.id, {})).rejects.toThrow(/Choose a room/);
    await changeRoomStatus(db, A.ctx, A.propertyId, f1, { dimension: "housekeeping", status: "dirty" });
    await expect(checkInReservation(db, reception, A.propertyId, r.id, { roomId: f1 })).rejects.toThrow(/needs cleaning/);
    await startCleaning(db, housekeeper, A.propertyId, f1);
    await finishCleaning(db, housekeeper, A.propertyId, f1);
    await inspectRoom(db, A.ctx, A.propertyId, f1, { passed: true });

    const res = await checkInReservation(db, reception, A.propertyId, r.id, { roomId: f1 });
    expect(res.roomCode).toBe("F1");
    const [row] = await db.select().from(reservations).where(eq(reservations.id, r.id));
    expect(row).toMatchObject({ status: "checked_in", stayId: res.stay.id, roomId: f1 });
    expect(res.stay.guestId).toBe(row.guestId);
    expect(localDate(res.stay.expectedCheckoutAt, "Asia/Kolkata")).toBe(d(2));
    await expect(checkInReservation(db, reception, A.propertyId, r.id, { roomId: f1 })).rejects.toThrow(/already checked in/);
    await expect(closeReservation(db, reception, A.propertyId, r.id, "cancelled")).rejects.toThrow(/already checked in/);

    const list = await listReservations(db, reception, A.propertyId, { view: "in_house" });
    expect(list.reservations.map((x) => x.code)).toContain(r.code);

    await checkOut(db, reception, A.propertyId, res.stay.id);
    const [done] = await db.select().from(reservations).where(eq(reservations.id, r.id));
    expect(done.status).toBe("completed");
  });

  it("updates dates/room with the same rules, excluding itself", async () => {
    const r = await book({ roomId: room.D1, arrivalDate: d(60), departureDate: d(62) });
    const moved = await updateReservation(db, reception, A.propertyId, r.id, {
      categoryId: deluxe,
      roomId: room.D1,
      guestName: "Meera I.",
      arrivalDate: d(61),
      departureDate: d(63),
      adults: 1,
    });
    expect(moved).toMatchObject({ arrivalDate: d(61), departureDate: d(63), adults: 1 });
    const [g] = await db.select().from(guests).where(eq(guests.id, r.guestId));
    expect(g.name).toBe("Meera I.");
    await book({ roomId: room.D1, arrivalDate: d(63), departureDate: d(64) });
    await expect(
      updateReservation(db, reception, A.propertyId, r.id, {
        categoryId: deluxe,
        roomId: room.D1,
        guestName: "Meera I.",
        arrivalDate: d(61),
        departureDate: d(64),
        adults: 1,
      }),
    ).rejects.toThrow(/Room D1 is reserved/);
  });

  it("no-show only from the arrival date", async () => {
    const later = await book({ arrivalDate: d(70), departureDate: d(71) });
    await expect(closeReservation(db, reception, A.propertyId, later.id, "no_show")).rejects.toThrow(/arrival date/);
    const now = await book({ categoryId: suite, arrivalDate: d(0), departureDate: d(1) });
    const closed = await closeReservation(db, reception, A.propertyId, now.id, "no_show");
    expect(closed.status).toBe("no_show");
    expect((await closeReservation(db, reception, A.propertyId, now.id, "no_show")).status).toBe("no_show");
  });

  it("imports are idempotent on (source, external ref)", async () => {
    const one = await createReservation(db, reception, A.propertyId, {
      categoryId: deluxe,
      guestName: "OTA Guest",
      arrivalDate: d(80),
      departureDate: d(81),
      adults: 1,
      source: "ota",
      externalRef: "BKG-123",
    });
    const two = await createReservation(db, reception, A.propertyId, {
      categoryId: deluxe,
      guestName: "OTA Guest",
      arrivalDate: d(80),
      departureDate: d(81),
      adults: 1,
      source: "ota",
      externalRef: "BKG-123",
    });
    expect(one.duplicate).toBe(false);
    expect(two).toMatchObject({ duplicate: true, reservation: { id: one.reservation.id } });
  });

  it("calendar shows assigned bookings, in-house stays, free and unassigned counts", async () => {
    const cal = await reservationCalendar(db, reception, A.propertyId, d(30), 5);
    expect(cal.nights).toHaveLength(5);
    const dlx = cal.categories.find((c) => c.name === "Deluxe")!;
    const d1 = dlx.rooms.find((r) => r.roomCode === "D1")!;
    expect(d1.segments[0]).toMatchObject({ kind: "booking", from: d(30), to: d(33), label: "Meera Iyer" });
    expect(dlx.free[0]).toBe(1); // D1 booked, D2 free on d(30)
    expect(dlx.free[2]).toBe(0); // d(32): D1 and D2 both booked
    const today = await reservationCalendar(db, reception, A.propertyId, d(0), 3);
    const twin = today.categories.find((c) => c.name === "Twin")!;
    expect(twin.rooms.find((r) => r.roomCode === "T2")!.segments[0]).toMatchObject({ kind: "stay", label: "Walk In" });
    expect(twin.unassigned).toEqual([0, 1, 1]);
  });

  it("permissions and tenant isolation", async () => {
    await expect(book({}, housekeeper)).rejects.toMatchObject({ code: "forbidden" });
    await expect(listReservations(db, housekeeper, A.propertyId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(listReservations(db, B.ctx, A.propertyId)).rejects.toMatchObject({ code: "not_found" });
    const r = await book({ arrivalDate: d(90), departureDate: d(91) });
    await expect(closeReservation(db, B.ctx, B.propertyId, r.id, "cancelled")).rejects.toMatchObject({ code: "not_found" });
    // B's category id is not usable in A's property.
    const bCat = (await createCategory(db, B.ctx, B.propertyId, { name: "B Std", capacity: 2 })).id;
    await expect(book({ categoryId: bCat })).rejects.toMatchObject({ code: "not_found" });
  });

  it("retention anonymises guests of long-closed bookings only", async () => {
    const r = await book({ arrivalDate: d(1), departureDate: d(2), guestName: "Old Booker" });
    await closeReservation(db, reception, A.propertyId, r.id, "cancelled");
    const open = await book({ arrivalDate: d(100), departureDate: d(101), guestName: "Future Guest" });
    await applyRetention(db, new Date(Date.now() + 200 * 86400_000));
    const [old] = await db.select().from(guests).where(eq(guests.id, r.guestId));
    const [fut] = await db.select().from(guests).where(eq(guests.id, open.guestId));
    expect(old).toMatchObject({ name: "Former guest", phone: null });
    expect(fut.name).toBe("Future Guest");
  });
});
