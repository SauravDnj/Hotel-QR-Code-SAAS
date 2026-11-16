import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    // Each integration file boots its own in-process Postgres (~300 MB); run files one at a time so
    // machines with little free memory do not crash workers.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Throwaway test-only keys (never used outside tests).
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      AUTH_SECRET: "test-auth-secret-test-auth-secret-000000",
      APP_URL: "http://localhost:3000",
      QR_TOKEN_PEPPER: "test-pepper-test-pepper-test-pepper-0000",
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      GUEST_PORTAL_URL: "https://guest.test",
    },
    // "server-only" throws outside React Server Components; stub it for tests.
    alias: { "server-only": fileURLToPath(new URL("./tests/helpers/server-only-stub.ts", import.meta.url)) },
  },
});
