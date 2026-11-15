/**
 * CLI database connection for scripts (seed, admin bootstrap). Uses DIRECT_URL when
 * set, otherwise DATABASE_URL. Loads .env.local for local runs.
 */
import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../lib/db/schema";
import type { Db } from "../lib/db/types";

config({ path: ".env.local" });
config();

export function scriptDb(): { db: Db; close: () => Promise<void> } {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set DIRECT_URL or DATABASE_URL (for example in .env.local).");
  const pool = new Pool({ connectionString: url });
  return { db: drizzle({ client: pool, schema }) as unknown as Db, close: () => pool.end() };
}
