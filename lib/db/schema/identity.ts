import { isNull, sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { membershipStatus, userStatus } from "./enums";
import { departments } from "./structure";
import { properties, tenants, timestamps } from "./tenancy";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // Always stored lower-cased (see lib/auth/normalize.ts).
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: userStatus("status").notNull().default("active"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  // Bump to invalidate every existing session for this user.
  sessionVersion: integer("session_version").notNull().default(1),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: membershipStatus("status").notNull().default("active"),
    /** Staff notification preferences (Phase 5): play a sound for new requests. */
    notifySound: boolean("notify_sound").notNull().default(true),
    /** "all" = alert for every new request in scope; "mine" = only requests assigned to me. */
    notifyScope: text("notify_scope").notNull().default("all"),
    ...timestamps,
  },
  (t) => [
    unique("tenant_memberships_tenant_user_unique").on(t.tenantId, t.userId),
    unique("tenant_memberships_id_tenant_unique").on(t.id, t.tenantId),
    index("tenant_memberships_user_idx").on(t.userId),
  ],
);

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  description: text("description").notNull(),
});

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // null = system role shared by all tenants.
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique("roles_tenant_key_unique").on(t.tenantId, t.key),
    uniqueIndex("roles_system_key_unique").on(t.key).where(isNull(t.tenantId)),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoleAssignments = pgTable(
  "user_role_assignments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    // null = all properties of the tenant.
    propertyId: uuid("property_id"),
    /** null = every department the role covers; set = only this department (requires a property). */
    departmentId: uuid("department_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    // Same-tenant guarantees enforced by the database, not only by app code.
    foreignKey({
      name: "ura_membership_same_tenant_fk",
      columns: [t.membershipId, t.tenantId],
      foreignColumns: [tenantMemberships.id, tenantMemberships.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ura_property_same_tenant_fk",
      columns: [t.propertyId, t.tenantId],
      foreignColumns: [properties.id, properties.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ura_department_same_property_fk",
      columns: [t.departmentId, t.propertyId, t.tenantId],
      foreignColumns: [departments.id, departments.propertyId, departments.tenantId],
    }).onDelete("cascade"),
    check("ura_department_needs_property", sql`${t.departmentId} is null or ${t.propertyId} is not null`),
    index("ura_membership_idx").on(t.membershipId),
  ],
);
