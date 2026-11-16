import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { rateLimits } from "@/lib/db/schema";

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  loginByEmail: { limit: 5, windowSeconds: 15 * 60 },
  loginByIp: { limit: 30, windowSeconds: 15 * 60 },
  signupByIp: { limit: 5, windowSeconds: 60 * 60 },
  // Public QR portal: generous for real guests (a family on hotel Wi-Fi shares one IP),
  // but enough to make token guessing pointless on top of the 256-bit token space.
  qrScanByIp: { limit: 120, windowSeconds: 60 },
  qrScanByCode: { limit: 60, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Atomically counts one attempt in a fixed window and reports whether it is allowed.
 * A single upsert keeps it race-free across concurrent serverless instances.
 */
export async function consumeRateLimit(
  db: Db,
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<{ allowed: boolean; count: number }> {
  const windowStart = new Date(
    Math.floor(now.getTime() / (rule.windowSeconds * 1000)) * rule.windowSeconds * 1000,
  );
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} = excluded.window_start then ${rateLimits.count} + 1 else 1 end`,
        windowStart: sql`excluded.window_start`,
      },
    })
    .returning({ count: rateLimits.count });
  return { allowed: row.count <= rule.limit, count: row.count };
}
