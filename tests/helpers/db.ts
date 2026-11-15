import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
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
