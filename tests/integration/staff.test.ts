import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { auditLogs, rateLimits, requestStatusHistory, roles, serviceRequests, users } from "@/lib/db/schema";
import { verifyCredentials } from "@/lib/auth/credentials";
import { createDepartment, listDepartments } from "@/modules/departments/service";
import { createProperty } from "@/modules/properties/service";
import { getRoomQr } from "@/modules/qr/service";
import { escalateOverdue } from "@/modules/requests/escalation";
import { submitGuestRequest } from "@/modules/requests/guest";
import { getRequestForStaff, inboxMarker, listInbox, transitionRequest } from "@/modules/requests/staff";
import { createCategory } from "@/modules/rooms/categories";
import { createFloor } from "@/modules/rooms/floors";
import { createRoom } from "@/modules/rooms/rooms";
import { createDefaultServices, createService, listServices } from "@/modules/services/catalog";
import { changePassword, getProfile, updateNotificationPrefs } from "@/modules/staff/profile";
import { createRole, deleteRole, listRoles, updateRole } from "@/modules/staff/roles";
import {
  acceptInvitation,
  addAssignment,
  createInvitation,
  getInvitation,
  getMember,
  listGrantableRoles,
  listStaff,
  removeAssignment,
  revokeInvitation,
  setMemberStatus,
} from "@/modules/staff/service";
import { loadTenantContext } from "@/modules/tenants/context";
import { addStaff, createTenantFixture, createTestDb, type TenantFixture } from "../helpers/db";

const roleId = async (db: Db, key: string) =>
  (await db.select().from(roles).where(and(isNull(roles.tenantId), eq(roles.key, key))))[0]!.id;

describe("staff, roles, invitations and escalation", () => {
  let db: Db;
  let A: TenantFixture;
  let B: TenantFixture;
  let qr: string;

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Staff Hotel" });
    B = await createTenantFixture(db, { hotelName: "Other Hotel" });
    const floor = await createFloor(db, A.ctx, A.propertyId, { name: "F1" });
    const cat = await createCategory(db, A.ctx, A.propertyId, { name: "Std", capacity: 2 });
    const room = await createRoom(db, A.ctx, A.propertyId, { roomCode: "101", floorId: floor.id, categoryId: cat.id });
    await createDefaultServices(db, A.ctx, A.propertyId);
    qr = (await getRoomQr(db, A.ctx, A.propertyId, room.id)).active!.url.split("/r/")[1]!;
  });
  beforeEach(async () => {
    await db.delete(rateLimits);
  });

  const invite = async (email: string, role: string, scope: { propertyId?: string; departmentId?: string } = {}) =>
    createInvitation(db, A.ctx, { email, name: "New Person", roleId: await roleId(db, role), ...scope });

  it("invites a new person who sets a password and gets exactly the invited role", async () => {
    const inv = await invite("hk1@example.test", "housekeeping", { propertyId: A.propertyId });
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const view = await getInvitation(db, inv.token);
    expect(view).toMatchObject({ email: "hk1@example.test", hotelName: "Staff Hotel", roleName: "Housekeeping", accountExists: false });

    await expect(acceptInvitation(db, inv.token, { name: "Hema", password: "short" })).rejects.toThrow();
    const accepted = await acceptInvitation(db, inv.token, { name: "Hema", password: "correct horse battery" });
    const ctx = (await loadTenantContext(db, accepted.userId, A.tenantId))!;
    expect(ctx.grants).toHaveLength(1);
    expect(ctx.grants[0]).toMatchObject({ roleKey: "housekeeping", propertyId: A.propertyId, departmentId: null });
    expect(await verifyCredentials(db, { email: "hk1@example.test", password: "correct horse battery" }, null)).not.toBeNull();

    // Single use.
    expect(await getInvitation(db, inv.token)).toBeNull();
    await expect(acceptInvitation(db, inv.token, { password: "correct horse battery" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("an existing account must prove its password to join another hotel", async () => {
    const other = await createTenantFixture(db, { hotelName: "Elsewhere" });
    const [u] = await db.select().from(users).where(eq(users.id, other.userId));
    const inv = await invite(u.email, "receptionist");
    expect(await getInvitation(db, inv.token)).toMatchObject({ accountExists: true });
    await expect(acceptInvitation(db, inv.token, { password: "wrong password!!" })).rejects.toThrow(/doesn't match/);
    await acceptInvitation(db, inv.token, { password: "correct horse battery" });
    expect(await loadTenantContext(db, other.userId, A.tenantId)).not.toBeNull();
    // Their own hotel is untouched.
    expect((await loadTenantContext(db, other.userId, other.tenantId))!.grants[0].roleKey).toBe("owner");
  });

  it("invitations: revoked, expired, duplicate and existing members are refused", async () => {
    const inv = await invite("rev@example.test", "maintenance");
    await expect(invite("rev@example.test", "maintenance")).rejects.toMatchObject({ code: "conflict" });
    await revokeInvitation(db, A.ctx, inv.id);
    expect(await getInvitation(db, inv.token)).toBeNull();
    await expect(invite("hk1@example.test", "maintenance")).rejects.toMatchObject({ code: "conflict" }); // already staff
    expect(await getInvitation(db, "A".repeat(43))).toBeNull();
    // Another hotel cannot revoke ours.
    const inv2 = await invite("rev2@example.test", "maintenance");
    await expect(revokeInvitation(db, B.ctx, inv2.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("blocks privilege escalation: a manager cannot grant owner powers or create roles", async () => {
    const manager = await addStaff(db, A, "manager", null);
    await expect(
      createInvitation(db, manager, { email: "boss@example.test", name: "X", roleId: await roleId(db, "owner") }),
    ).rejects.toMatchObject({ code: "forbidden" });
    // A manager may invite a receptionist.
    await expect(
      createInvitation(db, manager, { email: "frontdesk@example.test", name: "Y", roleId: await roleId(db, "receptionist") }),
    ).resolves.toBeDefined();
    const grantable = (await listGrantableRoles(db, manager)).map((r) => r.key);
    expect(grantable).not.toContain("owner");
    expect(grantable).toContain("receptionist");
    await expect(createRole(db, manager, { name: "Sneaky", permissions: ["billing.manage"] })).rejects.toMatchObject({ code: "forbidden" });
    // A property-scoped manager cannot grant tenant-wide roles.
    const p2 = await createProperty(db, A.ctx, { name: "Annex", country: "IN", timezone: "Asia/Kolkata", currency: "INR" });
    const annexMgr = await addStaff(db, A, "manager", p2.id);
    await expect(
      createInvitation(db, annexMgr, { email: "wide@example.test", name: "Z", roleId: await roleId(db, "receptionist") }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      createInvitation(db, annexMgr, { email: "annex@example.test", name: "Z", roleId: await roleId(db, "receptionist"), propertyId: p2.id }),
    ).resolves.toBeDefined();
  });

  it("cannot change yourself or someone with more access; owners can manage owners", async () => {
    await expect(setMemberStatus(db, A.ctx, A.ctx.membershipId, "disabled")).rejects.toMatchObject({ code: "forbidden" });
    const manager = await addStaff(db, A, "manager", null);
    await expect(setMemberStatus(db, manager, A.ctx.membershipId, "disabled")).rejects.toMatchObject({ code: "forbidden" });
    const ownerAssignment = (await getMember(db, A.ctx, A.ctx.membershipId)).assignments.find((a) => a.roleKey === "owner")!;
    await expect(removeAssignment(db, manager, A.ctx.membershipId, ownerAssignment.id)).rejects.toMatchObject({ code: "forbidden" });

    // A second owner may remove and restore the first owner's role (another owner remains).
    const owner2 = await addStaff(db, A, "owner", null);
    await removeAssignment(db, owner2, A.ctx.membershipId, ownerAssignment.id);
    expect((await loadTenantContext(db, A.userId, A.tenantId))!.grants.some((g) => g.roleKey === "owner")).toBe(false);
    await addAssignment(db, owner2, A.ctx.membershipId, { roleId: await roleId(db, "owner") });
    A = { ...A, ctx: (await loadTenantContext(db, A.userId, A.tenantId))! };
    expect(A.ctx.grants.some((g) => g.roleKey === "owner")).toBe(true);
    await expect(addAssignment(db, owner2, A.ctx.membershipId, { roleId: await roleId(db, "owner") })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("deactivating a member removes access on the next request", async () => {
    const rs = await addStaff(db, A, "room_service", null);
    await setMemberStatus(db, A.ctx, rs.membershipId, "disabled");
    expect(await loadTenantContext(db, rs.userId, A.tenantId)).toBeNull();
    await setMemberStatus(db, A.ctx, rs.membershipId, "active");
    expect(await loadTenantContext(db, rs.userId, A.tenantId)).not.toBeNull();
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "staff.deactivated"));
    expect(audit.length).toBeGreaterThan(0);
  });

  it("department-scoped assignment limits the inbox to that department", async () => {
    const spa = await createDepartment(db, A.ctx, A.propertyId, { name: "Spa" });
    const svc = await createService(db, A.ctx, A.propertyId, { name: "Spa booking", departmentId: spa.id, enabled: "on" });
    const { items } = await listServices(db, A.ctx, A.propertyId);
    const water = items.find((i) => i.key === "water")!;
    const sub = (serviceId: string) =>
      submitGuestRequest(db, qr, { serviceId, idempotencyKey: crypto.randomUUID(), quantity: "1" }, { ip: null });
    const spaReq = await sub(svc.id);
    const waterReq = await sub(water.id);
    if (spaReq.kind !== "ok" || waterReq.kind !== "ok") throw new Error("setup");

    // A manager limited to the Spa department of this property.
    const m = await addStaff(db, A, "manager", null);
    const mem = await getMember(db, A.ctx, m.membershipId);
    await removeAssignment(db, A.ctx, m.membershipId, mem.assignments[0].id);
    await addAssignment(db, A.ctx, m.membershipId, { roleId: await roleId(db, "manager"), propertyId: A.propertyId, departmentId: spa.id });
    const spaMgr = (await loadTenantContext(db, m.userId, A.tenantId))!;
    const ids = (await listInbox(db, spaMgr)).map((r) => r.id);
    expect(ids).toContain(spaReq.requestId);
    expect(ids).not.toContain(waterReq.requestId);
    await expect(getRequestForStaff(db, spaMgr, waterReq.requestId)).rejects.toMatchObject({ code: "not_found" });
    await transitionRequest(db, spaMgr, spaReq.requestId, "acknowledge");

    // Department must belong to the chosen property.
    const p3 = await createProperty(db, A.ctx, { name: "Third", country: "IN", timezone: "Asia/Kolkata", currency: "INR" });
    await expect(
      addAssignment(db, A.ctx, m.membershipId, { roleId: await roleId(db, "manager"), propertyId: p3.id, departmentId: spa.id }),
    ).rejects.toThrow(/department of that property/);
    await expect(
      addAssignment(db, A.ctx, m.membershipId, { roleId: await roleId(db, "manager"), departmentId: spa.id }),
    ).rejects.toThrow(/property for a department/);
    const depts = await listDepartments(db, A.ctx, A.propertyId);
    expect(depts.some((d) => d.id === spa.id)).toBe(true);
  });

  it("custom roles: explicit permissions, editable, deletable only when unused; tenant-private", async () => {
    const role = await createRole(db, A.ctx, { name: "Night auditor", permissions: ["request.view", "audit.view"] });
    const listed = (await listRoles(db, A.ctx)).find((r) => r.id === role.id)!;
    expect(listed).toMatchObject({ custom: true, permissions: expect.arrayContaining(["request.view", "audit.view"]) });
    expect((await listRoles(db, B.ctx)).some((r) => r.id === role.id)).toBe(false);
    await expect(updateRole(db, B.ctx, role.id, { name: "x", permissions: ["audit.view"] })).rejects.toMatchObject({ code: "not_found" });

    const inv = await createInvitation(db, A.ctx, { email: "night@example.test", name: "Nina", roleId: role.id });
    await expect(deleteRole(db, A.ctx, role.id)).rejects.toMatchObject({ code: "conflict" });
    const acc = await acceptInvitation(db, inv.token, { password: "correct horse battery" });
    const ctx = (await loadTenantContext(db, acc.userId, A.tenantId))!;
    expect([...ctx.grants[0].permissions].sort()).toEqual(["audit.view", "request.view"]);

    await updateRole(db, A.ctx, role.id, { name: "Night auditor", permissions: ["audit.view"] });
    const ctx2 = (await loadTenantContext(db, acc.userId, A.tenantId))!;
    expect([...ctx2.grants[0].permissions]).toEqual(["audit.view"]); // takes effect immediately

    // Another tenant's custom role cannot be granted here.
    const bRole = await createRole(db, B.ctx, { name: "B only", permissions: ["audit.view"] });
    await expect(createInvitation(db, A.ctx, { email: "x9@example.test", name: "X", roleId: bRole.id })).rejects.toThrow(/Choose a role/);
    // System roles cannot be edited or deleted through this API.
    await expect(deleteRole(db, A.ctx, await roleId(db, "manager"))).rejects.toMatchObject({ code: "not_found" });
  });

  it("staff list is tenant-scoped and needs staff.view", async () => {
    const staff = await listStaff(db, A.ctx);
    expect(staff.length).toBeGreaterThan(3);
    expect((await listStaff(db, B.ctx)).every((s) => !staff.some((a) => a.membershipId === s.membershipId))).toBe(true);
    const hk = await addStaff(db, A, "housekeeping", null);
    await expect(listStaff(db, hk)).rejects.toMatchObject({ code: "forbidden" });
    await expect(getMember(db, B.ctx, A.ctx.membershipId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("profile: own preferences only; password change signs out every session", async () => {
    const rs = await addStaff(db, A, "room_service", null);
    await updateNotificationPrefs(db, rs, { notifySound: "", notifyScope: "mine" });
    expect(await getProfile(db, rs)).toMatchObject({ notifySound: false, notifyScope: "mine" });
    expect(await getProfile(db, A.ctx)).toMatchObject({ notifyScope: "all" });

    const [before] = await db.select().from(users).where(eq(users.id, A.userId));
    await expect(changePassword(db, A.ctx, { currentPassword: "nope", newPassword: "another long password" })).rejects.toThrow(/incorrect/);
    await changePassword(db, A.ctx, { currentPassword: "correct horse battery", newPassword: "another long password" });
    const [after] = await db.select().from(users).where(eq(users.id, A.userId));
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
  });

  it("escalates unaccepted requests once, after the target time", async () => {
    const { items } = await listServices(db, A.ctx, A.propertyId);
    const reception = items.find((i) => i.key === "reception")!; // target 10 min
    const res = await submitGuestRequest(db, qr, { serviceId: reception.id, idempotencyKey: crypto.randomUUID() }, { ip: null });
    if (res.kind !== "ok") throw new Error("setup");
    const [r] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, res.requestId));
    expect(r.escalateAfterMinutes).toBe(10);

    expect(await escalateOverdue(db, new Date(r.submittedAt.getTime() + 9 * 60_000))).toBe(0);
    expect(await escalateOverdue(db, new Date(r.submittedAt.getTime() + 11 * 60_000))).toBeGreaterThanOrEqual(1);
    await escalateOverdue(db, new Date(r.submittedAt.getTime() + 60 * 60_000)); // may escalate other requests, not this one again
    const hist = await db.select().from(requestStatusHistory).where(eq(requestStatusHistory.requestId, r.id));
    expect(hist.filter((h) => h.note?.startsWith("Escalated"))).toHaveLength(1);
    expect((await inboxMarker(db, A.ctx)).escalatedCount).toBeGreaterThan(0);
  });
});
