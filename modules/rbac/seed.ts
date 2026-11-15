import { and, eq, isNull, notInArray } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { permissions, rolePermissions, roles } from "@/lib/db/schema";
import { PERMISSIONS, SYSTEM_ROLES, type PermissionKey } from "@/lib/permissions/catalog";

/**
 * Idempotently syncs the permission catalogue and system roles from code into the
 * database. Safe to run on every deploy (`pnpm db:seed`).
 */
export async function seedRbac(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await tx
        .insert(permissions)
        .values({ key, description })
        .onConflictDoUpdate({ target: permissions.key, set: { description } });
    }
    const permRows = await tx.select().from(permissions);
    const permIdByKey = new Map(permRows.map((p) => [p.key as PermissionKey, p.id]));

    for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
      let [role] = await tx
        .select()
        .from(roles)
        .where(and(isNull(roles.tenantId), eq(roles.key, key)));
      if (!role) {
        [role] = await tx
          .insert(roles)
          .values({ key, name: def.name, description: def.description, isSystem: true })
          .returning();
      } else {
        await tx
          .update(roles)
          .set({ name: def.name, description: def.description })
          .where(eq(roles.id, role.id));
      }

      const wanted = def.permissions.map((k) => permIdByKey.get(k)!);
      await tx
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, role.id), notInArray(rolePermissions.permissionId, wanted)));
      await tx
        .insert(rolePermissions)
        .values(wanted.map((permissionId) => ({ roleId: role.id, permissionId })))
        .onConflictDoNothing();
    }
  });
}
