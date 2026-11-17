import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import {
  auditLogs,
  plans,
  properties,
  reservations,
  roles,
  rooms,
  serviceRequests,
  stays,
  subscriptions,
  tenantMemberships,
  tenants,
  userRoleAssignments,
  users,
} from "@/lib/db/schema";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { countrySchema, currencySchema, emailSchema, nameSchema, timezoneSchema } from "@/lib/validation/common";
import { createPasswordResetLink } from "@/modules/account/security";
import { writeAudit } from "@/modules/audit/service";
import { getSubscriptionWithPlan, setSubscriptionStatus } from "@/modules/billing/subscription";
import { createTenantWithOwner } from "@/modules/tenants/onboarding";
import type { PlatformActor } from "./service";

/**
 * SaaS super admin console (RBAC_PERMISSIONS.md "SaaS Super Admin": platform-wide tenant,
 * plan and support operations). Account-level data only; a hotel's operational screens are
 * reached through the audited, read-only support view (lib/auth/session.ts).
 * Every change here is audited with actorType "platform_admin".
 */

function assertPlatformAdmin(actor: PlatformActor) {
  if (!actor.isPlatformAdmin) throw forbidden();
}

const DAY = 86400_000;
const reasonSchema = z.string().trim().min(3, "Give a reason (min 3 characters)").max(500);

// ---------------------------------------------------------------- overview

export async function platformOverview(db: Db, actor: PlatformActor, now: Date = new Date()) {
  assertPlatformAdmin(actor);
  const since24h = new Date(now.getTime() - DAY);
  const since30d = new Date(now.getTime() - 30 * DAY);
  const [[t], [u], [m], [p], [r], [req], [inHouse], trialsEnding, recent] = await Promise.all([
    db.select({ n: count() }).from(tenants),
    db.select({ n: count(), admins: sql<number>`count(*) filter (where ${users.isPlatformAdmin})`.mapWith(Number) }).from(users),
    db.select({ n: count() }).from(tenantMemberships).where(eq(tenantMemberships.status, "active")),
    db.select({ n: count() }).from(properties),
    db.select({ n: count() }).from(rooms).where(isNull(rooms.archivedAt)),
    db
      .select({
        day: sql<number>`count(*) filter (where ${serviceRequests.submittedAt} >= ${since24h})`.mapWith(Number),
        month: sql<number>`count(*) filter (where ${serviceRequests.submittedAt} >= ${since30d})`.mapWith(Number),
        open: sql<number>`count(*) filter (where ${serviceRequests.status} not in ('completed', 'cancelled'))`.mapWith(Number),
      })
      .from(serviceRequests),
    db.select({ n: count() }).from(stays).where(eq(stays.status, "checked_in")),
    db
      .select({ id: tenants.id, name: tenants.name, trialEndsAt: subscriptions.trialEndsAt })
      .from(subscriptions)
      .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .where(and(eq(subscriptions.status, "trialing"), lt(subscriptions.trialEndsAt, new Date(now.getTime() + 7 * DAY))))
      .orderBy(asc(subscriptions.trialEndsAt))
      .limit(10),
    db
      .select({ id: tenants.id, name: tenants.name, status: tenants.status, createdAt: tenants.createdAt })
      .from(tenants)
      .orderBy(desc(tenants.createdAt))
      .limit(5),
  ]);
  return {
    hotels: t.n,
    users: u.n,
    platformAdmins: u.admins,
    activeStaff: m.n,
    properties: p.n,
    rooms: r.n,
    requests24h: req.day,
    requests30d: req.month,
    openRequests: req.open,
    inHouseStays: inHouse.n,
    trialsEnding,
    recent,
  };
}

// ---------------------------------------------------------------- hotels

export const tenantFilterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(["trialing", "active", "past_due", "suspended", "cancelled"]).optional().catch(undefined),
});

export async function searchTenants(db: Db, actor: PlatformActor, raw: z.input<typeof tenantFilterSchema> = {}) {
  assertPlatformAdmin(actor);
  const f = tenantFilterSchema.parse(raw);
  const staff = db
    .select({ tenantId: tenantMemberships.tenantId, n: count().as("staff_n") })
    .from(tenantMemberships)
    .where(eq(tenantMemberships.status, "active"))
    .groupBy(tenantMemberships.tenantId)
    .as("staff");
  const roomCounts = db
    .select({ tenantId: rooms.tenantId, n: count().as("room_n") })
    .from(rooms)
    .where(isNull(rooms.archivedAt))
    .groupBy(rooms.tenantId)
    .as("rc");
  const conds: SQL[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(tenants.name, like), ilike(tenants.slug, like), ilike(tenants.contactEmail, like), ilike(tenants.legalName, like))!);
  }
  if (f.status) conds.push(eq(tenants.status, f.status));
  return db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      country: tenants.country,
      contactEmail: tenants.contactEmail,
      status: tenants.status,
      platformHold: tenants.platformHold,
      createdAt: tenants.createdAt,
      planName: plans.name,
      subscriptionStatus: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
      staff: sql<number>`coalesce(${staff.n}, 0)`.mapWith(Number),
      rooms: sql<number>`coalesce(${roomCounts.n}, 0)`.mapWith(Number),
    })
    .from(tenants)
    .leftJoin(staff, eq(staff.tenantId, tenants.id))
    .leftJoin(roomCounts, eq(roomCounts.tenantId, tenants.id))
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(tenants.createdAt))
    .limit(500);
}

/** Everything an operator needs about one hotel account. No guest personal data. */
export async function getTenantDetail(db: Db, actor: PlatformActor, tenantId: string, now: Date = new Date()) {
  assertPlatformAdmin(actor);
  const id = z.uuid().safeParse(tenantId);
  if (!id.success) throw notFound("Hotel not found.");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id.data));
  if (!tenant) throw notFound("Hotel not found.");

  const since30d = new Date(now.getTime() - 30 * DAY);
  const [{ subscription, plan }, propertyRows, staffRows, assignments, [req], [inHouse], [upcoming], audit] = await Promise.all([
    getSubscriptionWithPlan(db, tenant.id),
    db
      .select({
        id: properties.id,
        name: properties.name,
        city: properties.city,
        timezone: properties.timezone,
        status: properties.status,
        rooms: sql<number>`(select count(*) from ${rooms} where ${rooms.propertyId} = ${properties.id} and ${rooms.archivedAt} is null)`.mapWith(Number),
      })
      .from(properties)
      .where(eq(properties.tenantId, tenant.id))
      .orderBy(asc(properties.name)),
    db
      .select({
        membershipId: tenantMemberships.id,
        status: tenantMemberships.status,
        joinedAt: tenantMemberships.createdAt,
        userId: users.id,
        name: users.name,
        email: users.email,
        userStatus: users.status,
        lastLoginAt: users.lastLoginAt,
        mfaEnabled: sql<boolean>`${users.mfaEnabledAt} is not null`,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(eq(tenantMemberships.tenantId, tenant.id))
      .orderBy(asc(users.name)),
    db
      .select({ membershipId: userRoleAssignments.membershipId, role: roles.name, roleKey: roles.key, property: properties.name })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .leftJoin(properties, eq(properties.id, userRoleAssignments.propertyId))
      .where(eq(userRoleAssignments.tenantId, tenant.id)),
    db
      .select({
        month: sql<number>`count(*) filter (where ${serviceRequests.submittedAt} >= ${since30d})`.mapWith(Number),
        open: sql<number>`count(*) filter (where ${serviceRequests.status} not in ('completed', 'cancelled'))`.mapWith(Number),
        total: count(),
      })
      .from(serviceRequests)
      .where(eq(serviceRequests.tenantId, tenant.id)),
    db.select({ n: count() }).from(stays).where(and(eq(stays.tenantId, tenant.id), eq(stays.status, "checked_in"))),
    db.select({ n: count() }).from(reservations).where(and(eq(reservations.tenantId, tenant.id), eq(reservations.status, "confirmed"))),
    listPlatformAudit(db, actor, { tenantId: tenant.id, limit: 15 }),
  ]);

  const roleMap = new Map<string, { role: string; roleKey: string; property: string | null }[]>();
  for (const a of assignments) {
    const list = roleMap.get(a.membershipId) ?? [];
    list.push({ role: a.role, roleKey: a.roleKey, property: a.property });
    roleMap.set(a.membershipId, list);
  }
  return {
    tenant,
    subscription,
    plan,
    properties: propertyRows,
    staff: staffRows.map((s) => ({ ...s, roles: roleMap.get(s.membershipId) ?? [] })),
    usage: { requests30d: req.month, openRequests: req.open, totalRequests: req.total, inHouse: inHouse.n, upcomingBookings: upcoming.n },
    audit,
  };
}

export const tenantProfileSchema = z.object({
  name: nameSchema("Hotel name"),
  legalName: nameSchema("Legal / business name", 200),
  contactEmail: emailSchema,
  country: countrySchema,
  timezone: timezoneSchema,
  reason: reasonSchema,
});

export async function updateTenantProfile(db: Db, actor: PlatformActor, tenantId: string, raw: z.input<typeof tenantProfileSchema>) {
  assertPlatformAdmin(actor);
  const input = tenantProfileSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update");
    if (!cur) throw notFound("Hotel not found.");
    const { reason, ...next } = input;
    const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => cur[k as keyof typeof cur] !== v));
    if (Object.keys(changed).length === 0) return;
    await tx.update(tenants).set(changed).where(eq(tenants.id, tenantId));
    await writeAudit(tx, {
      tenantId,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: "platform.tenant_updated",
      entityType: "tenant",
      entityId: tenantId,
      metadata: { fields: Object.keys(changed), reason },
    });
  });
}

export const changePlanSchema = z.object({ planId: z.uuid("Choose a plan"), reason: reasonSchema });

/** Moves a hotel to another plan (limits apply immediately). Paid provider subscriptions change through Billing. */
export async function changeTenantPlan(db: Db, actor: PlatformActor, tenantId: string, raw: z.input<typeof changePlanSchema>) {
  assertPlatformAdmin(actor);
  const input = changePlanSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId));
    if (!plan) throw notFound("Plan not found.");
    const { subscription } = await getSubscriptionWithPlan(tx, tenantId);
    if (subscription.planId === plan.id) return;
    if (subscription.status === "active" && subscription.providerSubscriptionId) {
      throw conflict("This hotel pays through Razorpay. Change the plan from the hotel's Billing page so the charge matches.");
    }
    await tx.update(subscriptions).set({ planId: plan.id, pendingPlanId: null }).where(eq(subscriptions.id, subscription.id));
    await writeAudit(tx, {
      tenantId,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: "platform.plan_changed",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: { fromPlanId: subscription.planId, toPlanId: plan.id, plan: plan.key, reason: input.reason },
    });
  });
}

export const manualActivationSchema = z.object({
  days: z.coerce.number().int().min(1, "At least 1 day").max(1100, "At most 3 years"),
  reason: reasonSchema,
});

/**
 * Offline payment (bank transfer, cheque, cash) or a complimentary account: marks the
 * subscription active until a date. Audited. Never used for Razorpay-managed subscriptions.
 */
export async function activateManually(db: Db, actor: PlatformActor, tenantId: string, raw: z.input<typeof manualActivationSchema>) {
  assertPlatformAdmin(actor);
  const input = manualActivationSchema.parse(raw);
  await db.transaction(async (tx) => {
    const { subscription } = await getSubscriptionWithPlan(tx, tenantId);
    if (subscription.providerSubscriptionId && subscription.status === "active") {
      throw conflict("This hotel already pays through Razorpay.");
    }
    const end = new Date(Date.now() + input.days * DAY);
    await setSubscriptionStatus(
      tx,
      subscription,
      "active",
      { currentPeriodEnd: end, trialEndsAt: null, graceEndsAt: null, provider: "manual" },
      "platform_manual_activation",
    );
    await writeAudit(tx, {
      tenantId,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: "platform.subscription_activated",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: { days: input.days, until: end.toISOString(), reason: input.reason },
    });
  });
}

export const operatorCreateTenantSchema = z.object({
  hotelName: nameSchema("Hotel name"),
  legalName: nameSchema("Legal / business name", 200),
  ownerName: nameSchema("Owner name"),
  email: emailSchema,
  country: countrySchema,
  timezone: timezoneSchema,
  currency: currencySchema,
  planId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
});

/**
 * Operator onboarding (PRD FR-01): creates the hotel, its owner and first property, then
 * returns a one-time link for the owner to choose their own password. The operator never
 * knows the owner's password.
 */
export async function createTenantAsOperator(db: Db, actor: PlatformActor, raw: z.input<typeof operatorCreateTenantSchema>) {
  assertPlatformAdmin(actor);
  const input = operatorCreateTenantSchema.parse(raw);
  // Unknowable random password: the owner sets their own through the reset link.
  const created = await createTenantWithOwner(
    db,
    { ...input, password: `${randomBytes(24).toString("base64url")}aA1!` },
    { source: "platform_operator", actorUserId: actor.userId },
  );
  if (input.planId) await changeTenantPlan(db, actor, created.tenantId, { planId: input.planId, reason: "Plan chosen at onboarding" });
  const { token } = await createPasswordResetLink(db, actor, { email: input.email, reason: "New hotel onboarding: owner sets password" });
  return { ...created, token };
}

// ---------------------------------------------------------------- staff & users

async function activeOwners(tx: Db, tenantId: string, excludingMembershipId: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(userRoleAssignments)
    .innerJoin(roles, and(eq(roles.id, userRoleAssignments.roleId), eq(roles.key, "owner")))
    .innerJoin(tenantMemberships, eq(tenantMemberships.id, userRoleAssignments.membershipId))
    .where(
      and(
        eq(userRoleAssignments.tenantId, tenantId),
        eq(tenantMemberships.status, "active"),
        ne(tenantMemberships.id, excludingMembershipId),
      ),
    );
  return row.n;
}

export const memberStatusSchema = z.object({ status: z.enum(["active", "disabled"]), reason: reasonSchema });

/** Turns one person's access to one hotel on or off. A hotel always keeps an active owner. */
export async function setMembershipStatusAsOperator(
  db: Db,
  actor: PlatformActor,
  tenantId: string,
  membershipId: string,
  raw: z.input<typeof memberStatusSchema>,
) {
  assertPlatformAdmin(actor);
  const input = memberStatusSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.id, membershipId), eq(tenantMemberships.tenantId, tenantId)))
      .for("update");
    if (!m) throw notFound("Staff member not found.");
    if (m.status === input.status) return;
    if (input.status === "disabled") {
      const [isOwner] = await tx
        .select({ id: userRoleAssignments.id })
        .from(userRoleAssignments)
        .innerJoin(roles, and(eq(roles.id, userRoleAssignments.roleId), eq(roles.key, "owner")))
        .where(eq(userRoleAssignments.membershipId, m.id));
      if (isOwner && (await activeOwners(tx, tenantId, m.id)) === 0) throw conflict("The hotel must keep at least one active owner.");
    }
    await tx.update(tenantMemberships).set({ status: input.status }).where(eq(tenantMemberships.id, m.id));
    await writeAudit(tx, {
      tenantId,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: input.status === "disabled" ? "staff.deactivated" : "staff.reactivated",
      entityType: "membership",
      entityId: m.id,
      metadata: { userId: m.userId, reason: input.reason },
    });
  });
}

export const userFilterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  type: z.enum(["all", "admins", "disabled", "no_hotel"]).optional().catch(undefined),
});

/** Every login on the platform, with the hotels and roles each one has. */
export async function listPlatformUsers(db: Db, actor: PlatformActor, raw: z.input<typeof userFilterSchema> = {}) {
  assertPlatformAdmin(actor);
  const f = userFilterSchema.parse(raw);
  const conds: SQL[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(users.email, like), ilike(users.name, like))!);
  }
  if (f.type === "admins") conds.push(eq(users.isPlatformAdmin, true));
  if (f.type === "disabled") conds.push(eq(users.status, "disabled"));
  if (f.type === "no_hotel") conds.push(sql`not exists (select 1 from ${tenantMemberships} where ${tenantMemberships.userId} = ${users.id})`);
  const list = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      isPlatformAdmin: users.isPlatformAdmin,
      mfaEnabled: sql<boolean>`${users.mfaEnabledAt} is not null`,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(300);
  if (list.length === 0) return [];
  const links = await db
    .select({
      userId: tenantMemberships.userId,
      tenantId: tenants.id,
      tenant: tenants.name,
      memberStatus: tenantMemberships.status,
      roles: sql<string>`coalesce(string_agg(distinct ${roles.name}, ', '), '')`,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .leftJoin(userRoleAssignments, eq(userRoleAssignments.membershipId, tenantMemberships.id))
    .leftJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .where(inArray(tenantMemberships.userId, list.map((u) => u.id)))
    .groupBy(tenantMemberships.userId, tenants.id, tenants.name, tenantMemberships.status);
  return list.map((u) => ({ ...u, hotels: links.filter((l) => l.userId === u.id) }));
}

export const userStatusSchema = z.object({ status: z.enum(["active", "disabled"]), reason: reasonSchema });

/** Blocks or restores a login everywhere. Blocking signs the person out on every device. */
export async function setUserStatus(db: Db, actor: PlatformActor, userId: string, raw: z.input<typeof userStatusSchema>) {
  assertPlatformAdmin(actor);
  const input = userStatusSchema.parse(raw);
  if (userId === actor.userId) throw forbidden("You cannot block your own login.");
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw notFound("User not found.");
    if (u.status === input.status) return;
    if (input.status === "disabled" && u.isPlatformAdmin) throw conflict("Remove super admin access first.");
    await tx
      .update(users)
      .set({ status: input.status, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, u.id));
    await writeAudit(tx, {
      tenantId: null,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: input.status === "disabled" ? "platform.user_blocked" : "platform.user_unblocked",
      entityType: "user",
      entityId: u.id,
      metadata: { reason: input.reason },
    });
  });
}

export const platformAdminSchema = z.object({ grant: z.boolean(), reason: reasonSchema });

/** Grants or removes SaaS super admin access. You cannot remove your own, and one always remains. */
export async function setPlatformAdmin(db: Db, actor: PlatformActor, userId: string, raw: z.input<typeof platformAdminSchema>) {
  assertPlatformAdmin(actor);
  const input = platformAdminSchema.parse(raw);
  if (userId === actor.userId && !input.grant) throw forbidden("Ask another super admin to remove your access.");
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw notFound("User not found.");
    if (u.isPlatformAdmin === input.grant) return;
    if (input.grant && u.status !== "active") throw conflict("Unblock this login first.");
    await tx
      .update(users)
      .set({ isPlatformAdmin: input.grant, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, u.id));
    await writeAudit(tx, {
      tenantId: null,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: input.grant ? "platform.admin_granted" : "platform.admin_revoked",
      entityType: "user",
      entityId: u.id,
      metadata: { reason: input.reason },
    });
  });
}

// ---------------------------------------------------------------- audit & support view

export async function listPlatformAudit(
  db: Db,
  actor: PlatformActor,
  opts: { tenantId?: string; q?: string; platformOnly?: boolean; before?: Date; limit?: number } = {},
) {
  assertPlatformAdmin(actor);
  const limit = Math.min(opts.limit ?? 100, 200);
  const conds: SQL[] = [];
  if (opts.tenantId) conds.push(eq(auditLogs.tenantId, opts.tenantId));
  if (opts.platformOnly) conds.push(eq(auditLogs.actorType, "platform_admin"));
  if (opts.q) conds.push(ilike(auditLogs.action, `%${opts.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
  if (opts.before) conds.push(lt(auditLogs.createdAt, opts.before));
  return db
    .select({
      id: auditLogs.id,
      tenantId: auditLogs.tenantId,
      tenantName: tenants.name,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      actorType: auditLogs.actorType,
      actorEmail: users.email,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export const supportSessionSchema = z.object({ reason: reasonSchema });
export const SUPPORT_SESSION_MINUTES = 60;

/** Starts the read-only support view of one hotel (RBAC_PERMISSIONS.md: audited support mode). */
export async function startSupportSession(db: Db, actor: PlatformActor, tenantId: string, raw: z.input<typeof supportSessionSchema>) {
  assertPlatformAdmin(actor);
  const input = supportSessionSchema.parse(raw);
  const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw notFound("Hotel not found.");
  await writeAudit(db, {
    tenantId,
    actorUserId: actor.userId,
    actorType: "platform_admin",
    action: "platform.support_view_started",
    entityType: "tenant",
    entityId: tenantId,
    metadata: { reason: input.reason, minutes: SUPPORT_SESSION_MINUTES },
  });
}
