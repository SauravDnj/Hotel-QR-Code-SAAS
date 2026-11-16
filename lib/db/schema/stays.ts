import { sql } from "drizzle-orm";
import { foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { housekeepingTaskStatus, housekeepingTaskType, stayStatus } from "./enums";
import { users } from "./identity";
import { rooms } from "./structure";
import { tenants } from "./tenancy";

/**
 * Guests and stays (Phase 6). Minimal PII by design (DATA_DICTIONARY.md "Minimize personal
 * data"): a name and optional contact. Guests are tenant-private and never reachable from
 * the public QR portal.
 */
export const guests = pgTable(
  "guests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("guests_id_tenant_unique").on(t.id, t.tenantId), index("guests_tenant_idx").on(t.tenantId, t.createdAt)],
);

/** An occupancy interval. At most one checked-in stay per room (partial unique index). */
export const stays = pgTable(
  "stays",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").notNull(),
    roomId: uuid("room_id").notNull(),
    guestId: uuid("guest_id").notNull(),
    status: stayStatus("status").notNull().default("checked_in"),
    adults: integer("adults").notNull().default(1),
    checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull().defaultNow(),
    expectedCheckoutAt: timestamp("expected_checkout_at", { withTimezone: true }).notNull(),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    notes: text("notes"),
    checkedInByUserId: uuid("checked_in_by_user_id").references(() => users.id),
    checkedOutByUserId: uuid("checked_out_by_user_id").references(() => users.id),
  },
  (t) => [
    foreignKey({
      name: "stays_room_scope_fk",
      columns: [t.roomId, t.propertyId, t.tenantId],
      foreignColumns: [rooms.id, rooms.propertyId, rooms.tenantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "stays_guest_same_tenant_fk",
      columns: [t.guestId, t.tenantId],
      foreignColumns: [guests.id, guests.tenantId],
    }).onDelete("restrict"),
    uniqueIndex("stays_one_active_per_room").on(t.roomId).where(sql`${t.status} = 'checked_in'`),
    index("stays_room_idx").on(t.tenantId, t.roomId, t.checkInAt),
    index("stays_departures_idx").on(t.tenantId, t.propertyId, t.status, t.expectedCheckoutAt),
  ],
);

/**
 * Cleaning and inspection work. At most one open (open/in_progress) task of each type per
 * room, so a double checkout or retry can never create duplicate cleaning tasks.
 */
export const housekeepingTasks = pgTable(
  "housekeeping_tasks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").notNull(),
    roomId: uuid("room_id").notNull(),
    stayId: uuid("stay_id").references(() => stays.id),
    taskType: housekeepingTaskType("task_type").notNull(),
    status: housekeepingTaskStatus("status").notNull().default("open"),
    /** checkout | inspection_failed | manual */
    reason: text("reason").notNull().default("manual"),
    notes: text("notes"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    completedByUserId: uuid("completed_by_user_id").references(() => users.id),
    /** Inspection result: passed | failed. */
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "housekeeping_tasks_room_scope_fk",
      columns: [t.roomId, t.propertyId, t.tenantId],
      foreignColumns: [rooms.id, rooms.propertyId, rooms.tenantId],
    }).onDelete("restrict"),
    uniqueIndex("housekeeping_tasks_one_open_per_type")
      .on(t.roomId, t.taskType)
      .where(sql`${t.status} in ('open', 'in_progress')`),
    index("housekeeping_tasks_board_idx").on(t.tenantId, t.propertyId, t.status, t.createdAt),
  ],
);
