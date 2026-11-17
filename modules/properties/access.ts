import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { properties } from "@/lib/db/schema";
import { notFound } from "@/lib/errors";
import { assertTenantWritable, authorize, type TenantContext } from "@/lib/permissions/authorize";
import type { PermissionKey } from "@/lib/permissions/catalog";

/**
 * Resolves a property for the caller: tenant-scoped lookup first (another tenant's id is
 * "not found"), then a permission check scoped to that property. Every Phase 2 service
 * goes through this before touching floors, categories, rooms or departments.
 */
export async function requireProperty(
  db: Db,
  ctx: TenantContext,
  propertyId: string,
  permission: PermissionKey,
  opts: { write?: boolean } = {},
) {
  const id = z.uuid().safeParse(propertyId);
  if (!id.success) throw notFound("Property not found.");
  const [property] = await db
    .select({ id: properties.id, name: properties.name, timezone: properties.timezone, currency: properties.currency })
    .from(properties)
    .where(and(eq(properties.id, id.data), eq(properties.tenantId, ctx.tenantId)));
  if (!property) throw notFound("Property not found.");
  authorize(ctx, permission, { propertyId: property.id });
  if (opts.write) assertTenantWritable(ctx);
  return property;
}

export const idSchema = (label: string) => z.uuid(`Choose a ${label}`);
