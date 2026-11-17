import { sql } from "drizzle-orm";
import { foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantMemberships } from "./identity";
import { tenants } from "./tenancy";

/**
 * Web Push subscriptions (Phase 9). One row per browser/device per hotel membership. The
 * endpoint is a capability URL issued by the browser's push service; it is treated as a
 * secret (never logged, never shown) and deleted when the push service reports it gone.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** Short device label for "my devices" (browser + OS), never the full user agent. */
    label: text("label"),
    failures: integer("failures").notNull().default(0),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "push_subscriptions_membership_same_tenant_fk",
      columns: [t.membershipId, t.tenantId],
      foreignColumns: [tenantMemberships.id, tenantMemberships.tenantId],
    }).onDelete("cascade"),
    uniqueIndex("push_subscriptions_membership_endpoint_unique").on(t.membershipId, t.endpoint),
    index("push_subscriptions_tenant_idx").on(t.tenantId, t.membershipId),
  ],
);
