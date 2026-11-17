import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { properties, tenants } from "./tenancy";

/**
 * Integrations (Phase 9): PMS / channel manager / POS connectors use the REST API with an
 * API key, and receive signed webhooks. Keys are shown once and stored as an HMAC hash;
 * webhook signing secrets are encrypted at rest (AES-256-GCM) because we must sign with them.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    /** null = every property of the hotel. */
    propertyId: uuid("property_id"),
    name: text("name").notNull(),
    /** First characters of the key, shown in lists so people can tell keys apart. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "api_keys_property_same_tenant_fk",
      columns: [t.propertyId, t.tenantId],
      foreignColumns: [properties.id, properties.tenantId],
    }).onDelete("restrict"),
    uniqueIndex("api_keys_hash_unique").on(t.keyHash),
    index("api_keys_tenant_idx").on(t.tenantId, t.createdAt),
  ],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    url: text("url").notNull(),
    description: text("description"),
    secretCiphertext: text("secret_ciphertext").notNull(),
    events: jsonb("events").$type<string[]>().notNull(),
    active: boolean("active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  },
  (t) => [index("webhook_endpoints_tenant_idx").on(t.tenantId, t.active)],
);
