import type { RoleGrant, TenantContext } from "./authorize";
import type { PermissionKey } from "./catalog";

/**
 * Department scope (RBAC_PERMISSIONS.md "Scope": optional property + optional department).
 *
 * Per role assignment (grant):
 * - an explicit department on the assignment limits it to that one department;
 * - otherwise a department role implies its department (housekeeping → Housekeeping, …);
 * - owners, managers, reception and custom roles cover every department of their properties
 *   (a custom role's reach is controlled by its permissions and the assignment's scope).
 * Effective scope is the union of grants holding the permission for that property.
 */
const ROLE_DEPARTMENTS: Record<string, readonly string[]> = {
  housekeeping: ["housekeeping"],
  room_service: ["room_service"],
  maintenance: ["maintenance"],
  security: ["security"],
};

export interface DepartmentSet {
  keys: ReadonlySet<string>;
  ids: ReadonlySet<string>;
}
export type DepartmentScope = "all" | DepartmentSet;

/** Departments one grant covers. */
export function grantDepartments(g: Pick<RoleGrant, "roleKey" | "departmentId">): DepartmentScope {
  if (g.departmentId) return { keys: new Set(), ids: new Set([g.departmentId]) };
  const implied = ROLE_DEPARTMENTS[g.roleKey];
  return implied ? { keys: new Set(implied), ids: new Set() } : "all";
}

/** Departments the user may handle in a property, for grants holding `permission`. */
export function departmentScope(ctx: TenantContext, permission: PermissionKey, propertyId: string): DepartmentScope {
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const g of ctx.grants) {
    if (!g.permissions.has(permission)) continue;
    if (g.propertyId !== null && g.propertyId !== propertyId) continue;
    const d = grantDepartments(g);
    if (d === "all") return "all";
    d.keys.forEach((k) => keys.add(k));
    d.ids.forEach((i) => ids.add(i));
  }
  return { keys, ids };
}

export function inDepartmentScope(scope: DepartmentScope, dept: { id: string; key: string }): boolean {
  return scope === "all" || scope.keys.has(dept.key) || scope.ids.has(dept.id);
}

export function isEmptyScope(scope: DepartmentScope): boolean {
  return scope !== "all" && scope.keys.size === 0 && scope.ids.size === 0;
}
