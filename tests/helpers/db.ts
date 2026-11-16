import { PGlite } from "@electric-sql/pglite";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import type { TenantContext } from "@/lib/permissions/authorize";
import { seedRbac } from "@/modules/rbac/seed";
import { createTenantWithOwner, type SignupInput } from "@/modules/tenants/onboarding";
import { loadTenantContext } from "@/modules/tenants/context";

/**
 * Fresh in-process PostgreSQL (PGlite) with the real migrations applied, so integration
 * tests exercise the same SQL and constraints as production without a network database.
 */
export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle({ client, schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await seedRbac(db);
  return db;
}

let counter = 0;
export function signupInput(overrides: Partial<SignupInput> = {}): SignupInput {
  counter++;
  return {
    ownerName: `Owner ${counter}`,
    email: `owner${counter}-${Date.now()}@example.test`,
    password: "correct horse battery",
    hotelName: `Hotel ${counter}`,
    legalName: `Hotel ${counter} Pvt Ltd`,
    country: "IN",
    timezone: "Asia/Kolkata",
    currency: "INR",
    ...overrides,
  };
}

/** Creates a tenant + owner and returns the owner's server-built context. */
export async function createTenantFixture(db: Db, overrides: Partial<SignupInput> = {}) {
  const created = await createTenantWithOwner(db, signupInput(overrides));
  const ctx = await loadTenantContext(db, created.userId, created.tenantId);
  if (!ctx) throw new Error("fixture context missing");
  return { ...created, ctx };
}

export type TenantFixture = Awaited<ReturnType<typeof createTenantFixture>>;

/** Adds a staff member with a system role, optionally scoped to one property. */
export async function addStaff(db: Db, t: TenantFixture, roleKey: string, propertyId: string | null): Promise<TenantContext> {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `${roleKey}-${crypto.randomUUID()}@example.test`, name: roleKey, passwordHash: "x" })
    .returning();
  const [m] = await db.insert(schema.tenantMemberships).values({ tenantId: t.tenantId, userId: user.id }).returning();
  const [role] = await db.select().from(schema.roles).where(and(isNull(schema.roles.tenantId), eq(schema.roles.key, roleKey)));
  await db.insert(schema.userRoleAssignments).values({ tenantId: t.tenantId, membershipId: m.id, roleId: role.id, propertyId });
  return (await loadTenantContext(db, user.id, t.tenantId))!;
}
