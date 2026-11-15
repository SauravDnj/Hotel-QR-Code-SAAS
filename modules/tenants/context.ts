import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import {
  permissions,
  rolePermissions,
  roles,
  tenantMemberships,
  tenants,
  userRoleAssignments,
} from "@/lib/db/schema";
import type { PermissionKey } from "@/lib/permissions/catalog";
import type { RoleGrant, TenantContext } from "@/lib/permissions/authorize";

/** Active tenant memberships for a user (for the tenant switcher). */
export async function listUserTenants(db: Db, userId: string) {
  return db
    .select({ tenantId: tenants.id, name: tenants.name, status: tenants.status })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, "active")))
    .orderBy(tenants.name);
}

/**
 * Builds the authorisation context for (user, tenant). Returns null when the user has
 * no active membership in that tenant, so a forged tenant id yields no access.
 */
export async function loadTenantContext(
  db: Db,
  userId: string,
  tenantId: string,
): Promise<TenantContext | null> {
  const [membership] = await db
    .select({
      membershipId: tenantMemberships.id,
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantStatus: tenants.status,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(
      and(
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, "active"),
      ),
    );
  if (!membership) return null;

  const rows = await db
    .select({
      assignmentId: userRoleAssignments.id,
      roleKey: roles.key,
      propertyId: userRoleAssignments.propertyId,
      permissionKey: permissions.key,
    })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        eq(userRoleAssignments.membershipId, membership.membershipId),
        eq(userRoleAssignments.tenantId, tenantId),
      ),
    );

  const byAssignment = new Map<string, RoleGrant & { permissions: Set<PermissionKey> }>();
  for (const r of rows) {
    let grant = byAssignment.get(r.assignmentId);
    if (!grant) {
      grant = { roleKey: r.roleKey, propertyId: r.propertyId, permissions: new Set() };
      byAssignment.set(r.assignmentId, grant);
    }
    grant.permissions.add(r.permissionKey as PermissionKey);
  }

  return {
    userId,
    membershipId: membership.membershipId,
    tenantId: membership.tenantId,
    tenantName: membership.tenantName,
    tenantStatus: membership.tenantStatus,
    grants: [...byAssignment.values()],
  };
}
