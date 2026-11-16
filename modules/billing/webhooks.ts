import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { invoices, paymentWebhookEvents, subscriptions } from "@/lib/db/schema";
import type { SubscriptionStatus } from "@/lib/db/schema/enums";
import { verifyWebhookSignature } from "@/lib/billing/razorpay";
import { errorFields, logger } from "@/lib/observability/logger";
import { GRACE_DAYS, setSubscriptionStatus } from "./subscription";

/**
 * Razorpay webhook processing (SAAS_BILLING.md):
 * 1. verify the signature over the RAW body (else 400, nothing stored);
 * 2. record the event id first: a replay hits the unique index and is a no-op (200);
 * 3. find OUR subscription by provider id (never trust notes/amounts from elsewhere);
 * 4. apply the state change only if the event is newer than the last applied one;
 * 5. record receipts for charges (deduplicated by payment id).
 * Card, contact and bank details from the payload are never stored.
 */

interface RazorpayEvent {
  event: string;
  created_at?: number;
  payload?: {
    subscription?: { entity?: { id?: string; status?: string; current_end?: number | null; plan_id?: string } };
    payment?: { entity?: { id?: string; amount?: number; currency?: string; status?: string; invoice_id?: string | null; created_at?: number; subscription_id?: string } };
  };
}

export type WebhookResult =
  | { httpStatus: 400; outcome: "bad_signature" | "bad_payload" }
  | { httpStatus: 503; outcome: "not_configured" }
  | { httpStatus: 200; outcome: "duplicate" | "ignored" | "processed" | "stale" };

const STATUS_FOR_EVENT: Record<string, SubscriptionStatus | undefined> = {
  "subscription.activated": "active",
  "subscription.charged": "active",
  "subscription.resumed": "active",
  "subscription.pending": "past_due",
  "payment.failed": "past_due",
  "subscription.halted": "suspended",
  "subscription.paused": "suspended",
  "subscription.cancelled": "cancelled",
  "subscription.completed": "cancelled",
};

/** Only non-sensitive fields are kept for reconciliation. */
function summarize(e: RazorpayEvent) {
  const s = e.payload?.subscription?.entity;
  const p = e.payload?.payment?.entity;
  return {
    event: e.event,
    created_at: e.created_at ?? null,
    subscription: s ? { id: s.id ?? null, status: s.status ?? null, current_end: s.current_end ?? null, plan_id: s.plan_id ?? null } : null,
    payment: p ? { id: p.id ?? null, amount: p.amount ?? null, currency: p.currency ?? null, status: p.status ?? null, invoice_id: p.invoice_id ?? null } : null,
  };
}

export async function handleRazorpayWebhook(
  db: Db,
  rawBody: string,
  headers: { signature: string | null; eventId: string | null },
  secret: string | undefined,
  now: Date = new Date(),
): Promise<WebhookResult> {
  if (!secret) return { httpStatus: 503, outcome: "not_configured" };
  if (!verifyWebhookSignature(rawBody, headers.signature, secret)) return { httpStatus: 400, outcome: "bad_signature" };

  let event: RazorpayEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayEvent;
    if (typeof event.event !== "string") throw new Error("missing event");
  } catch {
    return { httpStatus: 400, outcome: "bad_payload" };
  }
  // Razorpay sends a unique x-razorpay-event-id; fall back to a hash of the signed body.
  const eventId = (headers.eventId ?? "").slice(0, 100) || `sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
  const providerSubId = event.payload?.subscription?.entity?.id ?? event.payload?.payment?.entity?.subscription_id ?? null;

  try {
    return await db.transaction(async (tx) => {
      const [sub] = providerSubId
        ? await tx.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, providerSubId)).for("update")
        : [];
      const inserted = await tx
        .insert(paymentWebhookEvents)
        .values({
          provider: "razorpay",
          eventId,
          eventType: event.event.slice(0, 80),
          tenantId: sub?.tenantId ?? null,
          payload: summarize(event),
          status: sub ? "processed" : "ignored",
        })
        .onConflictDoNothing()
        .returning({ id: paymentWebhookEvents.id });
      if (inserted.length === 0) return { httpStatus: 200, outcome: "duplicate" } as const;
      if (!sub) return { httpStatus: 200, outcome: "ignored" } as const;

      // Receipts are facts: record them even if the status part of the event is stale.
      const pay = event.payload?.payment?.entity;
      if (event.event === "subscription.charged" && pay?.id && typeof pay.amount === "number") {
        await tx
          .insert(invoices)
          .values({
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
            provider: "razorpay",
            providerPaymentId: pay.id,
            providerInvoiceId: pay.invoice_id ?? null,
            amountMinor: pay.amount,
            currency: (pay.currency ?? "INR").toUpperCase().slice(0, 3),
            status: pay.status ?? "captured",
            paidAt: pay.created_at ? new Date(pay.created_at * 1000) : now,
            periodEnd: event.payload?.subscription?.entity?.current_end ? new Date(event.payload.subscription.entity.current_end * 1000) : null,
          })
          .onConflictDoNothing();
      }

      const target = STATUS_FOR_EVENT[event.event];
      if (!target) return { httpStatus: 200, outcome: "processed" } as const;
      const eventAt = event.created_at ? new Date(event.created_at * 1000) : now;
      if (sub.lastEventAt && eventAt < sub.lastEventAt) {
        await tx.update(paymentWebhookEvents).set({ status: "ignored", error: "stale" }).where(eq(paymentWebhookEvents.eventId, eventId));
        return { httpStatus: 200, outcome: "stale" } as const;
      }
      const currentEnd = event.payload?.subscription?.entity?.current_end;
      const extra: Partial<typeof subscriptions.$inferInsert> = { lastEventAt: eventAt };
      if (target === "active") {
        Object.assign(extra, {
          planId: sub.pendingPlanId ?? sub.planId,
          pendingPlanId: null,
          checkoutUrl: null,
          graceEndsAt: null,
          trialEndsAt: null,
          currentPeriodEnd: currentEnd ? new Date(currentEnd * 1000) : sub.currentPeriodEnd,
        });
      }
      if (target === "past_due") extra.graceEndsAt = sub.graceEndsAt ?? new Date(now.getTime() + GRACE_DAYS * 86400_000);
      await setSubscriptionStatus(tx, sub, target, extra, `razorpay:${event.event}`);
      return { httpStatus: 200, outcome: "processed" } as const;
    });
  } catch (err) {
    // Unexpected failure: tell Razorpay to retry (5xx). The event row rolled back with the transaction.
    logger.error("razorpay_webhook_failed", { eventId, ...errorFields(err) });
    throw err;
  }
}
