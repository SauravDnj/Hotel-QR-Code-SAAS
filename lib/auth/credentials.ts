import { and, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { users } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto/secrets";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { burnPasswordCheck, normalizeEmail, verifyPassword } from "./password";
import { verifyTotp } from "./totp";

const loginSchema = z.object({
  email: z.string().max(254),
  password: z.string().min(1).max(200),
  otp: z
    .string()
    .trim()
    .max(10)
    .optional()
    .transform((v) => (v ? v.replace(/\s+/g, "") : undefined)),
});

export type CredentialResult =
  | { ok: true; user: { id: string; email: string; name: string; sessionVersion: number } }
  | { ok: false; reason: "invalid" | "rate_limited" | "mfa_required" };

/**
 * Checks email/password (and the authenticator code when two-step sign-in is on) with rate
 * limiting by email and by IP. Unknown email, wrong password, wrong code and disabled account
 * all give the same "invalid" answer. A TOTP step is accepted at most once (no replay).
 */
export async function verifyCredentials(db: Db, raw: unknown, ip: string | null, now: Date = new Date()): Promise<CredentialResult> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const email = normalizeEmail(parsed.data.email);

  const byEmail = await consumeRateLimit(db, `login:email:${email}`, RATE_LIMITS.loginByEmail);
  const byIp = ip ? await consumeRateLimit(db, `login:ip:${ip}`, RATE_LIMITS.loginByIp) : { allowed: true };
  if (!byEmail.allowed || !byIp.allowed) return { ok: false, reason: "rate_limited" };

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    await burnPasswordCheck(parsed.data.password);
    return { ok: false, reason: "invalid" };
  }
  const valid = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!valid || user.status !== "active") return { ok: false, reason: "invalid" };

  if (user.mfaEnabledAt && user.mfaSecretCiphertext) {
    if (!parsed.data.otp) return { ok: false, reason: "mfa_required" };
    const step = verifyTotp(decryptSecret(user.mfaSecretCiphertext), parsed.data.otp, { now: now.getTime(), lastStep: user.mfaLastStep });
    if (step === null) return { ok: false, reason: "invalid" };
    // Atomically claim the step: a concurrent login with the same code loses.
    const claimed = await db
      .update(users)
      .set({ mfaLastStep: step })
      .where(and(eq(users.id, user.id), or(isNull(users.mfaLastStep), lt(users.mfaLastStep, step))))
      .returning({ id: users.id });
    if (claimed.length === 0) return { ok: false, reason: "invalid" };
  }

  await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
  return {
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion },
  };
}
