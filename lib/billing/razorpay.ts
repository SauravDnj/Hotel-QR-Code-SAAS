import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Minimal Razorpay REST client (https://razorpay.com/docs/api/payments/subscriptions/).
 * Everything money-related is created server-side with the secret key; the browser only
 * receives Razorpay's hosted checkout URL. No card data ever reaches this app.
 */

const API = "https://api.razorpay.com/v1";

export function razorpayConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

export function webhookSecret(): string | undefined {
  return serverEnv().RAZORPAY_WEBHOOK_SECRET;
}

/** Constant-time check of `X-Razorpay-Signature` = hex HMAC-SHA256(raw body, webhook secret). */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature.toLowerCase(), "hex"));
}

export interface ProviderSubscription {
  id: string;
  short_url: string;
  status: string;
}

/**
 * Creates a Razorpay subscription for a plan. Only our tenant id goes into `notes` (for
 * support); we never rely on notes when processing webhooks.
 */
export async function createRazorpaySubscription(
  razorpayPlanId: string,
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderSubscription> {
  const env = serverEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new Error("Razorpay is not configured");
  const res = await fetchImpl(`${API}/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    // 120 monthly cycles ≈ 10 years; cancellation ends it earlier.
    body: JSON.stringify({ plan_id: razorpayPlanId, total_count: 120, customer_notify: 1, notes: { tenant_id: tenantId } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Razorpay subscription create failed: HTTP ${res.status}`);
  const json = (await res.json()) as ProviderSubscription;
  if (!json.id || !json.short_url) throw new Error("Unexpected Razorpay response");
  return json;
}
