import { AppError, forbidden } from "@/lib/errors";
import type { TenantStatus } from "@/lib/db/schema/enums";
import type { PermissionKey } from "./catalog";

export interface RoleGrant {
  roleKey: string;
  /** null = applies to every property in the tenant. */
  propertyId: string | null;
  /** null/undefined = every department the role covers (see lib/permissions/departments.ts). */
  departmentId?: string | null;
  permissions: ReadonlySet<PermissionKey>;
}

/**
 * Everything needed to authorise a staff action. Always built on the server from
 * the authenticated session + database (see lib/auth/tenant-context.ts), never
 * from client input.
 */
export interface TenantContext {
  userId: string;
  membershipId: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  grants: readonly RoleGrant[];
  /** SaaS operator's audited, read-only support view (no membership; view grants only). */
  supportMode?: boolean;
}

export interface ResourceScope {
  propertyId?: string;
}

/** Union of grants that apply to the requested scope. Deny by default. */
export function can(ctx: TenantContext, permission: PermissionKey, scope: ResourceScope = {}): boolean {
  return ctx.grants.some(
    (g) =>
      g.permissions.has(permission) &&
      (g.propertyId === null || (scope.propertyId !== undefined && g.propertyId === scope.propertyId)),
  );
}

export function authorize(ctx: TenantContext, permission: PermissionKey, scope: ResourceScope = {}): void {
  if (!can(ctx, permission, scope)) throw forbidden();
}

/**
 * Which properties the user may act on for a permission:
 * "all" for tenant-wide grants, otherwise the explicit list (possibly empty).
 */
export function propertyScope(ctx: TenantContext, permission: PermissionKey): "all" | string[] {
  const ids = new Set<string>();
  for (const g of ctx.grants) {
    if (!g.permissions.has(permission)) continue;
    if (g.propertyId === null) return "all";
    ids.add(g.propertyId);
  }
  return [...ids];
}


const WRITABLE: TenantStatus[] = ["trialing", "active", "past_due"];

/** UI helper: show edit controls only when the server would allow the write. */
export function canWrite(ctx: TenantContext, permission: PermissionKey, scope: ResourceScope = {}): boolean {
  return !ctx.supportMode && WRITABLE.includes(ctx.tenantStatus) && can(ctx, permission, scope);
}

/** Suspended/cancelled tenants keep read access but cannot change operational data. */
export function assertTenantWritable(ctx: TenantContext): void {
  if (ctx.supportMode) throw new AppError("Support view is read-only.", "forbidden");
  if (!WRITABLE.includes(ctx.tenantStatus)) {
    throw new AppError(
      "This hotel account is not active. Changes are disabled until it is reactivated.",
      "tenant_inactive",
    );
  }
}
