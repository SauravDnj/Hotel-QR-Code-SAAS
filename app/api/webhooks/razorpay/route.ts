import { webhookSecret } from "@/lib/billing/razorpay";
import { getDb } from "@/lib/db/client";
import { handleRazorpayWebhook } from "@/modules/billing/webhooks";

/**
 * Razorpay webhook. The signature is verified over the exact raw body; replays are no-ops.
 * Returns 2xx only after the event is durably recorded, 5xx on unexpected errors so
 * Razorpay retries. No session/cookies involved.
 */
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 512_000) return new Response("Payload too large", { status: 413 });
  const raw = await request.text();
  if (raw.length > 512_000) return new Response("Payload too large", { status: 413 });
  const result = await handleRazorpayWebhook(
    getDb(),
    raw,
    { signature: request.headers.get("x-razorpay-signature"), eventId: request.headers.get("x-razorpay-event-id") },
    webhookSecret(),
  );
  return Response.json({ outcome: result.outcome }, { status: result.httpStatus });
}
