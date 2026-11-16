import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { invoices, paymentWebhookEvents, plans, roles, subscriptions, tenants } from "@/lib/db/schema";
import { verifyWebhookSignature } from "@/lib/billing/razorpay";
import { getBillingOverview, startCheckout } from "@/modules/billing/service";
import { getEntitlements, sweepSubscriptions } from "@/modules/billing/subscription";
import { handleRazorpayWebhook } from "@/modules/billing/webhooks";
import { setTenantStatus } from "@/modules/platform/service";
import { createProperty } from "@/modules/properties/service";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { bulkCreateRooms, createRoom, setRoomArchived } from "@/modules/rooms/rooms";
import { createInvitation, setMemberStatus } from "@/modules/staff/service";
import { loadTenantContext } from "@/modules/tenants/context";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

const SECRET = "test-webhook-secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
let evn = 0;

function event(name: string, providerSubId: string, createdAt: number, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    entity: "event",
    event: name,
    created_at: createdAt,
    payload: {
      subscription: { entity: { id: providerSubId, status: "active", current_end: createdAt + 30 * 86400, plan_id: "plan_TEST" } },
      ...extra,
    },
  });
}

describe("plans, limits, subscription lifecycle and Razorpay webhooks", () => {
  let db: Db;
  let A: TenantFixture;
  let tinyPlanId: string;
  let floorId: string;
  let catId: string;

  const send = (body: string, opts: { id?: string; sig?: string | null } = {}) =>
    handleRazorpayWebhook(db, body, { signature: opts.sig === undefined ? sign(body) : opts.sig, eventId: opts.id ?? `evt_${++evn}` }, SECRET);
  const sub = async (tenantId = A.tenantId) => (await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)))[0];
  const tenant = async (tenantId = A.tenantId) => (await db.select().from(tenants).where(eq(tenants.id, tenantId)))[0];
  const refreshCtx = async () => (A = { ...A, ctx: (await loadTenantContext(db, A.userId, A.tenantId))! });

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Billing Hotel" });
    floorId = (await createFloor(db, A.ctx, A.propertyId, { name: "F1" })).id;
    catId = (await createCategory(db, A.ctx, A.propertyId, { name: "Std", capacity: 2 })).id;
    const [tiny] = await db
      .insert(plans)
      .values({
        key: "tiny",
        name: "Tiny",
        priceMinor: 100_00,
        razorpayPlanId: "plan_TINY123456",
        entitlements: { maxRooms: 3, maxProperties: 1, maxStaffSeats: 3, modules: { reports: false } },
      })
      .returning();
    tinyPlanId = tiny.id;
  });

  it("new hotels start a trial on the default plan with database-defined entitlements", async () => {
    const s = await sub();
    expect(s.status).toBe("trialing");
    expect(s.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 13 * 86400_000);
    const [def] = await db.select().from(plans).where(eq(plans.isDefault, true));
    expect(s.planId).toBe(def.id);
    expect(await getEntitlements(db, A.tenantId)).toEqual(def.entitlements);
  });

  it("enforces room, property and staff-seat limits on the server", async () => {
    await db.update(subscriptions).set({ planId: tinyPlanId }).where(eq(subscriptions.tenantId, A.tenantId));
    await createRoom(db, A.ctx, A.propertyId, { roomCode: "101", floorId, categoryId: catId });
    // Bulk creation that would exceed the plan is refused as a whole.
    await expect(bulkCreateRooms(db, A.ctx, A.propertyId, { floorId, categoryId: catId, start: 200, end: 202 })).rejects.toMatchObject({
      code: "plan_limit",
    });
    await bulkCreateRooms(db, A.ctx, A.propertyId, { floorId, categoryId: catId, start: 102, end: 103 }); // 3/3
    await expect(createRoom(db, A.ctx, A.propertyId, { roomCode: "104", floorId, categoryId: catId })).rejects.toThrow(/allows up to 3 rooms/);

    // Archiving frees a slot; restoring needs one.
    const r = await createRoom(db, A.ctx, A.propertyId, { roomCode: "999", floorId, categoryId: catId }).catch(() => null);
    expect(r).toBeNull();
    const { items } = await import("@/modules/rooms/rooms").then((m) => m.listRooms(db, A.ctx, A.propertyId));
    await setRoomArchived(db, A.ctx, A.propertyId, items[0].id, true);
    const extra = await createRoom(db, A.ctx, A.propertyId, { roomCode: "105", floorId, categoryId: catId });
    await expect(setRoomArchived(db, A.ctx, A.propertyId, items[0].id, false)).rejects.toMatchObject({ code: "plan_limit" });
    expect(extra).toBeDefined();

    await expect(
      createProperty(db, A.ctx, { name: "Second", country: "IN", timezone: "Asia/Kolkata", currency: "INR" }),
    ).rejects.toMatchObject({ code: "plan_limit" });

    const [rec] = await db.select().from(roles).where(and(isNull(roles.tenantId), eq(roles.key, "receptionist")));
    await createInvitation(db, A.ctx, { email: "s1@example.test", name: "S1", roleId: rec.id }); // owner + 1 invite = 2
    const staff = await addStaff(db, A, "housekeeping", null); // 3 (bypasses service, like an existing member)
    await expect(createInvitation(db, A.ctx, { email: "s2@example.test", name: "S2", roleId: rec.id })).rejects.toMatchObject({
      code: "plan_limit",
    });
    await setMemberStatus(db, A.ctx, staff.membershipId, "disabled");
    await createInvitation(db, A.ctx, { email: "s2@example.test", name: "S2", roleId: rec.id });
    await expect(setMemberStatus(db, A.ctx, staff.membershipId, "active")).rejects.toMatchObject({ code: "plan_limit" });
  });

  it("concurrent creates cannot both squeeze under the limit", async () => {
    const B = await createTenantFixture(db, { hotelName: "Race Hotel" });
    await db.update(subscriptions).set({ planId: tinyPlanId }).where(eq(subscriptions.tenantId, B.tenantId));
    const f = await createFloor(db, B.ctx, B.propertyId, { name: "F" });
    const c = await createCategory(db, B.ctx, B.propertyId, { name: "C", capacity: 1 });
    await bulkCreateRooms(db, B.ctx, B.propertyId, { floorId: f.id, categoryId: c.id, start: 1, end: 2 });
    const results = await Promise.allSettled(
      ["3", "4"].map((code) => createRoom(db, B.ctx, B.propertyId, { roomCode: code, floorId: f.id, categoryId: c.id })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("checkout creates the provider subscription server-side; the browser never sets amounts", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "sub_TEST0001", short_url: "https://rzp.io/i/test", status: "created" }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await startCheckout(db, A.ctx, tinyPlanId, fakeFetch);
    expect(res.url).toBe("https://rzp.io/i/test");
    expect(calls[0].url).toBe("https://api.razorpay.com/v1/subscriptions");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ plan_id: "plan_TINY123456", notes: { tenant_id: A.tenantId } });
    expect(body).not.toHaveProperty("amount");
    expect(await sub()).toMatchObject({ providerSubscriptionId: "sub_TEST0001", pendingPlanId: tinyPlanId, status: "trialing" });

    const hk = await addStaff(db, A, "manager", null); // managers lack billing.manage
    await expect(startCheckout(db, hk, tinyPlanId, fakeFetch)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects bad signatures and stores nothing", async () => {
    const body = event("subscription.charged", "sub_TEST0001", 1_800_000_000);
    expect(await send(body, { sig: "0".repeat(64) })).toMatchObject({ httpStatus: 400, outcome: "bad_signature" });
    expect(await send(body, { sig: null })).toMatchObject({ httpStatus: 400 });
    expect(await send(body.replace("charged", "cancelled"), { sig: sign(body) })).toMatchObject({ httpStatus: 400 }); // tampered
    expect(await handleRazorpayWebhook(db, body, { signature: sign(body), eventId: "x" }, undefined)).toMatchObject({ httpStatus: 503 });
    expect(await db.select().from(paymentWebhookEvents)).toHaveLength(0);
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("a charge activates the paid plan, records one receipt, and replays are no-ops", async () => {
    const t0 = 1_800_000_000;
    const body = event("subscription.charged", "sub_TEST0001", t0, {
      payment: {
        entity: {
          id: "pay_ABC123",
          amount: 100_00,
          currency: "INR",
          status: "captured",
          invoice_id: "inv_1",
          created_at: t0,
          card: { last4: "4242", network: "Visa" },
          email: "owner@example.test",
          contact: "+919999999999",
        },
      },
    });
    expect(await send(body, { id: "evt_charge_1" })).toMatchObject({ httpStatus: 200, outcome: "processed" });
    expect(await send(body, { id: "evt_charge_1" })).toMatchObject({ httpStatus: 200, outcome: "duplicate" });
    const s = await sub();
    expect(s).toMatchObject({ status: "active", planId: tinyPlanId, pendingPlanId: null });
    expect(s.currentPeriodEnd!.getTime()).toBe((t0 + 30 * 86400) * 1000);
    expect((await tenant()).status).toBe("active");
    const receipts = await db.select().from(invoices).where(eq(invoices.tenantId, A.tenantId));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ amountMinor: 100_00, currency: "INR", providerPaymentId: "pay_ABC123" });
    // A second delivery with a different event id but the same payment still yields one receipt.
    await send(body, { id: "evt_charge_1_retry" });
    expect(await db.select().from(invoices).where(eq(invoices.tenantId, A.tenantId))).toHaveLength(1);
    // Card/contact details are never stored.
    const stored = JSON.stringify(await db.select().from(paymentWebhookEvents));
    expect(stored).not.toMatch(/4242|Visa|owner@example\.test|9999999999/);
  });

  it("older events never roll state back", async () => {
    expect(await send(event("subscription.cancelled", "sub_TEST0001", 1_700_000_000))).toMatchObject({ outcome: "stale" });
    expect((await sub()).status).toBe("active");
  });

  it("failed renewal → past_due with grace (still working) → halted → suspended (read-only, billing still visible)", async () => {
    const t = 1_800_100_000;
    await send(event("payment.failed", "sub_TEST0001", t, { payment: { entity: { id: "pay_FAIL1", subscription_id: "sub_TEST0001", amount: 100_00 } } }));
    const pd = await sub();
    expect(pd.status).toBe("past_due");
    expect(pd.graceEndsAt).not.toBeNull();
    await refreshCtx();
    await expect(createFloor(db, A.ctx, A.propertyId, { name: "Still works" })).resolves.toBeDefined();

    await send(event("subscription.halted", "sub_TEST0001", t + 10));
    expect((await tenant()).status).toBe("suspended");
    await refreshCtx();
    await expect(createFloor(db, A.ctx, A.propertyId, { name: "Blocked" })).rejects.toMatchObject({ code: "tenant_inactive" });
    await expect(getBillingOverview(db, A.ctx)).resolves.toMatchObject({ subscription: { status: "suspended" } });

    // Paying again restores access.
    await send(event("subscription.charged", "sub_TEST0001", t + 20, { payment: { entity: { id: "pay_DEF456", amount: 100_00, currency: "INR" } } }));
    expect((await tenant()).status).toBe("active");
  });

  it("a platform hold is never lifted by billing events", async () => {
    const operator = { userId: A.userId, isPlatformAdmin: true };
    await setTenantStatus(db, operator, { tenantId: A.tenantId, status: "suspended", reason: "Abuse report" });
    await send(event("subscription.charged", "sub_TEST0001", 1_800_200_000, { payment: { entity: { id: "pay_GHI789", amount: 100_00, currency: "INR" } } }));
    expect(await tenant()).toMatchObject({ status: "suspended", platformHold: true });
    await setTenantStatus(db, operator, { tenantId: A.tenantId, status: "active", reason: "Resolved" });
    expect(await tenant()).toMatchObject({ status: "active", platformHold: false });
  });

  it("unknown provider subscriptions are recorded and ignored", async () => {
    expect(await send(event("subscription.charged", "sub_UNKNOWN", 1_800_300_000))).toMatchObject({ outcome: "ignored" });
  });

  it("daily sweep: trial end → past_due + grace → suspended; idempotent", async () => {
    const C = await createTenantFixture(db, { hotelName: "Trial Hotel" });
    const s = await sub(C.tenantId);
    const afterTrial = new Date(s.trialEndsAt!.getTime() + 1000);
    await sweepSubscriptions(db, afterTrial);
    expect((await sub(C.tenantId)).status).toBe("past_due");
    expect((await tenant(C.tenantId)).status).toBe("past_due");
    await sweepSubscriptions(db, afterTrial); // no double transition
    const graceOver = new Date((await sub(C.tenantId)).graceEndsAt!.getTime() + 1000);
    await sweepSubscriptions(db, graceOver);
    expect((await tenant(C.tenantId)).status).toBe("suspended");
  });
});
