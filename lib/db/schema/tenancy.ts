import { sql } from "drizzle-orm";
import {
  char,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { propertyStatus, tenantStatus } from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  slug: text("slug").notNull().unique(),
  status: tenantStatus("status").notNull().default("trialing"),
  timezone: text("timezone").notNull(),
  country: char("country", { length: 2 }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  locale: text("locale").notNull().default("en"),
  contactEmail: text("contact_email").notNull(),
  ...timestamps,
});

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    country: char("country", { length: 2 }).notNull(),
    timezone: text("timezone").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: propertyStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    // Composite key lets child tables enforce "same tenant" with a foreign key.
    unique("properties_id_tenant_unique").on(t.id, t.tenantId),
    unique("properties_tenant_name_unique").on(t.tenantId, t.name),
    index("properties_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export { timestamps };
