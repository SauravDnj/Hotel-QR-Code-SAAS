/**
 * Restore rehearsal: proves a logical backup can actually be restored.
 *
 *   pnpm restore:check backups/<timestamp>
 *
 * Restores into a THROWAWAY in-process Postgres (PGlite): applies this repo's migrations,
 * loads every table, then checks row counts against the manifest and runs integrity queries.
 * Never touches the source database. (A Neon point-in-time restore drill is separate; see
 * docs/RUNBOOK.md.)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: pnpm restore:check backups/<timestamp>");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { migration: string; tables: Record<string, number> };
const started = Date.now();

const client = new PGlite();
await migrate(drizzle({ client }), { migrationsFolder: "./drizzle" });
// Load tables in any order: FK checks are deferred to the integrity queries below.
await client.exec("set session_replication_role = replica");

const failures: string[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json.gz"))) {
  const table = file.replace(/\.json\.gz$/, "");
  const rows = JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString("utf8")) as unknown[];
  for (let i = 0; i < rows.length; i += 500) {
    await client.query(`insert into "${table}" select * from json_populate_recordset(null::"${table}", $1::json)`, [JSON.stringify(rows.slice(i, i + 500))]);
  }
  const { rows: c } = await client.query<{ n: number }>(`select count(*)::int as n from "${table}"`);
  const ok = c[0].n === manifest.tables[table];
  if (!ok) failures.push(`${table}: restored ${c[0].n}, expected ${manifest.tables[table]}`);
  console.log(`${ok ? "OK  " : "FAIL"} ${table.padEnd(28)} ${String(c[0].n).padStart(7)}`);
}
await client.exec("set session_replication_role = origin");

// Referential integrity spot checks across the tenant boundary.
const checks: [string, string][] = [
  ["rooms → properties (same tenant)", `select count(*)::int n from rooms r left join properties p on p.id = r.property_id and p.tenant_id = r.tenant_id where p.id is null`],
  ["memberships → users", `select count(*)::int n from tenant_memberships m left join users u on u.id = m.user_id where u.id is null`],
  ["requests → rooms (same tenant)", `select count(*)::int n from service_requests s left join rooms r on r.id = s.room_id and r.tenant_id = s.tenant_id where r.id is null`],
  ["stays → guests (same tenant)", `select count(*)::int n from stays s left join guests g on g.id = s.guest_id and g.tenant_id = s.tenant_id where g.id is null`],
  ["subscriptions → plans", `select count(*)::int n from subscriptions s left join plans p on p.id = s.plan_id where p.id is null`],
  ["one active stay per room", `select count(*)::int n from (select room_id from stays where status = 'checked_in' group by room_id having count(*) > 1) x`],
];
for (const [name, q] of checks) {
  const { rows } = await client.query<{ n: number }>(q);
  if (rows[0].n !== 0) failures.push(`${name}: ${rows[0].n} broken rows`);
  console.log(`${rows[0].n === 0 ? "OK  " : "FAIL"} integrity: ${name}`);
}
await client.close();
console.log(`\nRestore rehearsal of ${dir} (migration ${manifest.migration}) took ${((Date.now() - started) / 1000).toFixed(1)} s.`);
if (failures.length) {
  console.error(`FAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASSED: every table restored with matching row counts and integrity checks clean.");
