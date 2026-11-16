import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import {
  plans,
  properties,
  rooms,
  staffInvitations,
  subscriptions,
  tenantMemberships,
  tenants,
  type Entitlements,
} from "@/lib/db/schema";
import type { SubscriptionStatus, TenantStatus } from "@/lib/db/schema/enums";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/modules/audit/service";

/**
 * Subscription lifecycle and plan limits (SAAS_BILLING.md).
 *
 * Suspension policy (documented, never deletes data):
 * - trial ends without payment, or a renewal fails → `past_due` with a GRACE_DAYS grace period,
 *   during which the hotel keeps working;
 * - grace ends → `suspended`: read-only for everyone, but owners can still open Billing and pay;
 * - `cancelled` → read-only.
 * The tenant's access status mirrors the subscription, unless a SaaS operator placed a
 * platform hold (then it stays suspended whatever billing says).
 */
export const GRACE_DAYS = 7;
const DAY = 86400_000;

export async function defaultPlan(db: Db) {
  const [p] = await db.select().from(plans).where(and(eq(plans.isDefault, true), eq(plans.active, true))).limit(1);
  return p ?? null;
}

/** Creates the trial subscription for a tenant (onboarding, or tenants created before billing). */
export async function ensureSubscription(db: Db, tenantId: string, now: Date = new Date()) {
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  if (existing) return existing;
  const plan = await defaultPlan(db);
  if (!plan) throw new Error("No default plan configured. Run `pnpm db:seed`.");
  await db
    .insert(subscriptions)
    .values({ tenantId, planId: plan.id, status: "trialing", trialEndsAt: new Date(now.getTime() + plan.trialDays * DAY) })
    .onConflictDoNothing({ target: subscriptions.tenantId });
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  return row;
}

export async function getSubscriptionWithPlan(db: Db, tenantId: string) {
  const sub = await ensureSubscription(db, tenantId);
  const [plan] = await db.select().from(plans).where(eq(plans.id, sub.planId));
  return { subscription: sub, plan };
}

export async function getEntitlements(db: Db, tenantId: string): Promise<Entitlements> {
  return (await getSubscriptionWithPlan(db, tenantId)).plan.entitlements;
}

export async function usage(db: Db, tenantId: string) {
  const [[r], [p], [m], [i]] = await Promise.all([
    db.select({ n: count() }).from(rooms).where(and(eq(rooms.tenantId, tenantId), isNull(rooms.archivedAt))),
    db.select({ n: count() }).from(properties).where(eq(properties.tenantId, tenantId)),
    db.select({ n: count() }).from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "active"))),
    db
      .select({ n: count() })
      .from(staffInvitations)
      .where(
        and(
          eq(staffInvitations.tenantId, tenantId),
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
          sql`${staffInvitations.expiresAt} > now()`,
        ),
      ),
  ]);
  // Open invitations reserve a seat, so a plan can't be exceeded by accepting many invites.
  return { rooms: r?.n ?? 0, properties: p?.n ?? 0, staffSeats: (m?.n ?? 0) + (i?.n ?? 0) };
}

const LIMIT_FIELD = { rooms: "maxRooms", properties: "maxProperties", staffSeats: "maxStaffSeats" } as const;
const LIMIT_LABEL = { rooms: "rooms", properties: "properties", staffSeats: "staff seats" } as const;

/**
 * Server-side plan limit check. Call INSIDE the transaction that adds the resource: the tenant
 * row is locked so two concurrent creates cannot both squeeze under the limit.
 */
export async function assertWithinLimit(tx: Db, tenantId: string, kind: keyof typeof LIMIT_FIELD, adding = 1) {
  await tx.execute(sql`select id from ${tenants} where ${tenants.id} = ${tenantId} for update`);
  const ent = await getEntitlements(tx, tenantId);
  const max = ent[LIMIT_FIELD[kind]];
  const used = (await usage(tx, tenantId))[kind];
  if (used + adding > max) {
    throw new AppError(
      `Your plan allows up to ${max} ${LIMIT_LABEL[kind]} (you have ${used}). Upgrade on the Billing page to add more.`,
      "plan_limit",
    );
  }
}

export async function assertModule(db: Db, tenantId: string, module: keyof Entitlements["modules"]) {
  const ent = await getEntitlements(db, tenantId);
  if (!ent.modules[module]) throw new AppError("This feature isn't included in your plan. Upgrade on the Billing page.", "plan_limit");
}

export function tenantStatusFor(status: SubscriptionStatus): TenantStatus {
  return status; // same vocabulary by design; kept as a function so the mapping is explicit
}

/** Applies subscription status to tenant access, respecting a platform hold. */
export async function syncTenantStatus(tx: Db, tenantId: string, status: SubscriptionStatus) {
  const [t] = await tx.select({ status: tenants.status, hold: tenants.platformHold }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t) return;
  const next: TenantStatus = t.hold ? "suspended" : tenantStatusFor(status);
  if (next !== t.status) await tx.update(tenants).set({ status: next }).where(eq(tenants.id, tenantId));
}

export async function setSubscriptionStatus(
  tx: Db,
  sub: { id: string; tenantId: string; status: SubscriptionStatus },
  status: SubscriptionStatus,
  extra: Partial<typeof subscriptions.$inferInsert>,
  reason: string,
) {
  await tx.update(subscriptions).set({ status, ...extra }).where(eq(subscriptions.id, sub.id));
  await syncTenantStatus(tx, sub.tenantId, status);
  if (status !== sub.status) {
    await writeAudit(tx, {
      tenantId: sub.tenantId,
      actorUserId: null,
      actorType: "system",
      action: "billing.status_changed",
      entityType: "subscription",
      entityId: sub.id,
      metadata: { from: sub.status, to: status, reason },
    });
  }
}

/**
 * Daily lifecycle sweep (durable trigger: /api/cron/daily). Trial ended → past_due + grace;
 * grace ended → suspended. Idempotent.
 */
export async function sweepSubscriptions(db: Db, now: Date = new Date()) {
  let changed = 0;
  const due = await db
    .select()
    .from(subscriptions)
    .where(inArray(subscriptions.status, ["trialing", "past_due"]))
    .limit(1000);
  for (const s of due) {
    await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(subscriptions).where(eq(subscriptions.id, s.id)).for("update");
      if (cur.status === "trialing" && cur.trialEndsAt && cur.trialEndsAt <= now) {
        await setSubscriptionStatus(tx, cur, "past_due", { graceEndsAt: new Date(now.getTime() + GRACE_DAYS * DAY) }, "trial_ended");
        changed++;
      } else if (cur.status === "past_due" && cur.graceEndsAt && cur.graceEndsAt <= now) {
        await setSubscriptionStatus(tx, cur, "suspended", {}, "grace_ended");
        changed++;
      }
    });
  }
  return changed;
}


/** Whole days left in a trial (0 when ended); null when not trialing. */
export function trialDaysLeft(sub: { status: SubscriptionStatus; trialEndsAt: Date | null }, now: Date = new Date()): number | null {
  if (sub.status !== "trialing" || !sub.trialEndsAt) return null;
  return Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY));
}
