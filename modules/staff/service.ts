import { and, asc, count, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import {
  departments,
  permissions,
  properties,
  rolePermissions,
  roles,
  staffInvitations,
  tenantMemberships,
  tenants,
  userRoleAssignments,
  users,
} from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateQrToken, hashQrToken, isWellFormedQrToken } from "@/lib/crypto/secrets";
import { AppError, conflict, forbidden, notFound } from "@/lib/errors";
import { assertTenantWritable, authorize, can, type TenantContext } from "@/lib/permissions/authorize";
import type { PermissionKey } from "@/lib/permissions/catalog";
import { emailSchema, nameSchema, passwordSchema } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { isUniqueViolation } from "@/modules/rooms/db-errors";
import { assertWithinLimit } from "@/modules/billing/subscription";

/**
 * Staff accounts, role assignments and invitations (Phase 5, RBAC_PERMISSIONS.md "Scope").
 *
 * Guard rails, all enforced here (not in the UI):
 * - no privilege escalation: you can only grant a role whose every permission you hold
 *   yourself for the same scope (tenant-wide or that property);
 * - you cannot change your own membership or assignments (no self-promotion or lock-out);
 * - the hotel always keeps at least one active owner;
 * - every change is audited in the same transaction.
 */

export const INVITE_TTL_DAYS = 7;

const uuidOrNull = z
  .union([z.literal(""), z.uuid()])
  .optional()
  .transform((v) => (v ? v : null));

export const assignmentSchema = z.object({
  roleId: z.uuid("Choose a role"),
  propertyId: uuidOrNull,
  departmentId: uuidOrNull,
});
export type AssignmentInput = z.input<typeof assignmentSchema>;

export const inviteSchema = assignmentSchema.extend({
  email: emailSchema,
  name: nameSchema("Name"),
});
export type InviteInput = z.input<typeof inviteSchema>;

async function rolePermissionKeys(db: Db, roleId: string): Promise<PermissionKey[]> {
  const rows = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.key as PermissionKey);
}

/** True when the actor holds every permission in `keys` for the scope being granted. */
export function canGrantPermissions(ctx: TenantContext, keys: readonly PermissionKey[], propertyId: string | null): boolean {
  const scope = propertyId ? { propertyId } : {};
  return keys.every((k) => can(ctx, k, scope));
}

/** Validates role (system or this tenant's), property/department ownership and escalation. */
async function checkGrant(db: Db, ctx: TenantContext, input: z.output<typeof assignmentSchema>) {
  authorize(ctx, "staff.manage", input.propertyId ? { propertyId: input.propertyId } : {});
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, input.roleId), or(isNull(roles.tenantId), eq(roles.tenantId, ctx.tenantId))));
  if (!role) throw new z.ZodError([{ code: "custom", path: ["roleId"], message: "Choose a role", input: input.roleId }]);
  if (input.departmentId && !input.propertyId) {
    throw new z.ZodError([{ code: "custom", path: ["departmentId"], message: "Choose a property for a department", input: "" }]);
  }
  if (input.propertyId) {
    const [p] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, input.propertyId), eq(properties.tenantId, ctx.tenantId)));
    if (!p) throw new z.ZodError([{ code: "custom", path: ["propertyId"], message: "Choose a property", input: input.propertyId }]);
  }
  if (input.departmentId) {
    const [d] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(eq(departments.id, input.departmentId), eq(departments.propertyId, input.propertyId!), eq(departments.tenantId, ctx.tenantId)),
      );
    if (!d) throw new z.ZodError([{ code: "custom", path: ["departmentId"], message: "Choose a department of that property", input: "" }]);
  }
  const keys = await rolePermissionKeys(db, role.id);
  if (!canGrantPermissions(ctx, keys, input.propertyId)) {
    throw forbidden("You can only give roles whose permissions you have yourself for that scope.");
  }
  return role;
}

// ---------------------------------------------------------------- listing

export async function listStaff(db: Db, ctx: TenantContext) {
  authorize(ctx, "staff.view");
  const members = await db
    .select({
      membershipId: tenantMemberships.id,
      status: tenantMemberships.status,
      userId: users.id,
      name: users.name,
      email: users.email,
      userStatus: users.status,
      lastLoginAt: users.lastLoginAt,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(eq(tenantMemberships.tenantId, ctx.tenantId))
    .orderBy(asc(users.name))
    .limit(500);
  const assignments = await listAssignments(db, ctx, members.map((m) => m.membershipId));
  return members.map((m) => ({ ...m, assignments: assignments.filter((a) => a.membershipId === m.membershipId) }));
}

async function listAssignments(db: Db, ctx: TenantContext, membershipIds: string[]) {
  if (membershipIds.length === 0) return [];
  return db
    .select({
      id: userRoleAssignments.id,
      membershipId: userRoleAssignments.membershipId,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      propertyId: userRoleAssignments.propertyId,
      propertyName: properties.name,
      departmentId: userRoleAssignments.departmentId,
      departmentName: departments.name,
    })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .leftJoin(properties, eq(properties.id, userRoleAssignments.propertyId))
    .leftJoin(departments, eq(departments.id, userRoleAssignments.departmentId))
    .where(and(eq(userRoleAssignments.tenantId, ctx.tenantId), inArray(userRoleAssignments.membershipId, membershipIds)))
    .orderBy(asc(roles.name));
}

export async function getMember(db: Db, ctx: TenantContext, membershipId: string) {
  authorize(ctx, "staff.view");
  const id = z.uuid().safeParse(membershipId);
  if (!id.success) throw notFound("Staff member not found.");
  const [m] = await db
    .select({
      membershipId: tenantMemberships.id,
      status: tenantMemberships.status,
      userId: users.id,
      name: users.name,
      email: users.email,
      lastLoginAt: users.lastLoginAt,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.id, id.data), eq(tenantMemberships.tenantId, ctx.tenantId)));
  if (!m) throw notFound("Staff member not found.");
  return { ...m, assignments: await listAssignments(db, ctx, [m.membershipId]) };
}

/** Roles the actor could grant (tenant-wide), for pickers. The server re-checks per scope. */
export async function listGrantableRoles(db: Db, ctx: TenantContext) {
  const rows = await db
    .select({ id: roles.id, key: roles.key, name: roles.name, isSystem: roles.isSystem })
    .from(roles)
    .where(or(isNull(roles.tenantId), eq(roles.tenantId, ctx.tenantId)))
    .orderBy(desc(roles.isSystem), asc(roles.name));
  const out = [];
  for (const r of rows) {
    const keys = await rolePermissionKeys(db, r.id);
    const tenantWide = canGrantPermissions(ctx, keys, null);
    // Property-scoped actors may still grant within their property; show the role if any grant could succeed.
    const somewhere = tenantWide || ctx.grants.some((g) => g.propertyId && canGrantPermissions(ctx, keys, g.propertyId));
    if (somewhere) out.push({ ...r, tenantWide });
  }
  return out;
}

// ---------------------------------------------------------------- guards

async function assertNotSelf(ctx: TenantContext, membershipId: string) {
  if (membershipId === ctx.membershipId) throw forbidden("You cannot change your own access. Ask another owner or manager.");
}

async function activeOwnerCount(db: Db, tenantId: string, excluding: { membershipId?: string; assignmentId?: string } = {}) {
  const [row] = await db
    .select({ n: count() })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .innerJoin(tenantMemberships, eq(tenantMemberships.id, userRoleAssignments.membershipId))
    .where(
      and(
        eq(userRoleAssignments.tenantId, tenantId),
        isNull(roles.tenantId),
        eq(roles.key, "owner"),
        isNull(userRoleAssignments.propertyId),
        eq(tenantMemberships.status, "active"),
        excluding.membershipId ? ne(tenantMemberships.id, excluding.membershipId) : undefined,
        excluding.assignmentId ? ne(userRoleAssignments.id, excluding.assignmentId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

/** Changing someone who holds more power than you is escalation by the back door. */
async function assertCanManageMember(db: Db, ctx: TenantContext, membershipId: string) {
  const member = await getMember(db, ctx, membershipId);
  await assertNotSelf(ctx, member.membershipId);
  for (const a of member.assignments) {
    const keys = await rolePermissionKeys(db, a.roleId);
    if (!canGrantPermissions(ctx, keys, a.propertyId)) {
      throw forbidden("This person has access you don't have, so you can't change their account.");
    }
  }
  return member;
}

// ---------------------------------------------------------------- mutations

export async function addAssignment(db: Db, ctx: TenantContext, membershipId: string, raw: AssignmentInput) {
  assertTenantWritable(ctx);
  const member = await assertCanManageMember(db, ctx, membershipId);
  const input = assignmentSchema.parse(raw);
  const role = await checkGrant(db, ctx, input);
  const dup = member.assignments.some(
    (a) => a.roleId === role.id && a.propertyId === input.propertyId && a.departmentId === input.departmentId,
  );
  if (dup) throw conflict("This person already has that role and scope.");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(userRoleAssignments)
      .values({ tenantId: ctx.tenantId, membershipId: member.membershipId, ...input, roleId: role.id, createdByUserId: ctx.userId })
      .returning();
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "staff.role_assigned",
      entityType: "membership",
      entityId: member.membershipId,
      metadata: { role: role.key, propertyId: input.propertyId, departmentId: input.departmentId },
    });
    return row;
  });
}

export async function removeAssignment(db: Db, ctx: TenantContext, membershipId: string, assignmentId: string) {
  assertTenantWritable(ctx);
  const member = await assertCanManageMember(db, ctx, membershipId);
  const a = member.assignments.find((x) => x.id === assignmentId);
  if (!a) throw notFound("Role not found.");
  authorize(ctx, "staff.manage", a.propertyId ? { propertyId: a.propertyId } : {});
  if (a.roleKey === "owner" && !a.propertyId && (await activeOwnerCount(db, ctx.tenantId, { assignmentId: a.id })) === 0) {
    throw conflict("The hotel must keep at least one owner.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(userRoleAssignments).where(and(eq(userRoleAssignments.id, a.id), eq(userRoleAssignments.tenantId, ctx.tenantId)));
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "staff.role_removed",
      entityType: "membership",
      entityId: member.membershipId,
      metadata: { role: a.roleKey, propertyId: a.propertyId, departmentId: a.departmentId },
    });
  });
}

/** Deactivating removes access on the very next request (the context is rebuilt per request). */
export async function setMemberStatus(db: Db, ctx: TenantContext, membershipId: string, status: "active" | "disabled") {
  assertTenantWritable(ctx);
  authorize(ctx, "staff.manage");
  const member = await assertCanManageMember(db, ctx, membershipId);
  if (status === "disabled" && (await activeOwnerCount(db, ctx.tenantId, { membershipId: member.membershipId })) === 0) {
    throw conflict("The hotel must keep at least one active owner.");
  }
  await db.transaction(async (tx) => {
    if (status === "active" && member.status !== "active") await assertWithinLimit(tx, ctx.tenantId, "staffSeats", 1);
    await tx
      .update(tenantMemberships)
      .set({ status })
      .where(and(eq(tenantMemberships.id, member.membershipId), eq(tenantMemberships.tenantId, ctx.tenantId)));
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: status === "disabled" ? "staff.deactivated" : "staff.reactivated",
      entityType: "membership",
      entityId: member.membershipId,
      metadata: { userId: member.userId },
    });
  });
}

// ---------------------------------------------------------------- invitations

export async function createInvitation(db: Db, ctx: TenantContext, raw: InviteInput) {
  assertTenantWritable(ctx);
  const input = inviteSchema.parse(raw);
  const role = await checkGrant(db, ctx, input);
  const [existing] = await db
    .select({ status: tenantMemberships.status })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(users.email, input.email)));
  if (existing) {
    throw conflict(
      existing.status === "active"
        ? "This person is already on your staff. Add a role on their staff page instead."
        : "This person has a deactivated account here. Reactivate them on their staff page.",
    );
  }
  const token = generateQrToken();
  try {
    return await db.transaction(async (tx) => {
      await assertWithinLimit(tx, ctx.tenantId, "staffSeats", 1);
      const [row] = await tx
        .insert(staffInvitations)
        .values({
          tenantId: ctx.tenantId,
          email: input.email,
          name: input.name,
          roleId: role.id,
          propertyId: input.propertyId,
          departmentId: input.departmentId,
          tokenHash: hashQrToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000),
          invitedByUserId: ctx.userId,
        })
        .returning({ id: staffInvitations.id, expiresAt: staffInvitations.expiresAt });
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        actorType: "user",
        action: "staff.invited",
        entityType: "staff_invitation",
        entityId: row.id,
        metadata: { email: input.email, role: role.key, propertyId: input.propertyId, departmentId: input.departmentId },
      });
      // The raw token is returned once, to show/copy the link; only its hash is stored.
      return { id: row.id, token, expiresAt: row.expiresAt };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("There is already an open invitation for this email. Revoke it to send a new one.");
    throw err;
  }
}

export async function listOpenInvitations(db: Db, ctx: TenantContext) {
  authorize(ctx, "staff.view");
  return db
    .select({
      id: staffInvitations.id,
      email: staffInvitations.email,
      name: staffInvitations.name,
      roleName: roles.name,
      propertyName: properties.name,
      departmentName: departments.name,
      expiresAt: staffInvitations.expiresAt,
      createdAt: staffInvitations.createdAt,
    })
    .from(staffInvitations)
    .innerJoin(roles, eq(roles.id, staffInvitations.roleId))
    .leftJoin(properties, eq(properties.id, staffInvitations.propertyId))
    .leftJoin(departments, eq(departments.id, staffInvitations.departmentId))
    .where(and(eq(staffInvitations.tenantId, ctx.tenantId), isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt)))
    .orderBy(desc(staffInvitations.createdAt));
}

export async function revokeInvitation(db: Db, ctx: TenantContext, invitationId: string) {
  assertTenantWritable(ctx);
  authorize(ctx, "staff.manage");
  const id = z.uuid().safeParse(invitationId);
  if (!id.success) throw notFound();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(staffInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(staffInvitations.id, id.data),
          eq(staffInvitations.tenantId, ctx.tenantId),
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
        ),
      )
      .returning({ id: staffInvitations.id, email: staffInvitations.email });
    if (!row) throw notFound("Invitation not found.");
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "staff.invitation_revoked",
      entityType: "staff_invitation",
      entityId: row.id,
      metadata: { email: row.email },
    });
  });
}

/** Public: what the invite page shows. Same "unavailable" for unknown, used, revoked or expired. */
export async function getInvitation(db: Db, token: unknown) {
  if (!isWellFormedQrToken(token)) return null;
  const [row] = await db
    .select({
      email: staffInvitations.email,
      name: staffInvitations.name,
      hotelName: tenants.name,
      tenantStatus: tenants.status,
      roleName: roles.name,
      propertyName: properties.name,
      departmentName: departments.name,
    })
    .from(staffInvitations)
    .innerJoin(tenants, eq(tenants.id, staffInvitations.tenantId))
    .innerJoin(roles, eq(roles.id, staffInvitations.roleId))
    .leftJoin(properties, eq(properties.id, staffInvitations.propertyId))
    .leftJoin(departments, eq(departments.id, staffInvitations.departmentId))
    .where(
      and(
        eq(staffInvitations.tokenHash, hashQrToken(token)),
        isNull(staffInvitations.acceptedAt),
        isNull(staffInvitations.revokedAt),
        gt(staffInvitations.expiresAt, sql`now()`),
      ),
    );
  if (!row || row.tenantStatus === "suspended" || row.tenantStatus === "cancelled") return null;
  const [account] = await db.select({ id: users.id }).from(users).where(eq(users.email, row.email));
  return { ...row, accountExists: Boolean(account) };
}

export const acceptSchema = z.object({ name: nameSchema("Your name").optional(), password: z.string().min(1, "Enter a password").max(200) });

/**
 * Accepts an invitation. New people choose a password (policy enforced); people who already
 * have an account here must prove it with their current password. Single use.
 */
export async function acceptInvitation(db: Db, token: unknown, raw: z.input<typeof acceptSchema>) {
  const invite = await getInvitation(db, token);
  if (!invite) throw notFound("This invitation is no longer valid.");
  const input = acceptSchema.parse(raw);
  const [account] = await db.select().from(users).where(eq(users.email, invite.email));
  let newHash: string | null = null;
  if (account) {
    if (account.status !== "active" || !(await verifyPassword(account.passwordHash, input.password))) {
      throw new AppError("That password doesn't match your existing account.", "validation");
    }
  } else {
    passwordSchema.parse(input.password);
    newHash = await hashPassword(input.password);
  }

  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(staffInvitations)
      .where(and(eq(staffInvitations.tokenHash, hashQrToken(token as string)), isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt)))
      .for("update");
    if (!inv || inv.expiresAt.getTime() < Date.now()) throw notFound("This invitation is no longer valid.");

    let userId = account?.id;
    if (!userId) {
      const [u] = await tx
        .insert(users)
        .values({ email: inv.email, name: input.name ?? inv.name, passwordHash: newHash! })
        .returning({ id: users.id });
      userId = u.id;
    }
    const [membership] = await tx
      .insert(tenantMemberships)
      .values({ tenantId: inv.tenantId, userId, status: "active" })
      .onConflictDoUpdate({ target: [tenantMemberships.tenantId, tenantMemberships.userId], set: { status: "active" } })
      .returning({ id: tenantMemberships.id });
    await tx.insert(userRoleAssignments).values({
      tenantId: inv.tenantId,
      membershipId: membership.id,
      roleId: inv.roleId,
      propertyId: inv.propertyId,
      departmentId: inv.departmentId,
      createdByUserId: inv.invitedByUserId,
    });
    await tx.update(staffInvitations).set({ acceptedAt: new Date(), acceptedUserId: userId }).where(eq(staffInvitations.id, inv.id));
    await writeAudit(tx, {
      tenantId: inv.tenantId,
      actorUserId: userId,
      actorType: "user",
      action: "staff.invitation_accepted",
      entityType: "membership",
      entityId: membership.id,
      metadata: { invitationId: inv.id, newAccount: !account },
    });
    return { userId, tenantId: inv.tenantId, email: inv.email };
  });
}
