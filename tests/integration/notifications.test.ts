import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { outboxEvents, pushSubscriptions, rateLimits } from "@/lib/db/schema";
import type { NotificationSenders, PushPayload, PushTarget } from "@/lib/notifications/senders";
import type { TenantContext } from "@/lib/permissions/authorize";
import type { RealtimePublisher } from "@/lib/realtime/ably";
import { deliverNotification, deviceLabel, enqueueNotification, listMyDevices, removeDevice, savePushSubscription } from "@/modules/notifications/service";
import { getRoomQr } from "@/modules/qr/service";
import { drainOutbox } from "@/modules/realtime/outbox";
import { submitGuestRequest } from "@/modules/requests/guest";
import { transitionRequest } from "@/modules/requests/staff";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { createRoom } from "@/modules/rooms/rooms";
import { createDefaultServices, listServices } from "@/modules/services/catalog";
import { updateNotificationPrefs } from "@/modules/staff/profile";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

const sub = (name: string) => ({
  endpoint: `https://push.example.test/send/${name}-${crypto.randomUUID()}`,
  keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
});

function fakeSenders(gone: Set<string> = new Set()) {
  const pushes: { endpoint: string; payload: PushPayload }[] = [];
  const messages: { channel: string; to: string; text: string }[] = [];
  const senders: NotificationSenders = {
    push: async (t: PushTarget, payload) => {
      if ([...gone].some((g) => t.endpoint.includes(g))) return "gone";
      pushes.push({ endpoint: t.endpoint, payload });
      return "ok";
    },
    message: async (channel, to, msg) => void messages.push({ channel, to, text: `${msg.room} ${msg.service} ${msg.minutes}` }),
  };
  return { senders, pushes, messages };
}

const off: RealtimePublisher = { enabled: false, publish: async () => undefined };

describe("staff push and escalation alerts (Phase 9)", () => {
  let db: Db;
  let A: TenantFixture;
  let roomService: TenantContext;
  let housekeeper: TenantContext;
  let manager: TenantContext;
  let quiet: TenantContext;
  let qr: string;
  let water: { id: string; departmentId: string };

  const endpointOf = async (ctx: TenantContext) =>
    (await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.membershipId, ctx.membershipId))).map((s) => s.endpoint);

  const newRequest = async () => {
    const res = await submitGuestRequest(db, qr, { serviceId: water.id, idempotencyKey: crypto.randomUUID(), quantity: "1" }, { ip: null });
    if (res.kind !== "ok") throw new Error(res.kind);
    return res.requestId;
  };

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Alert Hotel" });
    roomService = await addStaff(db, A, "room_service", null);
    housekeeper = await addStaff(db, A, "housekeeping", null);
    manager = await addStaff(db, A, "manager", null);
    quiet = await addStaff(db, A, "room_service", null);
    await updateNotificationPrefs(db, quiet, { notifyScope: "mine", notifySound: "on", escalationChannel: "none" });
    const floor = await createFloor(db, A.ctx, A.propertyId, { name: "F1" });
    const cat = await createCategory(db, A.ctx, A.propertyId, { name: "Std", capacity: 2 });
    const room = await createRoom(db, A.ctx, A.propertyId, { roomCode: "101", floorId: floor.id, categoryId: cat.id });
    await createDefaultServices(db, A.ctx, A.propertyId);
    const { items } = await listServices(db, A.ctx, A.propertyId);
    water = items.find((i) => i.key === "water")!;
    qr = (await getRoomQr(db, A.ctx, A.propertyId, room.id)).active!.url.split("/r/")[1]!;
    for (const [ctx, name] of [
      [roomService, "rs"],
      [housekeeper, "hk"],
      [manager, "mgr"],
      [quiet, "quiet"],
    ] as const) {
      await savePushSubscription(db, ctx, sub(name), "Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/130.0 Mobile Safari/537.36");
    }
  });

  beforeEach(async () => {
    await db.delete(rateLimits);
  });

  it("stores subscriptions safely and labels devices without keeping the user agent", async () => {
    await expect(savePushSubscription(db, roomService, { endpoint: "http://insecure.test/x", keys: sub("x").keys }, null)).rejects.toThrow();
    await expect(savePushSubscription(db, roomService, { endpoint: "https://ok.test/x" }, null)).rejects.toThrow();
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17.0 Mobile Safari/604.1")).toBe("Safari on iOS");
    const devices = await listMyDevices(db, roomService);
    expect(devices).toHaveLength(1);
    expect(devices[0].label).toBe("Chrome on Android");
    // Another member cannot remove my device.
    await removeDevice(db, housekeeper, devices[0].id);
    expect(await listMyDevices(db, roomService)).toHaveLength(1);
  });

  it("new request: pushes to staff covering the department; not to other departments or 'only mine'", async () => {
    const requestId = await newRequest();
    const f = fakeSenders();
    const res = await deliverNotification(db, A.tenantId, { kind: "request_new", requestId, propertyId: A.propertyId, departmentId: water.departmentId }, f.senders);
    const got = new Set(f.pushes.map((p) => p.endpoint));
    for (const e of await endpointOf(roomService)) expect(got.has(e)).toBe(true);
    for (const e of await endpointOf(manager)) expect(got.has(e)).toBe(true);
    for (const e of await endpointOf(housekeeper)) expect(got.has(e)).toBe(false);
    for (const e of await endpointOf(quiet)) expect(got.has(e)).toBe(false);
    expect(res.messaged).toBe(0); // SMS/WhatsApp are for escalations only
    expect(f.pushes[0].payload).toMatchObject({ title: "Room 101: Drinking water", url: `/inbox/${requestId}` });
  });

  it("escalation: supervisors only, plus SMS/WhatsApp to those who opted in", async () => {
    await updateNotificationPrefs(db, manager, { notifyScope: "all", notifySound: "on", notifyPush: "on", escalationChannel: "whatsapp", alertPhone: "+91 98765 43210" });
    await expect(updateNotificationPrefs(db, manager, { notifyScope: "all", escalationChannel: "sms", alertPhone: "" })).rejects.toThrow(/mobile number/);
    const requestId = await newRequest();
    const f = fakeSenders();
    await deliverNotification(db, A.tenantId, { kind: "request_escalated", requestId, propertyId: A.propertyId, departmentId: water.departmentId }, f.senders);
    const got = new Set(f.pushes.map((p) => p.endpoint));
    for (const e of await endpointOf(manager)) expect(got.has(e)).toBe(true);
    for (const e of await endpointOf(roomService)) expect(got.has(e)).toBe(false); // no request.assign
    expect(f.messages).toEqual([{ channel: "whatsapp", to: "+919876543210", text: "101 Drinking water 15" }]);
  });

  it("skips requests already accepted, and removes devices the push service reports gone", async () => {
    const requestId = await newRequest();
    await transitionRequest(db, roomService, requestId, "acknowledge");
    const f = fakeSenders();
    const skipped = await deliverNotification(db, A.tenantId, { kind: "request_new", requestId, propertyId: A.propertyId, departmentId: water.departmentId }, f.senders);
    expect(skipped.skippedReason).toBe("not_new");
    expect(f.pushes).toHaveLength(0);

    const second = await newRequest();
    const g = fakeSenders(new Set(["/rs-"]));
    const res = await deliverNotification(db, A.tenantId, { kind: "request_new", requestId: second, propertyId: A.propertyId, departmentId: water.departmentId }, g.senders);
    expect(res.removed).toBe(1);
    expect(await endpointOf(roomService)).toHaveLength(0);
  });

  it("rides the outbox: delivered by the notifier, skipped when no channel is configured", async () => {
    const requestId = await newRequest();
    // In tests no VAPID/Twilio keys are set, so submission enqueues no notification job.
    expect((await db.select().from(outboxEvents)).filter((e) => e.eventType.startsWith("notify."))).toHaveLength(0);
    await enqueueNotification(db, { tenantId: A.tenantId, propertyId: A.propertyId, departmentId: water.departmentId, requestId, kind: "request_new" }, { force: true });
    await drainOutbox(db, off, { limit: 500 }); // no notifier → skipped
    const [skipped] = (await db.select().from(outboxEvents)).filter((e) => e.eventType === "notify.request_new");
    expect(skipped.status).toBe("skipped");

    await enqueueNotification(db, { tenantId: A.tenantId, propertyId: A.propertyId, departmentId: water.departmentId, requestId, kind: "request_new" }, { force: true });
    const f = fakeSenders();
    const res = await drainOutbox(db, off, { limit: 500, notifier: ({ tenantId, payload }) => deliverNotification(db, tenantId, payload, f.senders) });
    expect(res.published).toBe(1);
    expect(f.pushes.length).toBeGreaterThan(0);
  });
});
