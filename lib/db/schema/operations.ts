import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { tenants } from "./tenancy";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // null for platform-level events that are not tied to one tenant.
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorType: text("actor_type").notNull(), // user | platform_admin | system
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    // Safe metadata only: never secrets, tokens or full payment data.
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

// Fixed-window rate limit counters. Stored in Postgres so limits hold across
// serverless instances (no in-memory state on Vercel).
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});
