import { describe, expect, it } from "vitest";
import {
  assertTenantWritable,
  authorize,
  can,
  propertyScope,
  type TenantContext,
} from "@/lib/permissions/authorize";
import { SYSTEM_ROLES, type PermissionKey } from "@/lib/permissions/catalog";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function ctx(grants: { role: keyof typeof SYSTEM_ROLES; propertyId: string | null }[], status: TenantContext["tenantStatus"] = "active"): TenantContext {
  return {
    userId: "u",
    membershipId: "m",
    tenantId: "t",
    tenantName: "T",
    tenantStatus: status,
    grants: grants.map((g) => ({
      roleKey: g.role,
      propertyId: g.propertyId,
      permissions: new Set<PermissionKey>(SYSTEM_ROLES[g.role].permissions),
    })),
  };
}

describe("authorize / can", () => {
  it("denies by default when the user has no grants", () => {
    expect(can(ctx([]), "property.view")).toBe(false);
    expect(() => authorize(ctx([]), "property.view")).toThrowError(/permission/);
  });

  it("owner has every tenant permission", () => {
    const owner = ctx([{ role: "owner", propertyId: null }]);
    expect(can(owner, "billing.manage")).toBe(true);
    expect(can(owner, "tenant.manage")).toBe(true);
  });

  it("housekeeping cannot touch billing, tenant settings or audit", () => {
    const hk = ctx([{ role: "housekeeping", propertyId: null }]);
    expect(can(hk, "billing.view")).toBe(false);
    expect(can(hk, "billing.manage")).toBe(false);
    expect(can(hk, "tenant.manage")).toBe(false);
    expect(can(hk, "audit.view")).toBe(false);
    expect(can(hk, "housekeeping.manage")).toBe(true);
  });

  it("manager cannot manage tenant, billing or roles", () => {
    const m = ctx([{ role: "manager", propertyId: null }]);
    expect(can(m, "tenant.manage")).toBe(false);
    expect(can(m, "billing.manage")).toBe(false);
    expect(can(m, "role.manage")).toBe(false);
    expect(can(m, "report.view")).toBe(true);
  });

  it("property-scoped grants only apply to that property", () => {
    const r = ctx([{ role: "receptionist", propertyId: P1 }]);
    expect(can(r, "stay.check_in", { propertyId: P1 })).toBe(true);
    expect(can(r, "stay.check_in", { propertyId: P2 })).toBe(false);
    // A property-scoped grant never satisfies a tenant-wide check.
    expect(can(r, "stay.check_in")).toBe(false);
  });

  it("effective permissions are the union of grants", () => {
    const u = ctx([
      { role: "housekeeping", propertyId: P1 },
      { role: "receptionist", propertyId: P2 },
    ]);
    expect(can(u, "housekeeping.manage", { propertyId: P1 })).toBe(true);
    expect(can(u, "housekeeping.manage", { propertyId: P2 })).toBe(false);
    expect(can(u, "stay.check_out", { propertyId: P2 })).toBe(true);
  });

  it("propertyScope returns 'all' for tenant-wide grants and ids otherwise", () => {
    expect(propertyScope(ctx([{ role: "owner", propertyId: null }]), "property.view")).toBe("all");
    expect(propertyScope(ctx([{ role: "maintenance", propertyId: P1 }]), "property.view")).toEqual([P1]);
    expect(propertyScope(ctx([{ role: "maintenance", propertyId: P1 }]), "billing.view")).toEqual([]);
  });

  it("suspended and cancelled tenants are read-only", () => {
    expect(() => assertTenantWritable(ctx([], "suspended"))).toThrow(/not active/);
    expect(() => assertTenantWritable(ctx([], "cancelled"))).toThrow(/not active/);
    expect(() => assertTenantWritable(ctx([], "trialing"))).not.toThrow();
    expect(() => assertTenantWritable(ctx([], "past_due"))).not.toThrow();
  });
});
