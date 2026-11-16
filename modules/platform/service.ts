import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { properties, roles, tenantMemberships, tenants, userRoleAssignments, users } from "@/lib/db/schema";
import { forbidden, notFound } from "@/lib/errors";
import { writeAudit } from "@/modules/audit/service";
import { getSubscriptionWithPlan, setSubscriptionStatus, tenantStatusFor } from "@/modules/billing/subscription";
import { subscriptions, plans } from "@/lib/db/schema";

/** A signed-in SaaS operator. Built server-side from the users table. */
export interface PlatformActor {
  userId: string;
  isPlatformAdmin: boolean;
}

function assertPlatformAdmin(actor: PlatformActor) {
  if (!actor.isPlatformAdmin) throw forbidden();
}

/**
 * Platform-wide tenant list. Shows account-level information only; tenant operational
 * data requires the audited support mode (later phase).
 */
export async function listTenantsForPlatform(db: Db, actor: PlatformActor) {
  assertPlatformAdmin(actor);
  const owners = db
    .select({
      tenantId: userRoleAssignments.tenantId,
      ownerEmail: sql<string>`min(${users.email})`.as("owner_email"),
    })
    .from(userRoleAssignments)
    .innerJoin(roles, and(eq(roles.id, userRoleAssignments.roleId), eq(roles.key, "owner")))
    .innerJoin(tenantMemberships, eq(tenantMemberships.id, userRoleAssignments.membershipId))
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .groupBy(userRoleAssignments.tenantId)
    .as("owners");

  const propertyCounts = db
    .select({ tenantId: properties.tenantId, n: count().as("n") })
    .from(properties)
    .groupBy(properties.tenantId)
    .as("pc");

  return db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      platformHold: tenants.platformHold,
      planName: plans.name,
      subscriptionStatus: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
      country: tenants.country,
      createdAt: tenants.createdAt,
      ownerEmail: owners.ownerEmail,
      propertyCount: sql<number>`coalesce(${propertyCounts.n}, 0)`.mapWith(Number),
    })
    .from(tenants)
    .leftJoin(owners, eq(owners.tenantId, tenants.id))
    .leftJoin(propertyCounts, eq(propertyCounts.tenantId, tenants.id))
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .orderBy(desc(tenants.createdAt))
    .limit(500);
}

export const tenantStatusChangeSchema = z.object({
  tenantId: z.uuid(),
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(3, "Give a reason (min 3 characters)").max(500),
});

export async function setTenantStatus(
  db: Db,
  actor: PlatformActor,
  raw: z.input<typeof tenantStatusChangeSchema>,
) {
  assertPlatformAdmin(actor);
  const input = tenantStatusChangeSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(tenants).where(eq(tenants.id, input.tenantId)).for("update");
    if (!current) throw notFound("Tenant not found.");
    // Suspend = platform hold (billing can never lift it). Reactivate = lift the hold and
    // return to whatever the subscription allows (an unpaid hotel stays suspended).
    const hold = input.status === "suspended";
    const { subscription } = await getSubscriptionWithPlan(tx, input.tenantId);
    const next = hold ? "suspended" : tenantStatusFor(subscription.status);
    if (current.status === next && current.platformHold === hold) return current;
    const [row] = await tx
      .update(tenants)
      .set({ status: next, platformHold: hold })
      .where(eq(tenants.id, input.tenantId))
      .returning();
    await writeAudit(tx, {
      tenantId: input.tenantId,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: input.status === "suspended" ? "tenant.suspended" : "tenant.reactivated",
      entityType: "tenant",
      entityId: input.tenantId,
      metadata: { from: current.status, to: next, platformHold: hold, reason: input.reason },
    });
    return row;
  });
}

export const extendTrialSchema = z.object({
  tenantId: z.uuid(),
  days: z.coerce.number().int().min(1).max(90),
  reason: z.string().trim().min(3, "Give a reason (min 3 characters)").max(500),
});

/** Operator goodwill: put a tenant back on trial for N days (audited). */
export async function extendTrial(db: Db, actor: PlatformActor, raw: z.input<typeof extendTrialSchema>) {
  assertPlatformAdmin(actor);
  const input = extendTrialSchema.parse(raw);
  await db.transaction(async (tx) => {
    const { subscription } = await getSubscriptionWithPlan(tx, input.tenantId);
    if (subscription.status === "active") throw forbidden("This hotel has an active paid subscription.");
    await setSubscriptionStatus(
      tx,
      subscription,
      "trialing",
      { trialEndsAt: new Date(Date.now() + input.days * 86400_000), graceEndsAt: null },
      "platform_trial_extension",
    );
    await writeAudit(tx, {
      tenantId: input.tenantId,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: "platform.trial_extended",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: { days: input.days, reason: input.reason },
    });
  });
}

/** SaaS operator metrics (ANALYTICS_REPORTING.md "SaaS operator reports"). */
export async function platformMetrics(db: Db, actor: PlatformActor) {
  assertPlatformAdmin(actor);
  const byStatus = await db.select({ status: tenants.status, n: count() }).from(tenants).groupBy(tenants.status);
  const [mrr] = await db
    .select({ minor: sql<number>`coalesce(sum(${plans.priceMinor}), 0)`.mapWith(Number) })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.status, "active"));
  const byPlan = await db
    .select({ plan: plans.name, status: subscriptions.status, n: count() })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .groupBy(plans.name, subscriptions.status);
  return { byStatus, mrrMinor: mrr?.minor ?? 0, byPlan };
}
