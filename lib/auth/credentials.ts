import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { users } from "@/lib/db/schema";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { burnPasswordCheck, normalizeEmail, verifyPassword } from "./password";

const loginSchema = z.object({
  email: z.string().max(254),
  password: z.string().min(1).max(200),
});

export type CredentialResult =
  | { ok: true; user: { id: string; email: string; name: string; sessionVersion: number } }
  | { ok: false; reason: "invalid" | "rate_limited" };

/**
 * Checks email/password with rate limiting by email and by IP. The response is the
 * same for unknown email, wrong password and disabled account.
 */
export async function verifyCredentials(
  db: Db,
  raw: unknown,
  ip: string | null,
): Promise<CredentialResult> {
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

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return {
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion },
  };
}
