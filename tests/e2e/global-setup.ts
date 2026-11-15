import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";

/**
 * E2E runs sign up several hotels from localhost, which the (intentional) signup and
 * login rate limits would block. Reset ONLY the loopback-address counters, so the
 * limits themselves stay untouched and are still exercised in integration tests.
 */
export default async function globalSetup() {
  config({ path: ".env.local", quiet: true });
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("E2E needs DATABASE_URL/DIRECT_URL in .env.local");
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(
      `delete from rate_limits
        where key in ('signup:ip:::1','signup:ip:127.0.0.1','signup:ip:::ffff:127.0.0.1',
                      'login:ip:::1','login:ip:127.0.0.1','login:ip:::ffff:127.0.0.1')`,
    );
  } finally {
    await pool.end();
  }
}
