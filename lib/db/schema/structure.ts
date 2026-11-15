import { isNull, sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { departmentStatus, housekeepingStatus, roomOperationalStatus } from "./enums";
import { users } from "./identity";
import { properties, tenants, timestamps } from "./tenancy";

/**
 * Hotel structure (Phase 2). Every table carries tenant_id + property_id, and composite
 * foreign keys guarantee children point at parents in the SAME property and tenant, so
 * a bug in application code cannot attach Tenant A's room to Tenant B's floor.
 */

const scoped = {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "restrict" }),
  propertyId: uuid("property_id").notNull(),
};

/** null = live; set = archived (kept for history, hidden from normal lists). */
const archivedAt = timestamp("archived_at", { withTimezone: true });

export const floors = pgTable(
  "floors",
  {
    ...scoped,
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt,
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "floors_property_same_tenant_fk",
      columns: [t.propertyId, t.tenantId],
      foreignColumns: [properties.id, properties.tenantId],
    }).onDelete("restrict"),
    unique("floors_id_scope_unique").on(t.id, t.propertyId, t.tenantId),
    uniqueIndex("floors_property_name_live_unique")
      .on(t.propertyId, sql`lower(${t.name})`)
      .where(isNull(t.archivedAt)),
    index("floors_scope_idx").on(t.tenantId, t.propertyId, t.sortOrder),
  ],
);

export const roomCategories = pgTable(
  "room_categories",
  {
    ...scoped,
    name: text("name").notNull(),
    description: text("description"),
    capacity: integer("capacity").notNull().default(2),
    archivedAt,
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "room_categories_property_same_tenant_fk",
      columns: [t.propertyId, t.tenantId],
      foreignColumns: [properties.id, properties.tenantId],
    }).onDelete("restrict"),
    unique("room_categories_id_scope_unique").on(t.id, t.propertyId, t.tenantId),
    uniqueIndex("room_categories_property_name_live_unique")
      .on(t.propertyId, sql`lower(${t.name})`)
      .where(isNull(t.archivedAt)),
  ],
);

export const rooms = pgTable(
  "rooms",
  {
    ...scoped,
    floorId: uuid("floor_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    roomCode: text("room_code").notNull(),
    /** null = use the category's capacity. */
    capacity: integer("capacity"),
    operationalStatus: roomOperationalStatus("operational_status").notNull().default("active"),
    housekeepingStatus: housekeepingStatus("housekeeping_status").notNull().default("clean"),
    notes: text("notes"),
    archivedAt,
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "rooms_floor_same_property_fk",
      columns: [t.floorId, t.propertyId, t.tenantId],
      foreignColumns: [floors.id, floors.propertyId, floors.tenantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "rooms_category_same_property_fk",
      columns: [t.categoryId, t.propertyId, t.tenantId],
      foreignColumns: [roomCategories.id, roomCategories.propertyId, roomCategories.tenantId],
    }).onDelete("restrict"),
    unique("rooms_id_scope_unique").on(t.id, t.propertyId, t.tenantId),
    // FR-02: room code unique within a property (case-insensitive) among live rooms.
    uniqueIndex("rooms_property_code_live_unique")
      .on(t.propertyId, sql`lower(${t.roomCode})`)
      .where(isNull(t.archivedAt)),
    index("rooms_scope_status_idx").on(t.tenantId, t.propertyId, t.operationalStatus),
    index("rooms_scope_hk_idx").on(t.tenantId, t.propertyId, t.housekeepingStatus),
    index("rooms_floor_idx").on(t.floorId),
  ],
);

/** Immutable log of operational/housekeeping status changes. */
export const roomStatusHistory = pgTable(
  "room_status_history",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    propertyId: uuid("property_id").notNull(),
    roomId: uuid("room_id").notNull(),
    dimension: text("dimension").notNull(), // operational | housekeeping
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    note: text("note"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "room_status_history_room_scope_fk",
      columns: [t.roomId, t.propertyId, t.tenantId],
      foreignColumns: [rooms.id, rooms.propertyId, rooms.tenantId],
    }).onDelete("restrict"),
    index("room_status_history_room_idx").on(t.tenantId, t.roomId, t.changedAt),
  ],
);

/** Request-routing targets (housekeeping, reception, …). Used by Phase 4 routing. */
export const departments = pgTable(
  "departments",
  {
    ...scoped,
    key: text("key").notNull(),
    name: text("name").notNull(),
    status: departmentStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "departments_property_same_tenant_fk",
      columns: [t.propertyId, t.tenantId],
      foreignColumns: [properties.id, properties.tenantId],
    }).onDelete("restrict"),
    unique("departments_id_scope_unique").on(t.id, t.propertyId, t.tenantId),
    unique("departments_property_key_unique").on(t.propertyId, t.key),
    uniqueIndex("departments_property_name_unique").on(t.propertyId, sql`lower(${t.name})`),
  ],
);
