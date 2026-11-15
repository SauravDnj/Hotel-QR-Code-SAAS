import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { auditLogs, properties, roles, tenantMemberships, userRoleAssignments, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createProperty, getProperty, listProperties, updateProperty } from "@/modules/properties/service";
import { getTenantSettings, updateTenantSettings } from "@/modules/tenants/settings";
import { listTenantAuditLogs } from "@/modules/audit/service";
import { loadTenantContext } from "@/modules/tenants/context";
import { createTestDb, createTenantFixture } from "../helpers/db";

const propertyInput = (name: string) => ({
  name,
  country: "IN",
  timezone: "Asia/Kolkata",
  currency: "INR",
});

describe("tenant isolation (Tenant A vs Tenant B)", () => {
  let db: Db;
  let A: Awaited<ReturnType<typeof createTenantFixture>>;
  let B: Awaited<ReturnType<typeof createTenantFixture>>;

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Alpha Hotel" });
    B = await createTenantFixture(db, { hotelName: "Beta Hotel" });
  });

  it("lists only the caller's own properties", async () => {
    const listA = await listProperties(db, A.ctx);
    expect(listA.map((p) => p.tenantId)).toEqual([A.tenantId]);
    expect(listA.some((p) => p.id === B.propertyId)).toBe(false);
  });

  it("cannot read another tenant's property by id", async () => {
    await expect(getProperty(db, A.ctx, B.propertyId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("cannot update another tenant's property by id", async () => {
    await expect(updateProperty(db, A.ctx, B.propertyId, propertyInput("Hacked"))).rejects.toMatchObject({
      code: "not_found",
    });
    const [row] = await db.select().from(properties).where(eq(properties.id, B.propertyId));
    expect(row.name).toBe("Beta Hotel");
  });

  it("ignores a client-supplied tenantId when creating a property", async () => {
    const created = await createProperty(db, A.ctx, {
      ...propertyInput("Alpha Annex"),
      // @ts-expect-error simulating a tampered payload
      tenantId: B.tenantId,
    });
    expect(created.tenantId).toBe(A.tenantId);
  });

  it("tenant settings always resolve to the caller's own tenant", async () => {
    expect((await getTenantSettings(db, A.ctx)).id).toBe(A.tenantId);
    await updateTenantSettings(db, A.ctx, {
      name: "Alpha Renamed",
      legalName: "Alpha Pvt Ltd",
      contactEmail: "a@example.test",
      country: "IN",
      timezone: "Asia/Kolkata",
      currency: "INR",
    });
    expect((await getTenantSettings(db, B.ctx)).name).toBe("Beta Hotel");
  });

  it("audit log only shows the caller's tenant events", async () => {
    const logs = await listTenantAuditLogs(db, A.ctx);
    expect(logs.length).toBeGreaterThan(0);
    const ids = logs.map((l) => l.id);
    const foreign = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.tenantId, B.tenantId));
    expect(foreign.some((f) => ids.includes(f.id))).toBe(false);
  });

  it("a user gets no context for a tenant they are not a member of", async () => {
    expect(await loadTenantContext(db, A.userId, B.tenantId)).toBeNull();
  });

  it("the database rejects assigning Tenant B's property to a Tenant A membership", async () => {
    const [ownerRole] = await db.select().from(roles).where(and(isNull(roles.tenantId), eq(roles.key, "owner")));
    await expect(
      db.insert(userRoleAssignments).values({
        tenantId: A.tenantId,
        membershipId: A.ctx.membershipId,
        roleId: ownerRole.id,
        propertyId: B.propertyId,
      }),
    ).rejects.toThrow();
  });
});

describe("role and property scope", () => {
  let db: Db;
  let A: Awaited<ReturnType<typeof createTenantFixture>>;

  async function addStaff(roleKey: string, propertyId: string | null) {
    const [user] = await db
      .insert(users)
      .values({ email: `${roleKey}-${Math.random()}@example.test`, name: roleKey, passwordHash: await hashPassword("x".repeat(12)) })
      .returning();
    const [m] = await db.insert(tenantMemberships).values({ tenantId: A.tenantId, userId: user.id }).returning();
    const [role] = await db.select().from(roles).where(and(isNull(roles.tenantId), eq(roles.key, roleKey)));
    await db.insert(userRoleAssignments).values({ tenantId: A.tenantId, membershipId: m.id, roleId: role.id, propertyId });
    return (await loadTenantContext(db, user.id, A.tenantId))!;
  }

  beforeAll(async () => {
    db = await createTestDb();
    A = await createTenantFixture(db, { hotelName: "Scope Hotel" });
  });

  it("housekeeping cannot change tenant settings or view the audit log", async () => {
    const hk = await addStaff("housekeeping", null);
    await expect(
      updateTenantSettings(db, hk, {
        name: "x",
        legalName: "x",
        contactEmail: "x@example.test",
        country: "IN",
        timezone: "Asia/Kolkata",
        currency: "INR",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(listTenantAuditLogs(db, hk)).rejects.toMatchObject({ code: "forbidden" });
    await expect(createProperty(db, hk, propertyInput("HK Property"))).rejects.toMatchObject({ code: "forbidden" });
  });

  it("property-scoped staff only see their assigned property", async () => {
    const second = await createProperty(db, A.ctx, propertyInput("Second Branch"));
    const rec = await addStaff("receptionist", second.id);
    const visible = await listProperties(db, rec);
    expect(visible.map((p) => p.id)).toEqual([second.id]);
    await expect(getProperty(db, rec, A.propertyId)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("suspended tenants cannot write", async () => {
    await expect(
      createProperty(db, { ...A.ctx, tenantStatus: "suspended" }, propertyInput("Blocked")),
    ).rejects.toMatchObject({ code: "tenant_inactive" });
  });

  it("rejects duplicate property names in the same tenant", async () => {
    await expect(createProperty(db, A.ctx, propertyInput("Scope Hotel"))).rejects.toMatchObject({ code: "conflict" });
  });
});
