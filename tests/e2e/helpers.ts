import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { expect, type Page } from "@playwright/test";

export const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/**
 * E2E tests sign up several hotels from localhost, which the (intentional) signup and
 * login rate limits would block. Reset ONLY the loopback-address counters before each
 * test; the limits themselves stay untouched and are covered by integration tests.
 * Skipped when targeting a deployed site (requests there do not come from loopback).
 */
export async function resetLoopbackRateLimits() {
  if (process.env.E2E_BASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL)) return;
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

/** Signs up a hotel, adds room 101 and the standard services; returns the room's guest path. */
export async function setupHotel(page: Page, hotel: string) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Work email").fill(`req-${unique()}@example.test`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByLabel("Hotel display name").fill(hotel);
  await page.getByLabel("Legal / business name").fill(`${hotel} Pvt Ltd`);
  await page.getByRole("button", { name: "Create hotel account" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
  await page.goto("/properties");
  await page.getByRole("link", { name: hotel }).click();
  await page.waitForURL(/\/properties\/[0-9a-f-]{36}$/);
  const propertyUrl = page.url();

  await page.goto(`${propertyUrl}/floors`);
  const f = page.getByRole("form", { name: "Add floor" });
  await f.getByLabel("Name").fill("Floor 1");
  await f.getByRole("button", { name: "Add floor" }).click();
  await expect(page.getByText("Floor added.")).toBeVisible();
  await page.goto(`${propertyUrl}/room-types`);
  const t = page.getByRole("form", { name: "Add room type" });
  await t.getByLabel("Name").fill("Deluxe");
  await t.getByRole("button", { name: "Add room type" }).click();
  await expect(page.getByText("Room type added.")).toBeVisible();
  await page.goto(`${propertyUrl}/rooms/new`);
  await page.getByLabel("From", { exact: true }).fill("101");
  await page.getByLabel("To", { exact: true }).fill("101");
  await page.getByRole("button", { name: "Create rooms" }).click();
  await expect(page.getByText("1 rooms created.").or(page.getByText("1 room created."))).toBeVisible();

  await page.goto(`${propertyUrl}/services`);
  await page.getByRole("button", { name: "Add standard services" }).click();
  await expect(page.getByText("5 services added.")).toBeVisible();

  await page.goto(`${propertyUrl}/qr-codes`);
  await page.getByRole("link", { name: "101", exact: true }).click();
  await page.waitForURL(/\/rooms\/[0-9a-f-]{36}$/);
  const guestUrl = (await page.getByTitle("Guest link").textContent())!.trim();
  return new URL(guestUrl).pathname;
}
