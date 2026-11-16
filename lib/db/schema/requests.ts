import { isNull, sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { requestPriority, requestStatus, serviceNoteMode } from "./enums";
import { roomQrCodes } from "./guest";
import { users } from "./identity";
import { departments, rooms } from "./structure";
import { properties, tenants, timestamps } from "./tenancy";

/**
 * Guest service catalogue (Phase 4). One row per service tile per property; each routes to
 * a department of the SAME property (composite FK).
 */
export const serviceItems = pgTable(
  "service_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").notNull(),
    departmentId: uuid("department_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon").notNull().default("bell"),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    /** 0 = no quantity field; otherwise the maximum a guest may choose. */
    maxQuantity: integer("max_quantity").notNull().default(0),
    /** Choices offered to the guest (e.g. maintenance categories). Empty = none. */
    options: jsonb("options").$type<string[]>().notNull().default([]),
    noteMode: serviceNoteMode("note_mode").notNull().default("optional"),
    /** Local property time HH:MM; both null = always available. */
    availableFrom: text("available_from"),
    availableTo: text("available_to"),
    ackMessage: text("ack_message"),
    priority: requestPriority("priority").notNull().default("normal"),
    targetMinutes: integer("target_minutes").notNull().default(15),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "service_items_property_fk",
      columns: [t.propertyId, t.tenantId],
      foreignColumns: [properties.id, properties.tenantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "service_items_department_scope_fk",
      columns: [t.departmentId, t.propertyId, t.tenantId],
      foreignColumns: [departments.id, departments.propertyId, departments.tenantId],
    }).onDelete("restrict"),
    unique("service_items_id_scope_unique").on(t.id, t.propertyId, t.tenantId),
    uniqueIndex("service_items_property_key_live_unique").on(t.propertyId, t.key).where(isNull(t.archivedAt)),
    index("service_items_scope_idx").on(t.tenantId, t.propertyId, t.sortOrder),
  ],
);

/**
 * A guest request. Tenant, property and room come from the QR code on the server; the
 * service and department names are snapshotted so later catalogue edits never rewrite history.
 */
export const serviceRequests = pgTable(
  "service_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").notNull(),
    roomId: uuid("room_id").notNull(),
    qrCodeId: uuid("qr_code_id")
      .notNull()
      .references(() => roomQrCodes.id, { onDelete: "restrict" }),
    serviceItemId: uuid("service_item_id").notNull(),
    departmentId: uuid("department_id").notNull(),
    serviceName: text("service_name").notNull(),
    departmentName: text("department_name").notNull(),
    roomCode: text("room_code").notNull(),
    status: requestStatus("status").notNull().default("new"),
    priority: requestPriority("priority").notNull().default("normal"),
    targetMinutes: integer("target_minutes").notNull().default(15),
    quantity: integer("quantity"),
    option: text("option"),
    guestNote: text("guest_note"),
    /** Message shown to the guest; separate from internal staff notes in the history. */
    guestMessage: text("guest_message"),
    ackMessage: text("ack_message"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    /** Client-generated per form render; makes double taps and retries idempotent. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** HMAC of the guest status token (lookup) + AES-GCM copy (to answer idempotent retries). */
    guestTokenHash: text("guest_token_hash").notNull(),
    guestTokenCiphertext: text("guest_token_ciphertext").notNull(),
    guestTokenExpiresAt: timestamp("guest_token_expires_at", { withTimezone: true }).notNull(),
    cancelReason: text("cancel_reason"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      name: "service_requests_room_scope_fk",
      columns: [t.roomId, t.propertyId, t.tenantId],
      foreignColumns: [rooms.id, rooms.propertyId, rooms.tenantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "service_requests_service_scope_fk",
      columns: [t.serviceItemId, t.propertyId, t.tenantId],
      foreignColumns: [serviceItems.id, serviceItems.propertyId, serviceItems.tenantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "service_requests_department_scope_fk",
      columns: [t.departmentId, t.propertyId, t.tenantId],
      foreignColumns: [departments.id, departments.propertyId, departments.tenantId],
    }).onDelete("restrict"),
    unique("service_requests_idempotency_unique").on(t.tenantId, t.idempotencyKey),
    uniqueIndex("service_requests_guest_token_unique").on(t.guestTokenHash),
    index("service_requests_inbox_idx").on(t.tenantId, t.propertyId, t.status, t.submittedAt),
    index("service_requests_department_idx").on(t.tenantId, t.departmentId, t.status),
    index("service_requests_updated_idx").on(t.tenantId, t.updatedAt),
  ],
);

/** Immutable transition log (REQUEST_STATE_MACHINE.md "Required history"). */
export const requestStatusHistory = pgTable(
  "request_status_history",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "restrict" }),
    fromStatus: requestStatus("from_status"),
    toStatus: requestStatus("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    /** guest | staff | system */
    source: text("source").notNull(),
    /** Internal note; never shown to guests. */
    note: text("note"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("request_status_history_request_idx").on(t.tenantId, t.requestId, t.changedAt)],
);

export const requestAssignments = pgTable(
  "request_assignments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    assignedByUserId: uuid("assigned_by_user_id").references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("request_assignments_request_idx").on(t.tenantId, t.requestId)],
);

/**
 * Transactional outbox: written in the same transaction as the change, published to the
 * realtime provider afterwards, retried with backoff. Realtime is never the only record.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    eventType: text("event_type").notNull(),
    /** Channel names to publish on (computed at write time). */
    channels: jsonb("channels").$type<string[]>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** pending | published | skipped | dead */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("outbox_events_pending_idx").on(t.status, t.nextAttemptAt)],
);
