import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { invoices, plans, subscriptions } from "@/lib/db/schema";
import { createRazorpaySubscription, razorpayConfigured } from "@/lib/billing/razorpay";
import { AppError, conflict, notFound } from "@/lib/errors";
import { authorize, type TenantContext } from "@/lib/permissions/authorize";
import { writeAudit } from "@/modules/audit/service";
import { listActivePlans } from "./plans";
import { getSubscriptionWithPlan, usage } from "./subscription";

/**
 * Owner billing view and checkout. Works for suspended tenants too (no assertTenantWritable):
 * paying is how a suspended hotel gets back in. Amounts and plans come only from our DB and
 * Razorpay; nothing the browser sends decides what is charged.
 */
export async function getBillingOverview(db: Db, ctx: TenantContext) {
  authorize(ctx, "billing.view");
  const [{ subscription, plan }, used, available, receipts] = await Promise.all([
    getSubscriptionWithPlan(db, ctx.tenantId),
    usage(db, ctx.tenantId),
    listActivePlans(db),
    db
      .select({
        id: invoices.id,
        amountMinor: invoices.amountMinor,
        currency: invoices.currency,
        status: invoices.status,
        paidAt: invoices.paidAt,
        periodEnd: invoices.periodEnd,
        providerPaymentId: invoices.providerPaymentId,
      })
      .from(invoices)
      .where(eq(invoices.tenantId, ctx.tenantId))
      .orderBy(desc(invoices.createdAt))
      .limit(50),
  ]);
  const pendingPlan = subscription.pendingPlanId ? available.find((p) => p.id === subscription.pendingPlanId) ?? null : null;
  return { subscription, plan, pendingPlan, usage: used, plans: available, receipts, paymentsEnabled: razorpayConfigured() };
}

/** Creates a Razorpay subscription for the chosen plan and returns the hosted checkout URL. */
export async function startCheckout(db: Db, ctx: TenantContext, planId: string, fetchImpl?: typeof fetch) {
  authorize(ctx, "billing.manage");
  if (!razorpayConfigured()) throw new AppError("Online payment isn't set up yet. Please contact support.", "conflict");
  const id = z.uuid().safeParse(planId);
  if (!id.success) throw notFound("Plan not found.");
  const [plan] = await db.select().from(plans).where(eq(plans.id, id.data));
  if (!plan || !plan.active) throw notFound("Plan not found.");
  if (!plan.razorpayPlanId) throw conflict("This plan can't be bought online yet. Please contact support.");
  const { subscription } = await getSubscriptionWithPlan(db, ctx.tenantId);
  if (subscription.status === "active" && subscription.providerSubscriptionId) {
    throw conflict("You already have an active paid subscription. Contact support to change plans.");
  }
  const provider = await createRazorpaySubscription(plan.razorpayPlanId, ctx.tenantId, fetchImpl);
  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({ provider: "razorpay", providerSubscriptionId: provider.id, pendingPlanId: plan.id, checkoutUrl: provider.short_url })
      .where(eq(subscriptions.id, subscription.id));
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "billing.checkout_started",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: { plan: plan.key, providerSubscriptionId: provider.id },
    });
  });
  return { url: provider.short_url };
}
