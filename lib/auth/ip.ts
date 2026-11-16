/**
 * Client IP for rate limiting. Prefer `x-real-ip`, which Vercel's edge sets to the connecting
 * client and does not take from the request. Fall back to the first `x-forwarded-for` entry
 * (local/other proxies). Never used for authorization, only for throttling.
 */
export function clientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 64) || null;
  return null;
}
