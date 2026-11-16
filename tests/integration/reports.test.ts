import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { guests, plans, serviceRequests, stays, subscriptions } from "@/lib/db/schema";
import { getRoomQr } from "@/modules/qr/service";
import { dashboardMetrics, propertyReport, resolveRange } from "@/modules/reports/service";
import { submitGuestRequest } from "@/modules/requests/guest";
import { transitionRequest } from "@/modules/requests/staff";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { bulkCreateRooms, changeRoomStatus, listRooms } from "@/modules/rooms/rooms";
import { createDefaultServices, listServices } from "@/modules/services/catalog";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

// Property timezone Asia/Kolkata (UTC+5:30). Local midnight 2026-11-11 = 2026-11-10T18:30Z.
const NOW = new Date("2026-11-14T06:30:00Z"); // 12:00 local on the 14th
const at = (iso: string) => new Date(iso);

describe("reports and dashboard metrics", () => {
  let db: Db;
  let A: TenantFixture;
  let roomIds: string[];

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Report Hotel" });
    const f = await createFloor(db, A.ctx, A.propertyId, { name: "F1" });
    const c = await createCategory(db, A.ctx, A.propertyId, { name: "Std", capacity: 2 });
    await bulkCreateRooms(db, A.ctx, A.propertyId, { floorId: f.id, categoryId: c.id, start: 101, end: 104 });
    roomIds = (await listRooms(db, A.ctx, A.propertyId)).items.map((r) => r.id);
    // 104 out of order: not sellable.
    await changeRoomStatus(db, A.ctx, A.propertyId, roomIds[3], { dimension: "operational", status: "out_of_order" });

    const [g] = await db.insert(guests).values({ tenantId: A.tenantId, name: "G" }).returning();
    const stay = (roomId: string, inAt: string, outAt: string | null) =>
      db.insert(stays).values({
        tenantId: A.tenantId,
        propertyId: A.propertyId,
        roomId,
        guestId: g.id,
        status: outAt ? "checked_out" : "checked_in",
        checkInAt: at(inAt),
        expectedCheckoutAt: at("2026-11-20T05:30:00Z"),
        checkedOutAt: outAt ? at(outAt) : null,
      });
    // 101: in 11th 14:00 local, out 13th 11:00 local → nights of the 11th and 12th.
    await stay(roomIds[0], "2026-11-11T08:30:00Z", "2026-11-13T05:30:00Z");
    // 102: in 12th 15:00 local, still in house → nights of the 12th and 13th.
    await stay(roomIds[1], "2026-11-12T09:30:00Z", null);

    // Requests: ack after 4 and 20 minutes; one completed after 30 minutes; one cancelled.
    await createDefaultServices(db, A.ctx, A.propertyId);
    const svc = Object.fromEntries((await listServices(db, A.ctx, A.propertyId)).items.map((i) => [i.key, i]));
    const qr = (await getRoomQr(db, A.ctx, A.propertyId, roomIds[0])).active!.url.split("/r/")[1]!;
    const make = async (key: string, submitted: string, extra: Record<string, string> = {}) => {
      const r = await submitGuestRequest(db, qr, { serviceId: svc[key].id, idempotencyKey: crypto.randomUUID(), ...extra }, { ip: null, now: at(submitted) });
      if (r.kind !== "ok") throw new Error(JSON.stringify(r));
      return r.requestId;
    };
    const w1 = await make("water", "2026-11-12T04:00:00Z", { quantity: "1" });
    const w2 = await make("water", "2026-11-13T04:00:00Z", { quantity: "2" });
    const h1 = await make("housekeeping", "2026-11-13T05:00:00Z", { option: "Extra towels" });
    for (const id of [w1, w2, h1]) await transitionRequest(db, A.ctx, id, "acknowledge");
    await transitionRequest(db, A.ctx, w1, "start");
    await transitionRequest(db, A.ctx, w1, "complete");
    await transitionRequest(db, A.ctx, h1, "cancel", { note: "guest left" });
    const set = (id: string, v: Partial<typeof serviceRequests.$inferInsert>) => db.update(serviceRequests).set(v).where(eq(serviceRequests.id, id));
    await set(w1, { acknowledgedAt: at("2026-11-12T04:04:00Z"), completedAt: at("2026-11-12T04:30:00Z") });
    await set(w2, { acknowledgedAt: at("2026-11-13T04:20:00Z") });
    await set(h1, { acknowledgedAt: at("2026-11-13T05:04:00Z") });
    // Outside the range: must not count.
    await make("reception", "2026-11-01T04:00:00Z");
  });

  it("resolves local date ranges and caps them", () => {
    const r = resolveRange({ from: "2026-11-11", to: "2026-11-13" }, "Asia/Kolkata", NOW);
    expect(r.start.toISOString()).toBe("2026-11-10T18:30:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-13T18:30:00.000Z");
    expect(r.dates).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(resolveRange({ from: "2026-01-01", to: "2026-11-13" }, "UTC", NOW).dates).toHaveLength(92);
    expect(resolveRange({ from: "bad", to: "2026-11-13" }, "UTC", NOW).dates).toHaveLength(7);
  });

  it("computes occupancy per night from stays over sellable rooms", async () => {
    const r = await propertyReport(db, A.ctx, A.propertyId, { from: "2026-11-11", to: "2026-11-14" }, NOW);
    expect(r.occupancy.sellable).toBe(3); // 104 is out of order
    expect(r.occupancy.nights.map((n) => [n.date, n.occupied])).toEqual([
      ["2026-11-11", 1],
      ["2026-11-12", 2],
      ["2026-11-13", 1],
      ["2026-11-14", null], // tonight hasn't happened yet
    ]);
    expect(r.occupancy.roomNights).toBe(4);
    expect(r.occupancy.rate).toBeCloseTo(4 / 9);
    expect(r.occupancy.checkIns).toBe(2);
    expect(r.occupancy.checkOuts).toBe(1);
  });

  it("computes request volume and response times once per request", async () => {
    const r = await propertyReport(db, A.ctx, A.propertyId, { from: "2026-11-11", to: "2026-11-14" }, NOW);
    expect(r.requests).toMatchObject({ total: 3, completed: 1, cancelled: 1, open: 1 });
    expect(r.requests.ackAvg).toBeCloseTo((4 + 20 + 4) / 3, 1);
    expect(r.requests.ackP50).toBe(4);
    expect(r.requests.doneAvg).toBe(30);
    expect(r.requests.cancelledRate).toBeCloseTo(1 / 3);
    const water = r.requests.byDepartment.find((d) => d.department === "Room Service")!;
    expect(water).toMatchObject({ total: 2, completed: 1, lateAck: 1 }); // 20 min > 15 min target
    expect(r.requests.byService[0]).toMatchObject({ service: "Drinking water", total: 2 });
  });

  it("is gated by plan module, permission and tenant", async () => {
    const hk = await addStaff(db, A, "housekeeping", null);
    await expect(propertyReport(db, hk, A.propertyId, {}, NOW)).rejects.toMatchObject({ code: "forbidden" });
    const B = await createTenantFixture(db, { hotelName: "Other" });
    await expect(propertyReport(db, B.ctx, A.propertyId, {}, NOW)).rejects.toMatchObject({ code: "not_found" });
    const [starter] = await db.select().from(plans).where(eq(plans.key, "starter"));
    await db.update(subscriptions).set({ planId: starter.id }).where(eq(subscriptions.tenantId, A.tenantId));
    await expect(propertyReport(db, A.ctx, A.propertyId, {}, NOW)).rejects.toMatchObject({ code: "plan_limit" });
  });

  it("dashboard shows live room and request counts in scope", async () => {
    const m = await dashboardMetrics(db, A.ctx);
    expect(m!.rooms).toMatchObject({ total: 4, occupied: 1, outOfService: 1 });
    expect(m!.requests).toMatchObject({ inProgress: 1 });
    const hk = await addStaff(db, A, "housekeeping", null);
    expect((await dashboardMetrics(db, hk))!.requests).toMatchObject({ new: expect.any(Number) }); // department-scoped
  });
});
