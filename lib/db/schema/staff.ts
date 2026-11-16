import { sql } from "drizzle-orm";
import { foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { roles, users } from "./identity";
import { departments } from "./structure";
import { properties, tenants } from "./tenancy";

/**
 * Staff invitations (Phase 5). The invite link carries a random token; only its HMAC is
 * stored. Single use, expires, revocable. The role/scope is fixed when the invite is made,
 * by someone allowed to grant it.
 */
export const staffInvitations = pgTable(
  "staff_invitations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id"),
    departmentId: uuid("department_id"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "staff_invitations_property_fk",
      columns: [t.propertyId, t.tenantId],
      foreignColumns: [properties.id, properties.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "staff_invitations_department_fk",
      columns: [t.departmentId, t.propertyId, t.tenantId],
      foreignColumns: [departments.id, departments.propertyId, departments.tenantId],
    }).onDelete("cascade"),
    uniqueIndex("staff_invitations_token_unique").on(t.tokenHash),
    // One open invitation per email per hotel.
    uniqueIndex("staff_invitations_open_email_unique")
      .on(t.tenantId, sql`lower(${t.email})`)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    index("staff_invitations_tenant_idx").on(t.tenantId, t.createdAt),
  ],
);
