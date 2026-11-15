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

export type TenantStatus = (typeof tenantStatus.enumValues)[number];
export type PropertyStatus = (typeof propertyStatus.enumValues)[number];
