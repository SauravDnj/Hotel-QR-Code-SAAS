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
  /** Razorpay (Phase 7). Use TEST mode keys until the commercial launch. */
  RAZORPAY_KEY_ID: z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/, "RAZORPAY_KEY_ID must look like rzp_test_…").optional(),
  RAZORPAY_KEY_SECRET: z.string().min(10).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(8).optional(),
  /** Web Push VAPID keys (Phase 9): staff phone notifications. Generate with `npx web-push generate-vapid-keys`. */
  VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/, "VAPID_PUBLIC_KEY must be a base64url P-256 public key").optional(),
  VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{40,50}$/, "VAPID_PRIVATE_KEY must be a base64url P-256 private key").optional(),
  /** Contact for push services, "mailto:…" or an https URL. */
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/, "VAPID_SUBJECT must start with mailto: or https://").optional(),
  /** Twilio (Phase 9): SMS / WhatsApp escalation alerts. Optional. */
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-f]{32}$/, "TWILIO_ACCOUNT_SID must look like AC…").optional(),
  TWILIO_AUTH_TOKEN: z.string().min(16).optional(),
  /** E.164 sender for SMS, e.g. +14155550123 (or a Messaging Service SID MG…). */
  TWILIO_SMS_FROM: z.string().regex(/^(\+[1-9]\d{6,14}|MG[0-9a-f]{32})$/).optional(),
  /** E.164 WhatsApp-enabled sender. */
  TWILIO_WHATSAPP_FROM: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  /** Approved WhatsApp template (Content SID HX…) with variables {{1}} = room, {{2}} = service, {{3}} = minutes. */
  TWILIO_WHATSAPP_CONTENT_SID: z.string().regex(/^HX[0-9a-f]{32}$/).optional(),
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
