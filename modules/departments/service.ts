import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { departments } from "@/lib/db/schema";
import { conflict, notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";
import { nameSchema } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { requireProperty } from "@/modules/properties/access";
import { isUniqueViolation } from "@/modules/rooms/db-errors";

/**
 * Departments are request-routing targets (Phase 4) and staff scopes (Phase 5).
 * Managing them is part of property structure, so it needs `property.manage`.
 */
export const DEFAULT_DEPARTMENTS = [
  { key: "reception", name: "Reception" },
  { key: "housekeeping", name: "Housekeeping" },
  { key: "room_service", name: "Room Service" },
  { key: "maintenance", name: "Maintenance" },
  { key: "security", name: "Security" },
] as const;

export const departmentInputSchema = z.object({
  name: nameSchema("Department name", 60),
  status: z.enum(["active", "inactive"]).default("active"),
});
export type DepartmentInput = z.input<typeof departmentInputSchema>;

/** Stable machine key from a name, e.g. "Front Desk" -> "front_desk". */
export function departmentKey(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "department"
  );
}

export async function listDepartments(db: Db, ctx: TenantContext, propertyId: string) {
  const property = await requireProperty(db, ctx, propertyId, "property.view");
  return db
    .select()
    .from(departments)
    .where(and(eq(departments.tenantId, ctx.tenantId), eq(departments.propertyId, property.id)))
    .orderBy(asc(departments.name));
}

async function audit(db: Db, ctx: TenantContext, action: string, row: { id: string; name: string; propertyId: string }) {
  await writeAudit(db, {
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorType: "user",
    action,
    entityType: "department",
    entityId: row.id,
    metadata: { propertyId: row.propertyId, name: row.name },
  });
}

/** Idempotent: adds any missing default departments, never duplicates or renames. */
export async function createDefaultDepartments(db: Db, ctx: TenantContext, propertyId: string) {
  const property = await requireProperty(db, ctx, propertyId, "property.manage", { write: true });
  return db.transaction(async (tx) => {
    const created = await tx
      .insert(departments)
      .values(DEFAULT_DEPARTMENTS.map((d) => ({ ...d, tenantId: ctx.tenantId, propertyId: property.id })))
      .onConflictDoNothing()
      .returning();
    for (const row of created) await audit(tx, ctx, "department.created", row);
    return { created: created.length };
  });
}

export async function createDepartment(db: Db, ctx: TenantContext, propertyId: string, raw: DepartmentInput) {
  const property = await requireProperty(db, ctx, propertyId, "property.manage", { write: true });
  const input = departmentInputSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(departments)
        .values({ ...input, key: departmentKey(input.name), tenantId: ctx.tenantId, propertyId: property.id })
        .returning();
      await audit(tx, ctx, "department.created", row);
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A department with this name already exists in this property.");
    throw err;
  }
}

/** Renames/activates. The key stays fixed so future routing rules keep pointing at it. */
export async function updateDepartment(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  departmentId: string,
  raw: DepartmentInput,
) {
  const property = await requireProperty(db, ctx, propertyId, "property.manage", { write: true });
  const id = z.uuid().safeParse(departmentId);
  if (!id.success) throw notFound("Department not found.");
  const input = departmentInputSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(departments)
        .set(input)
        .where(
          and(eq(departments.id, id.data), eq(departments.propertyId, property.id), eq(departments.tenantId, ctx.tenantId)),
        )
        .returning();
      if (!row) throw notFound("Department not found.");
      await audit(tx, ctx, "department.updated", row);
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A department with this name already exists in this property.");
    throw err;
  }
}
