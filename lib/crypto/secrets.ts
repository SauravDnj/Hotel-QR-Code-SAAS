import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Secrets at rest and QR tokens (Phase 3).
 *
 * - QR tokens: 32 random bytes (256 bits) as base64url, so 43 URL-safe characters. Lookups use
 *   HMAC-SHA256(QR_TOKEN_PEPPER, token): a database leak alone cannot be turned into working
 *   QR URLs, and the hash is deterministic so it can be indexed.
 * - Encrypted values (Wi-Fi passwords, QR tokens kept for reprinting) use AES-256-GCM
 *   with ENCRYPTION_KEY. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url parts).
 */

export const QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function key(name: "QR_TOKEN_PEPPER" | "ENCRYPTION_KEY"): string {
  const value = serverEnv()[name];
  if (!value) throw new Error(`${name} is not configured; QR codes and the guest portal are unavailable.`);
  return value;
}

export function generateQrToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isWellFormedQrToken(token: unknown): token is string {
  return typeof token === "string" && QR_TOKEN_PATTERN.test(token);
}

export function hashQrToken(token: string): string {
  return createHmac("sha256", key("QR_TOKEN_PEPPER")).update(token, "utf8").digest("base64url");
}

/** Constant-time comparison for already-hashed values. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const VERSION = "v1";

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key("ENCRYPTION_KEY"), "base64"), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key("ENCRYPTION_KEY"), "base64"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Public base for QR URLs. Previews must not print their own short-lived domain into a QR. */
export function guestPortalBaseUrl(): string {
  const env = serverEnv();
  return (env.GUEST_PORTAL_URL ?? env.APP_URL).replace(/\/+$/, "");
}

export function guestPortalUrl(token: string): string {
  return `${guestPortalBaseUrl()}/r/${token}`;
}
