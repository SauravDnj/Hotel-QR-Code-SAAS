import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * Driver-agnostic database handle. Production uses Neon (neon-serverless),
 * tests use PGlite; both satisfy this type. Transactions also satisfy it, so
 * service functions can be called inside or outside a transaction.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
