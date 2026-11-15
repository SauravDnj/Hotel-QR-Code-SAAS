import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { tenants } from "@/lib/db/schema";
import { notFound } from "@/lib/errors";
import { assertTenantWritable, authorize, type TenantContext } from "@/lib/permissions/authorize";
import {
  countrySchema,
  currencySchema,
  emailSchema,
  nameSchema,
  timezoneSchema,
} from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";

export const tenantSettingsSchema = z.object({
  name: nameSchema("Hotel name"),
  legalName: nameSchema("Legal / business name", 200),
  contactEmail: emailSchema,
  country: countrySchema,
  timezone: timezoneSchema,
  currency: currencySchema,
});

export type TenantSettingsInput = z.input<typeof tenantSettingsSchema>;

/** Always reads the caller's own tenant; there is no tenant id parameter to tamper with. */
export async function getTenantSettings(db: Db, ctx: TenantContext) {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
  if (!row) throw notFound();
  return row;
}

export async function updateTenantSettings(db: Db, ctx: TenantContext, raw: TenantSettingsInput) {
  authorize(ctx, "tenant.manage");
  assertTenantWritable(ctx);
  const input = tenantSettingsSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(tenants).set(input).where(eq(tenants.id, ctx.tenantId)).returning();
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "tenant.settings_updated",
      entityType: "tenant",
      entityId: ctx.tenantId,
      metadata: { fields: Object.keys(input) },
    });
    return row;
  });
}
