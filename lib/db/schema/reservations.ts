import { isNotNull, sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { reservationStatus } from "./enums";
import { users } from "./identity";
import { guests, stays } from "./stays";
import { roomCategories, rooms } from "./structure";
import { tenants, timestamps } from "./tenancy";

/**
 * Reservations (Phase 9). A booking holds one room of a category for the nights
 * [arrival_date, departure_date) in the property's local calendar. A room may optionally be
 * assigned up front. Availability is enforced in the service under a per-category row lock
 * (modules/reservations/availability.ts): never more bookings + walk-in stays than sellable
 * rooms on any night, and never two overlapping bookings on one assigned room.
 */
export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    roomId: uuid("room_id"),
    guestId: uuid("guest_id").notNull(),
    /** Short human code for phone/desk use, unique per tenant (e.g. R7K3QXM). */
    code: text("code").notNull(),
    arrivalDate: date("arrival_date", { mode: "string" }).notNull(),
    departureDate: date("departure_date", { mode: "string" }).notNull(),
    adults: integer("adults").notNull().default(1),
    status: reservationStatus("status").notNull().default("confirmed"),
    /** direct | phone | email | walk_in | ota | api */
    source: text("source").notNull().default("direct"),
    /** Reference in an external system (OTA/PMS); unique per tenant+source, used for idempotent imports. */
    externalRef: text("external_ref"),
    notes: text("notes"),
    stayId: uuid("stay_id").references(() => stays.id),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "reservations_category_scope_fk",
      columns: [t.categoryId, t.propertyId, t.tenantId],
      foreignColumns: [roomCategories.id, roomCategories.propertyId, roomCategories.tenantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "reservations_room_scope_fk",
      columns: [t.roomId, t.propertyId, t.tenantId],
      foreignColumns: [rooms.id, rooms.propertyId, rooms.tenantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "reservations_guest_same_tenant_fk",
      columns: [t.guestId, t.tenantId],
      foreignColumns: [guests.id, guests.tenantId],
    }).onDelete("restrict"),
    check("reservations_dates_check", sql`${t.departureDate} > ${t.arrivalDate}`),
    check("reservations_adults_check", sql`${t.adults} between 1 and 20`),
    uniqueIndex("reservations_tenant_code_unique").on(t.tenantId, t.code),
    uniqueIndex("reservations_external_ref_unique").on(t.tenantId, t.source, t.externalRef).where(isNotNull(t.externalRef)),
    uniqueIndex("reservations_stay_unique").on(t.stayId).where(isNotNull(t.stayId)),
    index("reservations_arrivals_idx").on(t.tenantId, t.propertyId, t.arrivalDate),
    index("reservations_category_idx").on(t.propertyId, t.categoryId, t.status, t.departureDate),
    index("reservations_room_idx").on(t.roomId, t.status),
  ],
);
