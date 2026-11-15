/**
 * Best-effort client IP for rate limiting. On Vercel, x-forwarded-for is set by the
 * platform edge; the first entry is the client.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 64) || null;
  return headers.get("x-real-ip")?.slice(0, 64) ?? null;
}
