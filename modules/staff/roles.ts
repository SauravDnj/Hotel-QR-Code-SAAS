import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { permissions, rolePermissions, roles, staffInvitations, userRoleAssignments } from "@/lib/db/schema";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { assertTenantWritable, authorize, type TenantContext } from "@/lib/permissions/authorize";
import { ALL_PERMISSION_KEYS, type PermissionKey } from "@/lib/permissions/catalog";
import { nameSchema, optionalText } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { departmentKey } from "@/modules/departments/service";
import { isUniqueViolation } from "@/modules/rooms/db-errors";
import { canGrantPermissions } from "./service";

/**
 * Custom roles ("Custom Staff: explicitly selected permissions"). System roles are synced
 * from code and read-only. A custom role may only contain permissions the editor holds
 * tenant-wide, so role.manage cannot be used to mint more power than you have.
 */

const permissionKey = z.enum(ALL_PERMISSION_KEYS as [PermissionKey, ...PermissionKey[]]);

export const roleInputSchema = z.object({
  name: nameSchema("Role name", 60),
  description: optionalText(200),
  permissions: z
    .array(permissionKey)
    .min(1, "Choose at least one permission")
    .transform((list) => [...new Set(list)]),
});
export type RoleInput = z.input<typeof roleInputSchema>;

export async function listRoles(db: Db, ctx: TenantContext) {
  authorize(ctx, "staff.view");
  const rows = await db
    .select({ id: roles.id, key: roles.key, name: roles.name, description: roles.description, isSystem: roles.isSystem, tenantId: roles.tenantId })
    .from(roles)
    .where(or(isNull(roles.tenantId), eq(roles.tenantId, ctx.tenantId)))
    .orderBy(desc(roles.isSystem), asc(roles.name));
  const ids = rows.map((r) => r.id);
  const perms = ids.length
    ? await db
        .select({ roleId: rolePermissions.roleId, key: permissions.key })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(inArray(rolePermissions.roleId, ids))
    : [];
  const usage = ids.length
    ? await db
        .select({ roleId: userRoleAssignments.roleId, n: count() })
        .from(userRoleAssignments)
        .where(and(eq(userRoleAssignments.tenantId, ctx.tenantId), inArray(userRoleAssignments.roleId, ids)))
        .groupBy(userRoleAssignments.roleId)
    : [];
  return rows.map((r) => ({
    ...r,
    custom: r.tenantId !== null,
    permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.key as PermissionKey),
    assignments: usage.find((u) => u.roleId === r.id)?.n ?? 0,
  }));
}

function guard(ctx: TenantContext, keys: PermissionKey[]) {
  authorize(ctx, "role.manage");
  assertTenantWritable(ctx);
  if (!canGrantPermissions(ctx, keys, null)) throw forbidden("A role can only include permissions you have yourself.");
}

async function setPermissions(tx: Db, roleId: string, keys: PermissionKey[]) {
  const rows = await tx.select({ id: permissions.id, key: permissions.key }).from(permissions).where(inArray(permissions.key, keys));
  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  await tx.insert(rolePermissions).values(rows.map((p) => ({ roleId, permissionId: p.id })));
}

export async function createRole(db: Db, ctx: TenantContext, raw: RoleInput) {
  const input = roleInputSchema.parse(raw);
  guard(ctx, input.permissions);
  const key = `custom_${departmentKey(input.name).slice(0, 30)}_${crypto.randomUUID().slice(0, 6)}`;
  try {
    return await db.transaction(async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({ tenantId: ctx.tenantId, key, name: input.name, description: input.description, isSystem: false })
        .returning();
      await setPermissions(tx, role.id, input.permissions);
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "role.created",
        entityType: "role",
        entityId: role.id,
        metadata: { name: role.name, permissions: input.permissions },
      });
      return role;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A role with this name already exists.");
    throw err;
  }
}

async function customRole(db: Db, ctx: TenantContext, roleId: string) {
  const id = z.uuid().safeParse(roleId);
  if (!id.success) throw notFound("Role not found.");
  const [role] = await db.select().from(roles).where(and(eq(roles.id, id.data), eq(roles.tenantId, ctx.tenantId)));
  if (!role) throw notFound("Role not found."); // system roles and other tenants' roles
  return role;
}

export async function updateRole(db: Db, ctx: TenantContext, roleId: string, raw: RoleInput) {
  const input = roleInputSchema.parse(raw);
  guard(ctx, input.permissions);
  const role = await customRole(db, ctx, roleId);
  await db.transaction(async (tx) => {
    await tx.update(roles).set({ name: input.name, description: input.description }).where(eq(roles.id, role.id));
    await setPermissions(tx, role.id, input.permissions);
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "role.updated",
      entityType: "role",
      entityId: role.id,
      metadata: { name: input.name, permissions: input.permissions },
    });
  });
}

export async function deleteRole(db: Db, ctx: TenantContext, roleId: string) {
  authorize(ctx, "role.manage");
  assertTenantWritable(ctx);
  const role = await customRole(db, ctx, roleId);
  const [[used], [invited]] = await Promise.all([
    db.select({ n: count() }).from(userRoleAssignments).where(eq(userRoleAssignments.roleId, role.id)),
    db
      .select({ n: count() })
      .from(staffInvitations)
      .where(and(eq(staffInvitations.roleId, role.id), isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt))),
  ]);
  if ((used?.n ?? 0) > 0 || (invited?.n ?? 0) > 0) throw conflict("Remove this role from all staff and open invitations first.");
  await db.transaction(async (tx) => {
    await tx.delete(roles).where(eq(roles.id, role.id));
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "role.deleted",
      entityType: "role",
      entityId: role.id,
      metadata: { name: role.name },
    });
  });
}
