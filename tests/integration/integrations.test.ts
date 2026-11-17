import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { apiKeys, auditLogs, outboxEvents, plans, reservations, subscriptions, webhookEndpoints } from "@/lib/db/schema";
import { addDays, localDate } from "@/lib/timezones";
import { getFolio, postChargeToRoom } from "@/modules/ordering/folio";
import { createProperty } from "@/modules/properties/service";
import { authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from "@/modules/integrations/keys";
import {
  createWebhook,
  deliverWebhook,
  enqueueWebhookEvent,
  isPrivateAddress,
  sendTestWebhook,
  signWebhook,
  webhookUrlSchema,
} from "@/modules/integrations/webhooks";
import { drainOutbox } from "@/modules/realtime/outbox";
import { portfolioReport } from "@/modules/reports/service";
import { closeReservation, createReservation, listReservations } from "@/modules/reservations/service";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { createRoom } from "@/modules/rooms/rooms";
import { checkIn, checkOut } from "@/modules/stays/service";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";
import type { RealtimePublisher } from "@/lib/realtime/ably";

const off: RealtimePublisher = { enabled: false, publish: async () => undefined };
const publicDns = async () => ["93.184.216.34"];
const today = () => localDate(new Date(), "Asia/Kolkata");

describe("integrations: API keys, webhooks, POS postings, portfolio (Phase 9)", () => {
  let db: Db;
  let A: TenantFixture;
  let B: TenantFixture;
  let catId: string;
  let roomId: string;

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Connected Hotel" });
    B = await createTenantFixture(db, { hotelName: "Starter Hotel" });
    const floor = await createFloor(db, A.ctx, A.propertyId, { name: "F1" });
    catId = (await createCategory(db, A.ctx, A.propertyId, { name: "Std", capacity: 2 })).id;
    roomId = (await createRoom(db, A.ctx, A.propertyId, { roomCode: "201", floorId: floor.id, categoryId: catId })).id;
    await createRoom(db, A.ctx, A.propertyId, { roomCode: "202", floorId: floor.id, categoryId: catId });
    // B is on Starter (no integrations).
    const [starter] = await db.select().from(plans).where(eq(plans.key, "starter"));
    await db.update(subscriptions).set({ planId: starter.id }).where(eq(subscriptions.tenantId, B.tenantId));
  });

  it("plans: integrations entitlement on Professional/Enterprise only", async () => {
    const all = await db.select().from(plans);
    expect(Object.fromEntries(all.map((p) => [p.key, p.entitlements.modules.integrations]))).toEqual({
      starter: false,
      professional: true,
      enterprise: true,
    });
    await expect(createApiKey(db, B.ctx, { name: "X", scopes: ["rooms:read"] })).rejects.toMatchObject({ code: "plan_limit" });
  });

  it("keys: shown once, stored hashed, scoped; owner only; revocation is immediate", async () => {
    const reception = await addStaff(db, A, "receptionist", null);
    await expect(createApiKey(db, reception, { name: "X", scopes: ["rooms:read"] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createApiKey(db, A.ctx, { name: "X", scopes: [] })).rejects.toThrow();
    const { key, secret } = await createApiKey(db, A.ctx, { name: "Channel manager", scopes: ["reservations:read", "reservations:write"] });
    expect(secret).toMatch(/^hk_[A-Za-z0-9_-]{43}$/);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(JSON.stringify(row)).not.toContain(secret.slice(3));
    expect((await listApiKeys(db, A.ctx))[0]).not.toHaveProperty("keyHash");

    const p = await authenticateApiKey(db, secret);
    expect(p).toMatchObject({ keyId: key.id, scopes: ["reservations:read", "reservations:write"] });
    expect(p!.ctx.tenantId).toBe(A.tenantId);
    expect(await authenticateApiKey(db, "hk_" + "x".repeat(43))).toBeNull();
    expect(await authenticateApiKey(db, "Bearer nonsense")).toBeNull();

    // Grants come only from scopes: reservations yes, folio/staff no.
    const listed = await listReservations(db, p!.ctx, A.propertyId);
    expect(listed.reservations).toEqual([]);
    await expect(getFolio(db, p!.ctx, A.propertyId, crypto.randomUUID())).rejects.toMatchObject({ code: "forbidden" });

    await revokeApiKey(db, A.ctx, key.id);
    expect(await authenticateApiKey(db, secret)).toBeNull();
  });

  it("property-scoped keys cannot reach other properties", async () => {
    const other = await createProperty(db, A.ctx, { name: "Annex", country: "IN", timezone: "Asia/Kolkata", currency: "INR" });
    const { secret } = await createApiKey(db, A.ctx, { name: "Main only", propertyId: A.propertyId, scopes: ["reservations:read"] });
    const p = (await authenticateApiKey(db, secret))!;
    await listReservations(db, p.ctx, A.propertyId);
    await expect(listReservations(db, p.ctx, other.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(listReservations(db, p.ctx, B.propertyId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("API-created bookings are audited as the key, idempotent on externalRef", async () => {
    const { key, secret } = await createApiKey(db, A.ctx, { name: "OTA", scopes: ["reservations:write", "reservations:read"] });
    const p = (await authenticateApiKey(db, secret))!;
    const input = {
      categoryId: catId,
      guestName: "API Guest",
      arrivalDate: addDays(today(), 5),
      departureDate: addDays(today(), 6),
      adults: 2,
      source: "ota" as const,
      externalRef: "OTA-555",
    };
    const one = await createReservation(db, p.ctx, A.propertyId, input, { actor: { type: "api_key", keyId: key.id } });
    const two = await createReservation(db, p.ctx, A.propertyId, input, { actor: { type: "api_key", keyId: key.id } });
    expect(two).toMatchObject({ duplicate: true, reservation: { id: one.reservation.id } });
    expect(one.reservation.createdByUserId).toBeNull();
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, one.reservation.id));
    expect(audit).toMatchObject({ actorType: "api_key", actorUserId: null, metadata: expect.objectContaining({ apiKeyId: key.id }) });
  });

  it("POS postings: charge the in-house guest by room code, idempotently", async () => {
    const { key, secret } = await createApiKey(db, A.ctx, { name: "POS", scopes: ["folio:write"] });
    const p = (await authenticateApiKey(db, secret))!;
    const actor = { userId: null, actorType: "api_key" as const, apiKeyId: key.id };
    await expect(postChargeToRoom(db, p.ctx, A.propertyId, { roomCode: "201", description: "Bar", amountMinor: 50000, externalRef: "POS-1" }, actor)).rejects.toThrow(
      /No guest is checked in/,
    );
    const stay = await checkIn(db, A.ctx, A.propertyId, { roomId, guestName: "Bar Guest", checkoutDate: addDays(today(), 1) });
    const first = await postChargeToRoom(db, p.ctx, A.propertyId, { roomCode: "201", description: "Bar", amountMinor: 50000, externalRef: "POS-1" }, actor);
    const again = await postChargeToRoom(db, p.ctx, A.propertyId, { roomCode: "201", description: "Bar", amountMinor: 50000, externalRef: "POS-1" }, actor);
    expect(again).toMatchObject({ duplicate: true, charge: { id: first.charge.id } });
    await expect(postChargeToRoom(db, p.ctx, A.propertyId, { roomCode: "201", description: "Bad", amountMinor: 1.5, externalRef: "POS-2" }, actor)).rejects.toThrow();
    await expect(postChargeToRoom(db, p.ctx, A.propertyId, { roomCode: "201", description: "No ref", amountMinor: 100 }, actor)).rejects.toThrow();
    const folio = await getFolio(db, A.ctx, A.propertyId, stay.id);
    expect(folio.charges).toHaveLength(1);
    expect(folio.charges[0]).toMatchObject({ source: "api", amountMinor: 50000 });
    await checkOut(db, A.ctx, A.propertyId, stay.id, { allowBalance: true });
  });

  it("webhook URLs: public https only", () => {
    for (const bad of [
      "http://example.com/hook",
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://169.254.169.254/latest",
      "https://[::1]/hook",
      "https://user:pw@example.com/hook",
      "https://example.com:8443/hook",
      "https://printer.local/hook",
    ]) {
      expect(webhookUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(webhookUrlSchema.safeParse("https://pms.example.com/hooks?x=1").success).toBe(true);
    expect(isPrivateAddress("192.168.1.10")).toBe(true);
    expect(isPrivateAddress("::ffff:10.1.2.3")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("webhooks: thin events enqueued in the same transaction, signed delivery, retries, private-IP refusal", async () => {
    const { endpoint, secret } = await createWebhook(db, A.ctx, {
      url: "https://pms.example.com/hooks",
      events: ["reservation.created", "reservation.cancelled", "stay.checked_out"],
    });
    expect(secret).toMatch(/^whsec_/);
    const [stored] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, endpoint.id));
    expect(stored.secretCiphertext).not.toContain(secret);

    const { reservation } = await createReservation(db, A.ctx, A.propertyId, {
      categoryId: catId,
      guestName: "Secret Name",
      phone: "+91 90000 12345",
      arrivalDate: addDays(today(), 9),
      departureDate: addDays(today(), 10),
      adults: 1,
    });
    const jobs = (await db.select().from(outboxEvents).where(eq(outboxEvents.tenantId, A.tenantId))).filter((e) => e.eventType === "webhook.reservation.created");
    expect(jobs).toHaveLength(1);
    expect(JSON.stringify(jobs[0].payload)).not.toMatch(/Secret Name|90000/);

    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    let answer = 500;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response(null, { status: answer });
    }) as unknown as typeof fetch;
    const notifier = ({ tenantId, payload }: { tenantId: string; payload: Record<string, unknown> }) =>
      deliverWebhook(db, tenantId, payload, { fetch: fakeFetch, resolve: publicDns });

    const failed = await drainOutbox(db, off, { limit: 500, notifier });
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    const [retry] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, jobs[0].id));
    expect(retry.status).toBe("pending");

    answer = 204;
    await db.update(outboxEvents).set({ nextAttemptAt: new Date(0) }).where(eq(outboxEvents.id, jobs[0].id));
    await drainOutbox(db, off, { limit: 500, notifier });
    const [done] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, jobs[0].id));
    expect(done.status).toBe("published");

    const last = calls.at(-1)!;
    const ts = Number(last.headers["X-Webhook-Timestamp"]);
    expect(last.headers["X-Webhook-Signature"]).toBe(`v1=${createHmac("sha256", secret).update(`${ts}.${last.body}`).digest("hex")}`);
    expect(signWebhook(secret, ts, last.body)).toBe(last.headers["X-Webhook-Signature"]);
    expect(JSON.parse(last.body)).toMatchObject({ type: "reservation.created", data: { reservationId: reservation.id, code: reservation.code } });

    // Unsubscribed events are not enqueued.
    const before = (await db.select().from(outboxEvents)).length;
    await enqueueWebhookEvent(db, A.tenantId, "request.created", { x: 1 });
    expect((await db.select().from(outboxEvents)).length).toBe(before);

    // DNS pointing at a private address is refused at send time.
    await closeReservation(db, A.ctx, A.propertyId, reservation.id, "cancelled");
    const [cancelJob] = (await db.select().from(outboxEvents)).filter((e) => e.eventType === "webhook.reservation.cancelled");
    await expect(deliverWebhook(db, A.tenantId, cancelJob.payload, { fetch: fakeFetch, resolve: async () => ["10.0.0.7"] })).rejects.toThrow(/private address/);

    // Test event from the settings page.
    const test = await sendTestWebhook(db, A.ctx, endpoint.id, { fetch: fakeFetch, resolve: publicDns });
    expect(test).toMatchObject({ skipped: false, status: 204 });
    await expect(sendTestWebhook(db, B.ctx, endpoint.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("portfolio report: one row per property, consistent with property reports", async () => {
    const p = await portfolioReport(db, A.ctx, {});
    expect(p.rows.map((r) => r.name).sort()).toEqual(["Annex", "Connected Hotel"]);
    expect(p.totals.currency).toBe("INR");
    const main = p.rows.find((r) => r.name === "Connected Hotel")!;
    expect(main.sellable).toBe(2);
    expect(main.chargedMinor).toBe(50000);
    expect(main.bookings).toBeGreaterThanOrEqual(2);
    const reception = await addStaff(db, A, "housekeeping", A.propertyId);
    await expect(portfolioReport(db, reception, {})).resolves.toMatchObject({ rows: [] });
    // Reports need the plan module.
    await expect(portfolioReport(db, B.ctx, {})).rejects.toMatchObject({ code: "plan_limit" });
    void and;
    void reservations;
  });
});
