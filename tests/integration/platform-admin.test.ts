import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { auditLogs, plans, subscriptions, tenantMemberships, tenants, users } from "@/lib/db/schema";
import { assertTenantWritable, can, canWrite } from "@/lib/permissions/authorize";
import { getResetToken } from "@/modules/account/security";
import {
  activateManually,
  changeTenantPlan,
  createTenantAsOperator,
  getTenantDetail,
  listPlatformAudit,
  listPlatformUsers,
  platformOverview,
  searchTenants,
  setMembershipStatusAsOperator,
  setPlatformAdmin,
  setUserStatus,
  startSupportSession,
  updateTenantProfile,
} from "@/modules/platform/admin";
import { createFloor } from "@/modules/rooms/floors";
import { listRooms } from "@/modules/rooms/rooms";
import { loadSupportContext, loadTenantContext } from "@/modules/tenants/context";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

describe("SaaS super admin console", () => {
  let db: Db;
  let A: TenantFixture;
  let B: TenantFixture;
  const op = () => ({ userId: B.userId, isPlatformAdmin: true });
  const notOp = () => ({ userId: A.userId, isPlatformAdmin: false });

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Alpha Hotel" });
    B = await createTenantFixture(db, { hotelName: "Beta Operator Hotel" });
    await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, B.userId));
  });

  it("refuses every console function to non-operators", async () => {
    await expect(platformOverview(db, notOp())).rejects.toMatchObject({ code: "forbidden" });
    await expect(searchTenants(db, notOp())).rejects.toMatchObject({ code: "forbidden" });
    await expect(getTenantDetail(db, notOp(), A.tenantId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(listPlatformUsers(db, notOp())).rejects.toMatchObject({ code: "forbidden" });
    await expect(setUserStatus(db, notOp(), B.userId, { status: "disabled", reason: "nope" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("lists and filters every hotel with its staff and room counts", async () => {
    await addStaff(db, A, "receptionist", A.propertyId);
    const all = await searchTenants(db, op());
    expect(all.map((t) => t.name)).toEqual(expect.arrayContaining(["Alpha Hotel", "Beta Operator Hotel"]));
    const alpha = (await searchTenants(db, op(), { q: "alpha" }))[0];
    expect(alpha).toMatchObject({ name: "Alpha Hotel", staff: 2, subscriptionStatus: "trialing" });
    expect(await searchTenants(db, op(), { status: "suspended" })).toHaveLength(0);
    // Wildcards in a search are literal.
    expect(await searchTenants(db, op(), { q: "%" })).toHaveLength(0);
    const o = await platformOverview(db, op());
    expect(o.hotels).toBeGreaterThanOrEqual(2);
    expect(o.platformAdmins).toBe(1);
  });

  it("shows a hotel's detail: staff with roles, properties, subscription", async () => {
    const d = await getTenantDetail(db, op(), A.tenantId);
    expect(d.tenant.name).toBe("Alpha Hotel");
    expect(d.properties).toHaveLength(1);
    expect(d.staff.map((s) => s.roles[0]?.roleKey).sort()).toEqual(["owner", "receptionist"]);
    expect(d.subscription.status).toBe("trialing");
    await expect(getTenantDetail(db, op(), "not-a-uuid")).rejects.toMatchObject({ code: "not_found" });
  });

  it("creates a hotel with an owner who sets their own password via a one-time link", async () => {
    const [pro] = await db.select().from(plans).where(eq(plans.key, "professional"));
    const created = await createTenantAsOperator(db, op(), {
      hotelName: "Gamma Resort",
      legalName: "Gamma Pvt Ltd",
      ownerName: "Gamma Owner",
      email: "Owner@Gamma.example.test",
      country: "IN",
      timezone: "Asia/Kolkata",
      currency: "INR",
      planId: pro?.id ?? "",
    });
    const reset = await getResetToken(db, created.token);
    expect(reset?.email).toBe("owner@gamma.example.test");
    const ctx = await loadTenantContext(db, created.userId, created.tenantId);
    expect(ctx && can(ctx, "tenant.manage")).toBe(true);
    if (pro) expect((await db.select().from(subscriptions).where(eq(subscriptions.tenantId, created.tenantId)))[0].planId).toBe(pro.id);
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, created.tenantId), eq(auditLogs.action, "tenant.created")));
    expect(audit).toMatchObject({ actorUserId: B.userId, actorType: "platform_admin" });
    await expect(
      createTenantAsOperator(db, op(), { hotelName: "Dup", legalName: "Dup", ownerName: "Dup", email: "owner@gamma.example.test", country: "IN", timezone: "Asia/Kolkata", currency: "INR" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("edits hotel details, changes the plan and marks a subscription paid (all audited)", async () => {
    await updateTenantProfile(db, op(), A.tenantId, {
      name: "Alpha Grand",
      legalName: "Alpha Pvt Ltd",
      contactEmail: "desk@alpha.example.test",
      country: "IN",
      timezone: "Asia/Kolkata",
      reason: "Owner asked by phone",
    });
    expect((await db.select().from(tenants).where(eq(tenants.id, A.tenantId)))[0].name).toBe("Alpha Grand");

    const [starter] = await db.select().from(plans).where(eq(plans.key, "starter"));
    if (starter) {
      await changeTenantPlan(db, op(), A.tenantId, { planId: starter.id, reason: "Downgrade on request" });
      expect((await db.select().from(subscriptions).where(eq(subscriptions.tenantId, A.tenantId)))[0].planId).toBe(starter.id);
    }
    await activateManually(db, op(), A.tenantId, { days: "30", reason: "Bank transfer UTR123" });
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, A.tenantId));
    expect(sub.status).toBe("active");
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);
    expect((await db.select().from(tenants).where(eq(tenants.id, A.tenantId)))[0].status).toBe("active");

    const actions = (await listPlatformAudit(db, op(), { tenantId: A.tenantId, platformOnly: true })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["platform.tenant_updated", "platform.subscription_activated"]));
    await expect(activateManually(db, op(), A.tenantId, { days: "0", reason: "x" })).rejects.toThrow();
  });

  it("turns staff access off/on but always keeps an active owner", async () => {
    const d = await getTenantDetail(db, op(), A.tenantId);
    const owner = d.staff.find((s) => s.roles.some((r) => r.roleKey === "owner"))!;
    const recep = d.staff.find((s) => s.roles.some((r) => r.roleKey === "receptionist"))!;
    await expect(
      setMembershipStatusAsOperator(db, op(), A.tenantId, owner.membershipId, { status: "disabled", reason: "test" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await setMembershipStatusAsOperator(db, op(), A.tenantId, recep.membershipId, { status: "disabled", reason: "Left the hotel" });
    expect(await loadTenantContext(db, recep.userId, A.tenantId)).toBeNull();
    // Another tenant's id with this membership is "not found".
    await expect(
      setMembershipStatusAsOperator(db, op(), B.tenantId, recep.membershipId, { status: "active", reason: "wrong hotel" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await setMembershipStatusAsOperator(db, op(), A.tenantId, recep.membershipId, { status: "active", reason: "Rehired" });
    expect(await loadTenantContext(db, recep.userId, A.tenantId)).not.toBeNull();
    const [m] = await db.select().from(tenantMemberships).where(eq(tenantMemberships.id, recep.membershipId));
    expect(m.status).toBe("active");
  });

  it("lists all users and blocks / unblocks logins, never your own", async () => {
    const list = await listPlatformUsers(db, op(), { q: "example.test" });
    const alphaOwner = list.find((u) => u.id === A.userId)!;
    expect(alphaOwner.hotels[0]).toMatchObject({ tenantId: A.tenantId, roles: "Hotel Owner" });
    expect((await listPlatformUsers(db, op(), { type: "admins" })).map((u) => u.id)).toEqual([B.userId]);

    await expect(setUserStatus(db, op(), B.userId, { status: "disabled", reason: "self" })).rejects.toMatchObject({ code: "forbidden" });
    const before = (await db.select().from(users).where(eq(users.id, A.userId)))[0].sessionVersion;
    await setUserStatus(db, op(), A.userId, { status: "disabled", reason: "Fraud report" });
    const after = (await db.select().from(users).where(eq(users.id, A.userId)))[0];
    expect(after.status).toBe("disabled");
    expect(after.sessionVersion).toBe(before + 1);
    await setUserStatus(db, op(), A.userId, { status: "active", reason: "Cleared" });
  });

  it("grants and removes super admin; you can't remove yourself", async () => {
    await expect(setPlatformAdmin(db, op(), B.userId, { grant: false, reason: "self" })).rejects.toMatchObject({ code: "forbidden" });
    await setPlatformAdmin(db, op(), A.userId, { grant: true, reason: "New ops hire" });
    expect((await db.select().from(users).where(eq(users.id, A.userId)))[0].isPlatformAdmin).toBe(true);
    await setPlatformAdmin(db, op(), A.userId, { grant: false, reason: "Test done" });
    expect((await db.select().from(users).where(eq(users.id, A.userId)))[0].isPlatformAdmin).toBe(false);
  });

  it("support view is read-only: view permissions only and every write guard refuses", async () => {
    await startSupportSession(db, op(), A.tenantId, { reason: "Ticket #42" });
    const ctx = (await loadSupportContext(db, B.userId, A.tenantId))!;
    expect(ctx.supportMode).toBe(true);
    expect(can(ctx, "room.view", { propertyId: A.propertyId })).toBe(true);
    expect(can(ctx, "room.manage", { propertyId: A.propertyId })).toBe(false);
    expect(can(ctx, "staff.manage")).toBe(false);
    expect(canWrite(ctx, "room.view", { propertyId: A.propertyId })).toBe(false);
    expect(() => assertTenantWritable(ctx)).toThrow(/read-only/);
    // Reads work; writes are refused.
    await expect(listRooms(db, ctx, A.propertyId, {} as never)).resolves.toBeTruthy();
    await expect(createFloor(db, ctx, A.propertyId, { name: "Hack floor" })).rejects.toMatchObject({ code: "forbidden" });
    expect(await loadSupportContext(db, B.userId, crypto.randomUUID())).toBeNull();
    const [audit] = await listPlatformAudit(db, op(), { tenantId: A.tenantId, q: "support_view" });
    expect(audit).toMatchObject({ action: "platform.support_view_started", actorEmail: expect.any(String) });
  });
});
