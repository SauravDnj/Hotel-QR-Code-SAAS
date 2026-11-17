import { isNotNull, isNull, sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { serviceItems, serviceRequests } from "./requests";
import { stays } from "./stays";
import { tenants, timestamps } from "./tenancy";

/**
 * Ordering and guest bills (Phase 9).
 * - menu_items: priced items of a "menu" service (in-room dining, laundry). Prices in minor
 *   units of the property's currency; the server always recomputes totals from this table.
 * - request_items: the order lines, snapshotted (name + unit price) at order time.
 * - folio_charges / folio_payments: the stay's bill. A room-charged order posts exactly one
 *   charge when it is completed (unique request_id). Charges are voided, never deleted.
 */
export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").notNull(),
    serviceItemId: uuid("service_item_id").notNull(),
    section: text("section"),
    name: text("name").notNull(),
    description: text("description"),
    priceMinor: integer("price_minor").notNull(),
    available: boolean("available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "menu_items_service_scope_fk",
      columns: [t.serviceItemId, t.propertyId, t.tenantId],
      foreignColumns: [serviceItems.id, serviceItems.propertyId, serviceItems.tenantId],
    }).onDelete("restrict"),
    check("menu_items_price_check", sql`${t.priceMinor} >= 0`),
    unique("menu_items_id_tenant_unique").on(t.id, t.tenantId),
    uniqueIndex("menu_items_service_name_live_unique")
      .on(t.serviceItemId, sql`lower(${t.name})`)
      .where(isNull(t.archivedAt)),
    index("menu_items_service_idx").on(t.tenantId, t.serviceItemId, t.sortOrder),
  ],
);

export const requestItems = pgTable(
  "request_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "restrict" }),
    menuItemId: uuid("menu_item_id").notNull(),
    name: text("name").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalMinor: integer("line_total_minor").notNull(),
  },
  (t) => [
    foreignKey({
      name: "request_items_menu_item_same_tenant_fk",
      columns: [t.menuItemId, t.tenantId],
      foreignColumns: [menuItems.id, menuItems.tenantId],
    }).onDelete("restrict"),
    check("request_items_quantity_check", sql`${t.quantity} between 1 and 50`),
    index("request_items_request_idx").on(t.tenantId, t.requestId),
  ],
);

export const folioCharges = pgTable(
  "folio_charges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").notNull(),
    stayId: uuid("stay_id").notNull(),
    description: text("description").notNull(),
    /** Positive = charge, negative = discount/adjustment. */
    amountMinor: integer("amount_minor").notNull(),
    /** order | manual | api */
    source: text("source").notNull(),
    requestId: uuid("request_id").references(() => serviceRequests.id),
    /** Reference from a POS/PMS posting; unique per tenant for idempotent integrations. */
    externalRef: text("external_ref"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: uuid("voided_by_user_id").references(() => users.id),
    voidReason: text("void_reason"),
  },
  (t) => [
    foreignKey({
      name: "folio_charges_stay_same_tenant_fk",
      columns: [t.stayId, t.tenantId],
      foreignColumns: [stays.id, stays.tenantId],
    }).onDelete("restrict"),
    check("folio_charges_amount_check", sql`${t.amountMinor} <> 0`),
    uniqueIndex("folio_charges_request_unique").on(t.requestId).where(isNotNull(t.requestId)),
    uniqueIndex("folio_charges_external_ref_unique").on(t.tenantId, t.externalRef).where(isNotNull(t.externalRef)),
    index("folio_charges_stay_idx").on(t.tenantId, t.stayId, t.createdAt),
    index("folio_charges_property_idx").on(t.tenantId, t.propertyId, t.createdAt),
  ],
);

export const folioPayments = pgTable(
  "folio_payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").notNull(),
    stayId: uuid("stay_id").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    /** cash | card | upi | bank | other */
    method: text("method").notNull(),
    reference: text("reference"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "folio_payments_stay_same_tenant_fk",
      columns: [t.stayId, t.tenantId],
      foreignColumns: [stays.id, stays.tenantId],
    }).onDelete("restrict"),
    check("folio_payments_amount_check", sql`${t.amountMinor} > 0`),
    index("folio_payments_stay_idx").on(t.tenantId, t.stayId, t.createdAt),
  ],
);
