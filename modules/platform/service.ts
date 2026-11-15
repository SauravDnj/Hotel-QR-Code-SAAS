import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { properties, roles, tenantMemberships, tenants, userRoleAssignments, users } from "@/lib/db/schema";
import { forbidden, notFound } from "@/lib/errors";
import { writeAudit } from "@/modules/audit/service";

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
      country: tenants.country,
      createdAt: tenants.createdAt,
      ownerEmail: owners.ownerEmail,
      propertyCount: sql<number>`coalesce(${propertyCounts.n}, 0)`.mapWith(Number),
    })
    .from(tenants)
    .leftJoin(owners, eq(owners.tenantId, tenants.id))
    .leftJoin(propertyCounts, eq(propertyCounts.tenantId, tenants.id))
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
    if (current.status === input.status) return current;
    const [row] = await tx
      .update(tenants)
      .set({ status: input.status })
      .where(eq(tenants.id, input.tenantId))
      .returning();
    await writeAudit(tx, {
      tenantId: input.tenantId,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: input.status === "suspended" ? "tenant.suspended" : "tenant.reactivated",
      entityType: "tenant",
      entityId: input.tenantId,
      metadata: { from: current.status, to: input.status, reason: input.reason },
    });
    return row;
  });
}
