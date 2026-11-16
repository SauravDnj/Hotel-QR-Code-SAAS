import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { passwordResetTokens, users } from "@/lib/db/schema";
import { hashPassword, normalizeEmail, verifyPassword } from "@/lib/auth/password";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/lib/auth/totp";
import { decryptSecret, encryptSecret, generateQrToken, hashQrToken, isWellFormedQrToken } from "@/lib/crypto/secrets";
import { AppError, conflict, forbidden, notFound } from "@/lib/errors";
import { passwordSchema } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import type { PlatformActor } from "@/modules/platform/service";

/**
 * Account security (Phase 8): TOTP two-step sign-in and operator-assisted recovery.
 * - Required for SaaS operators (console blocked until enabled); optional for hotel staff.
 * - Enabling, disabling, resetting and password changes bump session_version, so every
 *   existing session must sign in again.
 */

const invalidCode = () => new AppError("That code didn't match. Check your phone's time and try again.", "validation");

async function getUser(db: Db, userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw notFound();
  return u;
}

export async function mfaStatus(db: Db, userId: string) {
  const u = await getUser(db, userId);
  return { enabled: Boolean(u.mfaEnabledAt), enabledAt: u.mfaEnabledAt, pending: !u.mfaEnabledAt && Boolean(u.mfaSecretCiphertext) };
}

/** Starts (or restarts) enrollment with a fresh secret; returns what the authenticator app needs. */
export async function beginMfaEnrollment(db: Db, userId: string) {
  const u = await getUser(db, userId);
  if (u.mfaEnabledAt) throw conflict("Two-step sign-in is already on.");
  const secret = generateTotpSecret();
  await db.update(users).set({ mfaSecretCiphertext: encryptSecret(secret), mfaLastStep: null }).where(eq(users.id, u.id));
  return { secret, url: otpauthUrl(secret, u.email) };
}

/** The pending secret again (to re-show the QR code until confirmed). */
export async function pendingEnrollment(db: Db, userId: string) {
  const u = await getUser(db, userId);
  if (u.mfaEnabledAt || !u.mfaSecretCiphertext) return null;
  const secret = decryptSecret(u.mfaSecretCiphertext);
  return { secret, url: otpauthUrl(secret, u.email) };
}

export async function confirmMfaEnrollment(db: Db, userId: string, code: string, now: Date = new Date()) {
  const u = await getUser(db, userId);
  if (u.mfaEnabledAt) throw conflict("Two-step sign-in is already on.");
  if (!u.mfaSecretCiphertext) throw conflict("Start setup first.");
  const step = verifyTotp(decryptSecret(u.mfaSecretCiphertext), code.replace(/\s+/g, ""), { now: now.getTime() });
  if (step === null) throw invalidCode();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ mfaEnabledAt: now, mfaLastStep: step, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, u.id));
    await writeAudit(tx, { tenantId: null, actorUserId: u.id, actorType: "user", action: "user.mfa_enabled", entityType: "user", entityId: u.id });
  });
}

/** Hotel staff may turn it off with password + current code; SaaS operators may not. */
export async function disableMfa(db: Db, userId: string, raw: { password?: string; code?: string }, now: Date = new Date()) {
  const u = await getUser(db, userId);
  if (u.isPlatformAdmin) throw forbidden("SaaS operators must keep two-step sign-in on.");
  if (!u.mfaEnabledAt || !u.mfaSecretCiphertext) throw conflict("Two-step sign-in is not on.");
  if (!(await verifyPassword(u.passwordHash, raw.password ?? ""))) throw new AppError("Your password is incorrect.", "validation");
  if (verifyTotp(decryptSecret(u.mfaSecretCiphertext), (raw.code ?? "").replace(/\s+/g, ""), { now: now.getTime(), lastStep: u.mfaLastStep }) === null) {
    throw invalidCode();
  }
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ mfaEnabledAt: null, mfaSecretCiphertext: null, mfaLastStep: null, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, u.id));
    await writeAudit(tx, { tenantId: null, actorUserId: u.id, actorType: "user", action: "user.mfa_disabled", entityType: "user", entityId: u.id });
  });
}

// ---------------------------------------------------------------- operator-assisted recovery

const recoverySchema = z.object({
  email: z.email("Enter a valid email").transform(normalizeEmail),
  reason: z.string().trim().min(3, "Give a reason (min 3 characters)").max(500),
});

async function userByEmail(db: Db, email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u) throw notFound("No account with that email.");
  return u;
}

/** Lost phone: clears the authenticator so the person can enroll again. Audited. */
export async function operatorResetMfa(db: Db, actor: PlatformActor, raw: z.input<typeof recoverySchema>) {
  if (!actor.isPlatformAdmin) throw forbidden();
  const input = recoverySchema.parse(raw);
  const u = await userByEmail(db, input.email);
  if (u.id === actor.userId) throw forbidden("Ask another operator to reset your own two-step sign-in.");
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ mfaEnabledAt: null, mfaSecretCiphertext: null, mfaLastStep: null, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, u.id));
    await writeAudit(tx, {
      tenantId: null,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: "platform.user_mfa_reset",
      entityType: "user",
      entityId: u.id,
      metadata: { reason: input.reason },
    });
  });
}

export const RESET_TTL_MINUTES = 60;

/**
 * Forgotten password: an operator verifies the person out of band, then creates a one-time
 * link (shown once) to give them. Only the token's HMAC is stored.
 */
export async function createPasswordResetLink(db: Db, actor: PlatformActor, raw: z.input<typeof recoverySchema>) {
  if (!actor.isPlatformAdmin) throw forbidden();
  const input = recoverySchema.parse(raw);
  const u = await userByEmail(db, input.email);
  const token = generateQrToken();
  await db.transaction(async (tx) => {
    // Any older unused links stop working.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, u.id), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({
      userId: u.id,
      tokenHash: hashQrToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      createdByUserId: actor.userId,
    });
    await writeAudit(tx, {
      tenantId: null,
      actorUserId: actor.userId,
      actorType: "platform_admin",
      action: "platform.password_reset_link_created",
      entityType: "user",
      entityId: u.id,
      metadata: { reason: input.reason },
    });
  });
  return { token };
}

export async function getResetToken(db: Db, token: unknown) {
  if (!isWellFormedQrToken(token)) return null;
  const [row] = await db
    .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId, email: users.email })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashQrToken(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, sql`now()`),
      ),
    );
  return row ?? null;
}

/** Sets the new password, burns the link and signs out every session. MFA is unchanged. */
export async function resetPassword(db: Db, token: unknown, newPassword: string) {
  const row = await getResetToken(db, token);
  if (!row) throw notFound("This reset link is no longer valid.");
  const passwordHash = await hashPassword(passwordSchema.parse(newPassword));
  await db.transaction(async (tx) => {
    const used = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (used.length === 0) throw notFound("This reset link is no longer valid.");
    await tx.update(users).set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, row.userId));
    await writeAudit(tx, { tenantId: null, actorUserId: row.userId, actorType: "user", action: "user.password_reset", entityType: "user", entityId: row.userId });
  });
  return { email: row.email };
}
