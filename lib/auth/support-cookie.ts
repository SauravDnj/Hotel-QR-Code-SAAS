import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Super admin access to one hotel's workspace: `tenantId.mode.expiresAtMs.signature`.
 * HMAC-signed so the access level and expiry can't be edited in the browser (the only way to
 * get a cookie is the audited start action). Only honoured for platform admins with 2FA.
 */
export type OperatorMode = "view" | "full";
export const SUPPORT_SESSION_MINUTES = 60;

const sign = (payload: string) => createHmac("sha256", `support-session:${serverEnv().AUTH_SECRET}`).update(payload).digest("base64url");

export function encodeSupportCookie(tenantId: string, mode: OperatorMode, now = Date.now()): string {
  const payload = `${tenantId}.${mode}.${now + SUPPORT_SESSION_MINUTES * 60_000}`;
  return `${payload}.${sign(payload)}`;
}

export function decodeSupportCookie(value: string | undefined, now = Date.now()): { tenantId: string; mode: OperatorMode } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [tenantId, mode, exp, sig] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || (mode !== "view" && mode !== "full") || !/^\d+$/.test(exp)) return null;
  const expected = Buffer.from(sign(`${tenantId}.${mode}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(exp) < now) return null;
  return { tenantId, mode };
}
