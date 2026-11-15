import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config();

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  // Migrations use the direct (non-pooled) connection, as Neon recommends.
  dbCredentials: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
