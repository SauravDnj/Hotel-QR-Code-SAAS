import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { outboxEvents, rateLimits, requestStatusHistory, serviceItems, serviceRequests } from "@/lib/db/schema";
import type { RealtimePublisher } from "@/lib/realtime/ably";
import { departmentChannel } from "@/lib/realtime/channels";
import { createProperty } from "@/modules/properties/service";
import { getRoomQr, rotateRoomQr } from "@/modules/qr/service";
import { drainOutbox, MAX_ATTEMPTS } from "@/modules/realtime/outbox";
import { getGuestRequestStatus, submitGuestRequest, type GuestRequestInput } from "@/modules/requests/guest";
import {
  assignRequest,
  getRequestForStaff,
  inboxMarker,
  listAssignableStaff,
  listInbox,
  subscribableChannels,
  transitionRequest,
} from "@/modules/requests/staff";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { createRoom } from "@/modules/rooms/rooms";
import { createDefaultServices, listServices, updateService } from "@/modules/services/catalog";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

let ipN = 0;
const ip = () => `198.51.100.${++ipN % 250}`;

async function hotel(db: Db, name: string) {
  const t = await createTenantFixture(db, { hotelName: name });
  const floor = await createFloor(db, t.ctx, t.propertyId, { name: "F1" });
  const cat = await createCategory(db, t.ctx, t.propertyId, { name: "Std", capacity: 2 });
  const room = await createRoom(db, t.ctx, t.propertyId, { roomCode: "101", floorId: floor.id, categoryId: cat.id });
  await createDefaultServices(db, t.ctx, t.propertyId);
  const { items } = await listServices(db, t.ctx, t.propertyId);
  const svc = Object.fromEntries(items.map((i) => [i.key, i]));
  const qrUrl = (await getRoomQr(db, t.ctx, t.propertyId, room.id)).active!.url;
  return { t, floor, cat, room, svc, qr: qrUrl.split("/r/")[1]! };
}

const okPublisher = (): RealtimePublisher & { sent: { channel: string; name: string; data: unknown }[] } => {
  const sent: { channel: string; name: string; data: unknown }[] = [];
  return { enabled: true, sent, publish: async (channel, name, data) => void sent.push({ channel, name, data }) };
};

describe("guest service requests, staff inbox and outbox", () => {
  let db: Db;
  let A: Awaited<ReturnType<typeof hotel>>;
  let B: Awaited<ReturnType<typeof hotel>>;

  const submit = (h: typeof A, input: Partial<GuestRequestInput> & { serviceId: string }, now?: Date) =>
    submitGuestRequest(db, h.qr, { idempotencyKey: crypto.randomUUID(), ...input }, { ip: ip(), now });

  beforeAll(async () => {
    db = await createTestDb();
    A = await hotel(db, "Alpha");
    B = await hotel(db, "Bravo");
  });

  // Each test starts with fresh rate-limit windows (the flood test checks the limit itself).
  beforeEach(async () => {
    await db.delete(rateLimits);
  });

  it("creates the standard catalogue once (idempotent) with departments", async () => {
    expect(Object.keys(A.svc).sort()).toEqual(["custom", "housekeeping", "maintenance", "reception", "water"]);
    expect(A.svc.custom.enabled).toBe(false);
    expect((await createDefaultServices(db, A.t.ctx, A.t.propertyId)).count).toBe(0);
  });

  it("persists request + history + outbox atomically and returns a status receipt", async () => {
    const res = await submit(A, { serviceId: A.svc.water.id, quantity: 2, note: "Cold please" });
    if (res.kind !== "ok") throw new Error(JSON.stringify(res));
    expect(res.statusToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [r] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, res.requestId));
    expect(r).toMatchObject({ status: "new", quantity: 2, roomCode: "101", serviceName: "Drinking water", departmentName: "Room Service" });
    expect(r.tenantId).toBe(A.t.tenantId);
    expect(JSON.stringify(r)).not.toContain(res.statusToken);
    const hist = await db.select().from(requestStatusHistory).where(eq(requestStatusHistory.requestId, r.id));
    expect(hist).toHaveLength(1);
    const events = await db.select().from(outboxEvents).where(eq(outboxEvents.tenantId, A.t.tenantId));
    const ev = events.find((e) => (e.payload as { requestId: string }).requestId === r.id)!;
    expect(ev.channels).toEqual([departmentChannel(A.t.tenantId, A.t.propertyId, r.departmentId)]);
    // Thin envelope only: no guest note, token or room text in the broadcast payload.
    expect(JSON.stringify(ev.payload)).not.toMatch(/Cold please|101|statusToken/);
  });

  it("is idempotent: the same key returns the same receipt and creates one request", async () => {
    const key = crypto.randomUUID();
    const a = await submitGuestRequest(db, A.qr, { serviceId: A.svc.reception.id, idempotencyKey: key }, { ip: ip() });
    const b = await submitGuestRequest(db, A.qr, { serviceId: A.svc.reception.id, idempotencyKey: key }, { ip: ip() });
    expect(a.kind).toBe("ok");
    expect(b).toMatchObject({ kind: "ok", duplicate: true });
    if (a.kind === "ok" && b.kind === "ok") expect(b.statusToken).toBe(a.statusToken);
    const rows = await db.select().from(serviceRequests).where(eq(serviceRequests.idempotencyKey, key));
    expect(rows).toHaveLength(1);
    // The key cannot be replayed from another room's QR to fetch someone else's receipt.
    expect(await submitGuestRequest(db, B.qr, { serviceId: B.svc.reception.id, idempotencyKey: key }, { ip: ip() })).not.toMatchObject({
      kind: "ok",
      duplicate: true,
    });
  });

  it("validates services and fields on the server", async () => {
    expect(await submit(A, { serviceId: A.svc.custom.id, note: "x" })).toMatchObject({ kind: "invalid" }); // disabled
    expect(await submit(A, { serviceId: B.svc.water.id })).toMatchObject({ kind: "invalid" }); // other hotel's service
    expect(await submit(A, { serviceId: A.svc.water.id, quantity: 99 })).toMatchObject({ kind: "invalid", fieldErrors: { quantity: expect.any(Array) } });
    expect(await submit(A, { serviceId: A.svc.housekeeping.id })).toMatchObject({ kind: "invalid", fieldErrors: { option: expect.any(Array) } });
    expect(await submit(A, { serviceId: A.svc.housekeeping.id, option: "Hack" })).toMatchObject({ kind: "invalid" });
    expect(await submit(A, { serviceId: A.svc.water.id, note: "x".repeat(501) })).toMatchObject({ kind: "invalid" });
    expect(await submit(A, { serviceId: "not-a-uuid" })).toMatchObject({ kind: "invalid" });

    await updateService(db, A.t.ctx, A.t.propertyId, A.svc.custom.id, {
      name: "Something else",
      departmentId: A.svc.custom.departmentId,
      enabled: "on",
      noteMode: "required",
    });
    expect(await submit(A, { serviceId: A.svc.custom.id })).toMatchObject({ kind: "invalid", fieldErrors: { note: expect.any(Array) } });
    expect(await submit(A, { serviceId: A.svc.custom.id, note: "Iron please" })).toMatchObject({ kind: "ok" });
  });

  it("enforces service hours in the property's timezone (overnight windows too)", async () => {
    await updateService(db, A.t.ctx, A.t.propertyId, A.svc.reception.id, {
      name: "Reception assistance",
      departmentId: A.svc.reception.departmentId,
      enabled: "on",
      availableFrom: "22:00",
      availableTo: "06:00",
    });
    // Asia/Kolkata is UTC+5:30: 18:00Z = 23:30 local (open), 06:30Z = 12:00 local (closed).
    expect(await submit(A, { serviceId: A.svc.reception.id }, new Date("2026-11-16T18:00:00Z"))).toMatchObject({ kind: "ok" });
    expect(await submit(A, { serviceId: A.svc.reception.id }, new Date("2026-11-16T06:30:00Z"))).toMatchObject({ kind: "invalid" });
    await db.update(serviceItems).set({ availableFrom: null, availableTo: null }).where(eq(serviceItems.id, A.svc.reception.id));
  });

  it("rejects unknown and revoked QR codes", async () => {
    expect(await submitGuestRequest(db, "A".repeat(43), { serviceId: A.svc.water.id, idempotencyKey: crypto.randomUUID() }, { ip: ip() })).toEqual({
      kind: "unavailable",
    });
    const h = await hotel(db, "Rotated");
    const old = h.qr;
    await rotateRoomQr(db, h.t.ctx, h.t.propertyId, h.room.id);
    expect(await submitGuestRequest(db, old, { serviceId: h.svc.water.id, idempotencyKey: crypto.randomUUID() }, { ip: ip() })).toEqual({
      kind: "unavailable",
    });
  });

  it("rate-limits submissions per room code", async () => {
    const h = await hotel(db, "Flood");
    let last;
    for (let i = 0; i < 11; i++) last = await submit(h, { serviceId: h.svc.reception.id });
    expect(last).toEqual({ kind: "rate_limited" });
  });

  it("department routing: staff only see and act on their department's requests", async () => {
    const water = await submit(A, { serviceId: A.svc.water.id, quantity: 1 });
    const towels = await submit(A, { serviceId: A.svc.housekeeping.id, option: "Extra towels" });
    if (water.kind !== "ok" || towels.kind !== "ok") throw new Error("setup");

    const hk = await addStaff(db, A.t as TenantFixture, "housekeeping", null);
    const rs = await addStaff(db, A.t as TenantFixture, "room_service", null);
    const hkIds = (await listInbox(db, hk)).map((r) => r.id);
    expect(hkIds).toContain(towels.requestId);
    expect(hkIds).not.toContain(water.requestId);
    await expect(getRequestForStaff(db, hk, water.requestId)).rejects.toMatchObject({ code: "not_found" });
    await expect(transitionRequest(db, hk, water.requestId, "acknowledge")).rejects.toMatchObject({ code: "not_found" });

    // Room service handles water end to end.
    await transitionRequest(db, rs, water.requestId, "acknowledge", { guestMessage: "On the way!" });
    await transitionRequest(db, rs, water.requestId, "start");
    await expect(transitionRequest(db, rs, water.requestId, "start")).rejects.toMatchObject({ code: "conflict" });
    await transitionRequest(db, rs, water.requestId, "complete", { note: "internal: delivered by Raj" });
    const detail = await getRequestForStaff(db, rs, water.requestId);
    expect(detail.request).toMatchObject({ status: "completed", assignedUserId: rs.userId });
    expect(detail.request.completedAt).not.toBeNull();
    expect(JSON.stringify(detail)).not.toContain(water.statusToken);
    expect(detail.history.map((h) => h.toStatus)).toEqual(["completed", "in_progress", "acknowledged", "new"]);

    // Guest view: mapped labels, guest message, no internal note or staff names.
    const status = await getGuestRequestStatus(db, water.statusToken, { ip: ip() });
    if (status.kind !== "ok") throw new Error("status");
    expect(status.request).toMatchObject({ statusLabel: "Completed", guestMessage: "On the way!", serviceName: "Drinking water" });
    expect(status.request.timeline.map((t) => t.label)).toEqual(["Request sent", "Hotel team notified", "Being handled", "Completed"]);
    const json = JSON.stringify(status);
    expect(json).not.toMatch(/Raj|internal|room_service|assigned/i);
    expect(json).not.toContain(rs.userId);

    // Reopen needs request.reopen (managers/owners), and a reason.
    await expect(transitionRequest(db, rs, water.requestId, "reopen", { note: "x" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(transitionRequest(db, A.t.ctx, water.requestId, "reopen")).rejects.toThrow(/reason/);
    await transitionRequest(db, A.t.ctx, water.requestId, "reopen", { note: "Guest says only one bottle arrived" });
    expect((await getGuestRequestStatus(db, water.statusToken, { ip: ip() })) as { request: { statusLabel: string } }).toMatchObject({
      request: { statusLabel: "Being reviewed" },
    });
  });

  it("cancel needs a reason and permission; housekeeping cannot cancel", async () => {
    const r = await submit(A, { serviceId: A.svc.housekeeping.id, option: "Clean my room" });
    if (r.kind !== "ok") throw new Error("setup");
    const hk = await addStaff(db, A.t as TenantFixture, "housekeeping", null);
    await expect(transitionRequest(db, hk, r.requestId, "cancel", { note: "no" })).rejects.toMatchObject({ code: "forbidden" });
    const rec = await addStaff(db, A.t as TenantFixture, "receptionist", null);
    await expect(transitionRequest(db, rec, r.requestId, "cancel")).rejects.toThrow(/reason/);
    await transitionRequest(db, rec, r.requestId, "cancel", { note: "Guest checked out" });
    const s = await getGuestRequestStatus(db, r.statusToken, { ip: ip() });
    expect(s).toMatchObject({ request: { status: "cancelled" } });
    expect(JSON.stringify(s)).not.toContain("Guest checked out");
  });

  it("assignment is limited to staff whose role covers the department", async () => {
    const r = await submit(A, { serviceId: A.svc.maintenance.id, option: "TV" });
    if (r.kind !== "ok") throw new Error("setup");
    const mt = await addStaff(db, A.t as TenantFixture, "maintenance", null);
    const hk = await addStaff(db, A.t as TenantFixture, "housekeeping", null);
    const ids = (await listAssignableStaff(db, A.t.ctx, r.requestId)).map((s) => s.userId);
    expect(ids).toContain(mt.userId);
    expect(ids).not.toContain(hk.userId);
    await expect(assignRequest(db, A.t.ctx, r.requestId, hk.userId)).rejects.toThrow(/cannot handle/);
    await assignRequest(db, A.t.ctx, r.requestId, mt.userId);
    expect((await listInbox(db, mt, { mine: "1" })).map((x) => x.id)).toContain(r.requestId);
    await expect(assignRequest(db, mt, r.requestId, mt.userId)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("isolates tenants and property-scoped staff", async () => {
    const r = await submit(A, { serviceId: A.svc.water.id, quantity: 1 });
    if (r.kind !== "ok") throw new Error("setup");
    expect((await listInbox(db, B.t.ctx, { view: "all" })).map((x) => x.id)).not.toContain(r.requestId);
    await expect(getRequestForStaff(db, B.t.ctx, r.requestId)).rejects.toMatchObject({ code: "not_found" });
    await expect(transitionRequest(db, B.t.ctx, r.requestId, "acknowledge")).rejects.toMatchObject({ code: "not_found" });

    const p2 = await createProperty(db, A.t.ctx, { name: "Annex", country: "IN", timezone: "Asia/Kolkata", currency: "INR" });
    const annexStaff = await addStaff(db, A.t as TenantFixture, "manager", p2.id);
    expect(await listInbox(db, annexStaff, { view: "all" })).toEqual([]);
    await expect(getRequestForStaff(db, annexStaff, r.requestId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("inbox marker and channel list follow the same scope", async () => {
    const owner = await inboxMarker(db, A.t.ctx);
    expect(owner.newCount).toBeGreaterThan(0);
    expect(owner.latest).not.toBeNull();
    expect(await inboxMarker(db, B.t.ctx)).toMatchObject({ newCount: expect.any(Number) });

    const hk = await addStaff(db, A.t as TenantFixture, "housekeeping", null);
    const chans = await subscribableChannels(db, hk);
    expect(chans.map((c) => c.key)).toEqual(["housekeeping"]);
    expect((await subscribableChannels(db, A.t.ctx)).every((c) => c.propertyId === A.t.propertyId)).toBe(true);
  });

  it("guest status tokens expire and unknown tokens reveal nothing", async () => {
    const r = await submit(A, { serviceId: A.svc.reception.id });
    if (r.kind !== "ok") throw new Error("setup");
    expect(await getGuestRequestStatus(db, "Z".repeat(43), { ip: ip() })).toEqual({ kind: "unavailable" });
    await db.update(serviceRequests).set({ guestTokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(serviceRequests.id, r.requestId));
    expect(await getGuestRequestStatus(db, r.statusToken, { ip: ip() })).toEqual({ kind: "unavailable" });
  });

  it("outbox: publishes, retries with backoff, dead-letters, and skips when realtime is off", async () => {
    const pub = okPublisher();
    const first = await drainOutbox(db, pub, { limit: 500 });
    expect(first.published).toBeGreaterThan(0);
    expect(pub.sent.every((s) => s.channel.startsWith("hotel:"))).toBe(true);
    expect((await drainOutbox(db, pub)).claimed).toBe(0); // nothing due twice

    const r = await submit(A, { serviceId: A.svc.reception.id });
    if (r.kind !== "ok") throw new Error("setup");
    const failing: RealtimePublisher = { enabled: true, publish: async () => Promise.reject(new Error("provider down")) };
    const res = await drainOutbox(db, failing);
    expect(res.failed).toBe(1);
    const evWhere = and(eq(outboxEvents.tenantId, A.t.tenantId), eq(outboxEvents.status, "pending"));
    const [pending] = await db.select().from(outboxEvents).where(evWhere);
    expect(pending).toMatchObject({ attempts: 1, lastError: "provider down" });
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // The request itself is safe in the inbox regardless of the provider.
    expect((await listInbox(db, A.t.ctx)).map((x) => x.id)).toContain(r.requestId);

    await db.update(outboxEvents).set({ attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(0) }).where(eq(outboxEvents.id, pending.id));
    await drainOutbox(db, failing);
    const [dead] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, pending.id));
    expect(dead.status).toBe("dead");

    await submit(A, { serviceId: A.svc.reception.id });
    const off: RealtimePublisher = { enabled: false, publish: async () => undefined };
    expect((await drainOutbox(db, off)).claimed).toBe(1);
    expect(await db.select().from(outboxEvents).where(eq(outboxEvents.status, "skipped"))).toHaveLength(1);
  });
});
