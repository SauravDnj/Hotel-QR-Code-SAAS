import { z } from "zod";

/**
 * Server-only environment validation. Errors name the missing variable but never
 * print its value. See hotel-saas-documentation/08-deployment/ENVIRONMENT_VARIABLES.md.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DIRECT_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  APP_URL: z.url(),
  /** Base URL printed in room QR codes; defaults to APP_URL. Must never be a preview URL. */
  GUEST_PORTAL_URL: z.url().optional(),
  /** HMAC key for QR token hashes (Phase 3). Rotating it invalidates every printed QR. */
  QR_TOKEN_PEPPER: z.string().min(32, "QR_TOKEN_PEPPER must be at least 32 characters").optional(),
  /** base64 32-byte AES-256-GCM key for secrets at rest (Wi-Fi passwords, QR tokens). */
  ENCRYPTION_KEY: z
    .string()
    .refine((k) => Buffer.from(k, "base64").length === 32, "ENCRYPTION_KEY must be 32 bytes, base64-encoded")
    .optional(),
  /** Ably API key "keyName:secret" (Phase 4). Without it the staff inbox polls instead. */
  ABLY_API_KEY: z.string().regex(/^[^:\s]+\.[^:\s]+:[^\s]+$/, "ABLY_API_KEY must look like appId.keyId:secret").optional(),
  /** Bearer secret for /api/cron/* (Vercel Cron sends it automatically when set). */
  CRON_SECRET: z.string().min(16).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Vercel preview deployments get a unique URL; use it when APP_URL is not set.
  const appUrl = source.APP_URL || (source.VERCEL_URL ? `https://${source.VERCEL_URL}` : undefined);
  const result = schema.safeParse({ ...source, APP_URL: appUrl });
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment configuration:\n${problems}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
