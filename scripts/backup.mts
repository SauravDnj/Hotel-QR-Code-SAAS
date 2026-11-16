/**
 * Logical backup (OPERATIONS_RUNBOOK.md "Backup and restore").
 *
 *   pnpm backup                → backups/<timestamp>/ (gitignored)
 *
 * Exports every table in the public schema as gzipped JSON plus a manifest (row counts,
 * latest migration). This complements, and does not replace, Neon's point-in-time restore.
 * The files contain guest personal data and encrypted secrets: keep them encrypted at rest,
 * access-controlled, and delete per the retention policy.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";

config({ path: ".env.local" });
config();

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DIRECT_URL or DATABASE_URL.");
const pool = new Pool({ connectionString: url });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = join("backups", stamp);
mkdirSync(dir, { recursive: true });

try {
  const { rows: tables } = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
  );
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
  const manifest: { createdAt: string; migration: string; tables: Record<string, number> } = {
    createdAt: new Date().toISOString(),
    migration: journal.entries.at(-1)!.tag,
    tables: {},
  };
  for (const { table_name } of tables) {
    // json_agg keeps exact Postgres types (timestamptz, jsonb, enums) for a faithful restore.
    const { rows } = await pool.query<{ data: unknown[] }>(`select coalesce(json_agg(t), '[]'::json) as data from "${table_name}" t`);
    const data = rows[0].data;
    writeFileSync(join(dir, `${table_name}.json.gz`), gzipSync(JSON.stringify(data)));
    manifest.tables[table_name] = data.length;
    console.log(`${table_name.padEnd(28)} ${String(data.length).padStart(7)} rows`);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nBackup written to ${dir} (migration ${manifest.migration}).`);
} finally {
  await pool.end();
}
