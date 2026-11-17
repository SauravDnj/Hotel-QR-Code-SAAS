import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { subscriptionStatus } from "./enums";
import { tenants, timestamps } from "./tenancy";

/**
 * Commercial plans (SAAS_BILLING.md). Prices and limits live in the DATABASE as structured
 * entitlements, edited by SaaS operators; business logic reads them, never hardcodes them.
 */
export interface Entitlements {
  maxRooms: number;
  maxProperties: number;
  maxStaffSeats: number;
  /** integrations (Phase 9): API keys, webhooks, POS postings. Missing = false. */
  modules: { reports: boolean; integrations?: boolean };
}

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  /** Monthly price in minor units (paise for INR). Display only; Razorpay charges its own plan. */
  priceMinor: integer("price_minor").notNull(),
  currency: text("currency").notNull().default("INR"),
  /** Razorpay plan id (plan_…) used when creating subscriptions server-side. */
  razorpayPlanId: text("razorpay_plan_id"),
  entitlements: jsonb("entitlements").$type<Entitlements>().notNull(),
  trialDays: integer("trial_days").notNull().default(14),
  /** Plan given to new hotels during their trial. Exactly one should be true. */
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

/** One current subscription per tenant; the source of truth for billing state. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatus("status").notNull().default("trialing"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    /** While past_due: operations continue until this moment, then the tenant is suspended. */
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    provider: text("provider"),
    providerSubscriptionId: text("provider_subscription_id"),
    /** Plan the owner chose at checkout; becomes planId once the provider confirms payment. */
    pendingPlanId: uuid("pending_plan_id").references(() => plans.id),
    checkoutUrl: text("checkout_url"),
    /** Provider event time of the last applied event; older events never roll state back. */
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscriptions_tenant_unique").on(t.tenantId),
    uniqueIndex("subscriptions_provider_id_unique").on(t.providerSubscriptionId),
  ],
);

/** Receipts for successful charges, created only from verified provider events. */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    providerInvoiceId: text("provider_invoice_id"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invoices_provider_payment_unique").on(t.provider, t.providerPaymentId), index("invoices_tenant_idx").on(t.tenantId, t.createdAt)],
);

/**
 * Every webhook delivery, deduplicated by provider event id (replays are no-ops). Payloads
 * are stored minus card/contact details for reconciliation and support.
 */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** processed | ignored | failed */
    status: text("status").notNull(),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_webhook_events_unique").on(t.provider, t.eventId)],
);
