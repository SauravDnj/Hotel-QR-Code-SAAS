import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { errorFields, logger } from "@/lib/observability/logger";

/** Liveness + database connectivity. Reveals no configuration details. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    logger.error("health_check_failed", errorFields(err));
    return Response.json({ status: "degraded" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
