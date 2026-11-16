import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against a real app + database. Point .env.local at a NON-production
 * Neon branch before running `pnpm test:e2e`; tests create their own uniquely named
 * tenants and never delete data.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 180_000,
  // Local dev talks to a remote Neon region, so allow for network latency.
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
