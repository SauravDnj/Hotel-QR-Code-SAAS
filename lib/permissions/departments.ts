import type { TenantContext } from "./authorize";
import type { PermissionKey } from "./catalog";

/**
 * Which departments a staff member works for, per property.
 *
 * Until Phase 5 adds explicit staff↔department assignments, a system role implies its
 * department (housekeeping staff see Housekeeping requests, …). Owners, managers and
 * reception see every department. Unknown/custom roles get no department by default
 * (deny by default).
 */
const ROLE_DEPARTMENTS: Record<string, "all" | readonly string[]> = {
  owner: "all",
  manager: "all",
  receptionist: "all",
  housekeeping: ["housekeeping"],
  room_service: ["room_service"],
  maintenance: ["maintenance"],
  security: ["security"],
};

/** Departments implied by one role (undefined = none). */
export function roleDepartments(roleKey: string): "all" | readonly string[] {
  return ROLE_DEPARTMENTS[roleKey] ?? [];
}

export type DepartmentScope = "all" | ReadonlySet<string>;

/** Department keys the user may handle in a property, for grants holding `permission`. */
export function departmentScope(ctx: TenantContext, permission: PermissionKey, propertyId: string): DepartmentScope {
  const keys = new Set<string>();
  for (const g of ctx.grants) {
    if (!g.permissions.has(permission)) continue;
    if (g.propertyId !== null && g.propertyId !== propertyId) continue;
    const depts = ROLE_DEPARTMENTS[g.roleKey];
    if (depts === "all") return "all";
    depts?.forEach((d) => keys.add(d));
  }
  return keys;
}

export function inDepartmentScope(scope: DepartmentScope, departmentKey: string): boolean {
  return scope === "all" || scope.has(departmentKey);
}
