import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { tenantMemberships, tenants, users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { AppError, notFound } from "@/lib/errors";
import type { TenantContext } from "@/lib/permissions/authorize";
import { nameSchema, passwordSchema } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";

/** A staff member's own profile and notification preferences. Always the caller's own row. */

export async function getProfile(db: Db, ctx: TenantContext) {
  const [row] = await db
    .select({
      name: users.name,
      email: users.email,
      notifySound: tenantMemberships.notifySound,
      notifyScope: tenantMemberships.notifyScope,
      notifyPush: tenantMemberships.notifyPush,
      alertPhone: tenantMemberships.alertPhone,
      escalationChannel: tenantMemberships.escalationChannel,
      timezone: tenants.timezone,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(and(eq(tenantMemberships.id, ctx.membershipId), eq(tenantMemberships.tenantId, ctx.tenantId)));
  if (!row) throw notFound();
  return {
    ...row,
    notifyScope: row.notifyScope === "mine" ? ("mine" as const) : ("all" as const),
    escalationChannel: (["sms", "whatsapp"].includes(row.escalationChannel) ? row.escalationChannel : "none") as "none" | "sms" | "whatsapp",
  };
}

export async function updateName(db: Db, ctx: TenantContext, raw: { name?: string }) {
  const name = nameSchema("Name").parse(raw.name ?? "");
  await db.update(users).set({ name }).where(eq(users.id, ctx.userId));
}

export const prefsSchema = z.object({
  notifySound: z
    .union([z.literal("on"), z.literal(""), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on"),
  notifyScope: z.enum(["all", "mine"]).catch("all"),
  notifyPush: z
    .union([z.literal("on"), z.literal(""), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on"),
  // Escalation alerts by SMS / WhatsApp (Phase 9): a work mobile in international format.
  alertPhone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s()-]/g, ""))
    .refine((v) => v === "" || /^\+[1-9]\d{6,14}$/.test(v), "Use international format, e.g. +919876543210")
    .optional()
    .transform((v) => (v ? v : null)),
  escalationChannel: z.enum(["none", "sms", "whatsapp"]).catch("none"),
}).refine((v) => v.escalationChannel === "none" || v.alertPhone, { path: ["alertPhone"], message: "Add a mobile number for SMS or WhatsApp alerts" });

export async function updateNotificationPrefs(db: Db, ctx: TenantContext, raw: Partial<z.input<typeof prefsSchema>>) {
  const input = prefsSchema.parse(raw);
  await db
    .update(tenantMemberships)
    .set(input)
    .where(and(eq(tenantMemberships.id, ctx.membershipId), eq(tenantMemberships.tenantId, ctx.tenantId)));
}

/**
 * Changes the password and bumps session_version, which signs out every session of this
 * user (including the current one), as the security doc requires after credential changes.
 */
export async function changePassword(db: Db, ctx: TenantContext, raw: { currentPassword?: string; newPassword?: string }) {
  const [user] = await db.select().from(users).where(eq(users.id, ctx.userId));
  if (!user || !(await verifyPassword(user.passwordHash, raw.currentPassword ?? ""))) {
    throw new AppError("Your current password is incorrect.", "validation");
  }
  const next = passwordSchema.parse(raw.newPassword ?? "");
  const passwordHash = await hashPassword(next);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, ctx.userId));
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "user.password_changed",
      entityType: "user",
      entityId: ctx.userId,
    });
  });
}
