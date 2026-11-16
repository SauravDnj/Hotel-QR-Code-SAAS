import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { properties } from "@/lib/db/schema";
import { conflict, notFound } from "@/lib/errors";
import {
  assertTenantWritable,
  authorize,
  propertyScope,
  type TenantContext,
} from "@/lib/permissions/authorize";
import {
  countrySchema,
  currencySchema,
  nameSchema,
  optionalText,
  timezoneSchema,
} from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { assertWithinLimit } from "@/modules/billing/subscription";

export const propertyInputSchema = z.object({
  name: nameSchema("Property name"),
  addressLine1: optionalText(),
  addressLine2: optionalText(),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(20),
  country: countrySchema,
  timezone: timezoneSchema,
  currency: currencySchema,
  status: z.enum(["active", "inactive"]).default("active"),
});

export type PropertyInput = z.input<typeof propertyInputSchema>;

/** Every query is filtered by the caller's tenant and allowed property scope. */
export async function listProperties(db: Db, ctx: TenantContext) {
  const scope = propertyScope(ctx, "property.view");
  if (scope !== "all" && scope.length === 0) return [];
  return db
    .select()
    .from(properties)
    .where(
      and(
        eq(properties.tenantId, ctx.tenantId),
        scope === "all" ? undefined : inArray(properties.id, scope),
      ),
    )
    .orderBy(asc(properties.name));
}

/** Scoped lookup: another tenant's property id is reported as "not found". */
export async function getProperty(db: Db, ctx: TenantContext, propertyId: string) {
  const parsed = z.uuid().safeParse(propertyId);
  if (!parsed.success) throw notFound("Property not found.");
  const [row] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, parsed.data), eq(properties.tenantId, ctx.tenantId)));
  if (!row) throw notFound("Property not found.");
  authorize(ctx, "property.view", { propertyId: row.id });
  return row;
}

export async function createProperty(db: Db, ctx: TenantContext, raw: PropertyInput) {
  authorize(ctx, "property.manage");
  assertTenantWritable(ctx);
  const input = propertyInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    await assertWithinLimit(tx, ctx.tenantId, "properties", 1);
    await assertNameFree(tx, ctx.tenantId, input.name);
    const [row] = await tx
      .insert(properties)
      .values({ ...input, tenantId: ctx.tenantId })
      .returning();
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "property.created",
      entityType: "property",
      entityId: row.id,
      metadata: { name: row.name },
    });
    return row;
  });
}

export async function updateProperty(db: Db, ctx: TenantContext, propertyId: string, raw: PropertyInput) {
  const existing = await getProperty(db, ctx, propertyId);
  authorize(ctx, "property.manage", { propertyId: existing.id });
  assertTenantWritable(ctx);
  const input = propertyInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    if (input.name !== existing.name) await assertNameFree(tx, ctx.tenantId, input.name);
    const [row] = await tx
      .update(properties)
      .set(input)
      .where(and(eq(properties.id, existing.id), eq(properties.tenantId, ctx.tenantId)))
      .returning();
    const changed = Object.keys(input).filter(
      (k) => input[k as keyof typeof input] !== existing[k as keyof typeof existing],
    );
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "property.updated",
      entityType: "property",
      entityId: row.id,
      metadata: { changedFields: changed },
    });
    return row;
  });
}

async function assertNameFree(db: Db, tenantId: string, name: string) {
  const [dup] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.tenantId, tenantId), eq(properties.name, name)));
  if (dup) throw conflict("A property with this name already exists.");
}
