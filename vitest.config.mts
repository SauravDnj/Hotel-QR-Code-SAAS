import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // "server-only" throws outside React Server Components; stub it for tests.
    alias: { "server-only": fileURLToPath(new URL("./tests/helpers/server-only-stub.ts", import.meta.url)) },
  },
});
