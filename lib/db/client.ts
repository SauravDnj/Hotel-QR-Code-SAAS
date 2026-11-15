import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { serverEnv } from "@/lib/env";
import * as schema from "./schema";
import type { Db } from "./types";

let cached: Db | undefined;

/**
 * Lazily creates one pooled connection per server instance using the pooled
 * Neon URL (DATABASE_URL). Migrations use DIRECT_URL via drizzle-kit instead.
 */
export function getDb(): Db {
  if (!cached) {
    const pool = new Pool({ connectionString: serverEnv().DATABASE_URL });
    cached = drizzle({ client: pool, schema }) as unknown as Db;
  }
  return cached;
}
