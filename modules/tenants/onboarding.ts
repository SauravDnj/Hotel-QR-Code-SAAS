import { and, eq, isNull, like } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import {
  properties,
  roles,
  tenantMemberships,
  tenants,
  userRoleAssignments,
  users,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { conflict } from "@/lib/errors";
import {
  countrySchema,
  currencySchema,
  emailSchema,
  nameSchema,
  passwordSchema,
  timezoneSchema,
} from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";

export const signupSchema = z.object({
  ownerName: nameSchema("Your name"),
  email: emailSchema,
  password: passwordSchema,
  hotelName: nameSchema("Hotel name"),
  legalName: nameSchema("Legal / business name", 200),
  country: countrySchema,
  timezone: timezoneSchema,
  currency: currencySchema,
});

export type SignupInput = z.infer<typeof signupSchema>;

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "hotel";
}

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set(
    (await db.select({ slug: tenants.slug }).from(tenants).where(like(tenants.slug, `${base}%`))).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/**
 * Self-service onboarding: creates the tenant, owner user, membership, owner role
 * assignment and first property in ONE transaction, so a failure leaves nothing behind.
 */
export async function createTenantWithOwner(db: Db, raw: SignupInput) {
  const input = signupSchema.parse(raw);
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing) throw conflict("An account with this email already exists. Please sign in instead.");

    const [ownerRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(isNull(roles.tenantId), eq(roles.key, "owner")));
    if (!ownerRole) throw new Error("System roles are missing. Run `pnpm db:seed`.");

    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: input.hotelName,
        legalName: input.legalName,
        slug: await uniqueSlug(tx, input.hotelName),
        status: "trialing",
        timezone: input.timezone,
        country: input.country,
        currency: input.currency,
        contactEmail: input.email,
      })
      .returning();

    const [user] = await tx
      .insert(users)
      .values({ email: input.email, name: input.ownerName, passwordHash })
      .returning({ id: users.id });

    const [membership] = await tx
      .insert(tenantMemberships)
      .values({ tenantId: tenant.id, userId: user.id, status: "active" })
      .returning({ id: tenantMemberships.id });

    await tx.insert(userRoleAssignments).values({
      tenantId: tenant.id,
      membershipId: membership.id,
      roleId: ownerRole.id,
      propertyId: null,
      createdByUserId: user.id,
    });

    const [property] = await tx
      .insert(properties)
      .values({
        tenantId: tenant.id,
        name: input.hotelName,
        country: input.country,
        timezone: input.timezone,
        currency: input.currency,
      })
      .returning({ id: properties.id });

    await writeAudit(tx, {
      tenantId: tenant.id,
      actorUserId: user.id,
      actorType: "user",
      action: "tenant.created",
      entityType: "tenant",
      entityId: tenant.id,
      metadata: { source: "self_signup", firstPropertyId: property.id },
    });

    return { tenantId: tenant.id, userId: user.id, propertyId: property.id };
  });
}
