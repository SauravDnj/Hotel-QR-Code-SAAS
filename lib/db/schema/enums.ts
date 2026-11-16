import { pgEnum } from "drizzle-orm/pg-core";

// Values follow hotel-saas-documentation/03-data/DATA_DICTIONARY.md
export const tenantStatus = pgEnum("tenant_status", [
  "trialing",
  "active",
  "past_due",
  "suspended",
  "cancelled",
]);

export const propertyStatus = pgEnum("property_status", ["active", "inactive"]);

export const userStatus = pgEnum("user_status", ["active", "disabled"]);

export const membershipStatus = pgEnum("membership_status", [
  "active",
  "invited",
  "disabled",
]);

// Three independent room dimensions (PRD §5): occupancy is derived from stays (Phase 6),
// operational and housekeeping status are stored here and never conflated.
export const roomOperationalStatus = pgEnum("room_operational_status", [
  "active",
  "out_of_order",
  "maintenance",
  "inactive",
]);

export const housekeepingStatus = pgEnum("housekeeping_status", [
  "clean",
  "dirty",
  "in_progress",
  "inspected",
  "blocked",
]);

export const departmentStatus = pgEnum("department_status", ["active", "inactive"]);

// QR lifecycle (DATA_DICTIONARY.md): only `active` resolves. `expired` is reserved for
// time-limited codes; revoked rows are kept for audit and never reactivated after rotation.
export const qrStatus = pgEnum("qr_status", ["active", "revoked", "expired"]);

// REQUEST_STATE_MACHINE.md
export const requestStatus = pgEnum("request_status", [
  "new",
  "acknowledged",
  "in_progress",
  "completed",
  "cancelled",
  "reopened",
]);

export const requestPriority = pgEnum("request_priority", ["low", "normal", "high", "urgent"]);

export const serviceNoteMode = pgEnum("service_note_mode", ["none", "optional", "required"]);

export type TenantStatus = (typeof tenantStatus.enumValues)[number];
export type RoomOperationalStatus = (typeof roomOperationalStatus.enumValues)[number];
export type HousekeepingStatus = (typeof housekeepingStatus.enumValues)[number];
export type PropertyStatus = (typeof propertyStatus.enumValues)[number];
export type QrStatus = (typeof qrStatus.enumValues)[number];
export type RequestStatus = (typeof requestStatus.enumValues)[number];
export type RequestPriority = (typeof requestPriority.enumValues)[number];
