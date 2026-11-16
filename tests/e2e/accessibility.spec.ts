import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import { resetLoopbackRateLimits, setupHotel, unique } from "./helpers";

test.beforeEach(resetLoopbackRateLimits);
test.describe.configure({ timeout: 600_000 });

/**
 * WCAG 2.1 A/AA automated checks (axe-core) on every main guest and staff screen.
 * Fails on serious/critical violations; lists moderate ones in the report output.
 */
async function scan(page: Page, name: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = result.violations.map((v) => `${name}: [${v.impact}] ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`);
  if (summary.length) console.log(summary.join("\n"));
  expect(blocking.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`), name).toEqual([]);
}

test("guest and staff screens have no serious accessibility violations", async ({ page, browser }) => {
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    await scan(page, path);
  }
  const guestPath = await setupHotel(page, `A11y Hotel ${unique()}`);

  // Guest screens on a phone.
  const guest = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  await guest.goto(guestPath);
  await scan(guest, "guest portal");
  await guest.getByRole("link", { name: "Drinking water" }).click();
  await guest.waitForURL(/\/request\//);
  await scan(guest, "request form");
  await guest.getByRole("button", { name: "Send request" }).click();
  await guest.waitForURL(/\/s\//);
  await scan(guest, "request status");
  await guest.goto("/r/" + "A".repeat(43));
  await scan(guest, "QR unavailable");
  await guest.context().close();

  // Staff screens.
  const propertyUrl = (await page.url()).replace(/\/rooms\/.*$/, "");
  for (const path of [
    "/dashboard",
    "/inbox",
    "/front-desk",
    "/housekeeping",
    "/reports",
    "/staff",
    "/staff/roles",
    "/billing",
    "/profile",
    "/settings",
    "/account/security",
    `${new URL(propertyUrl).pathname}`,
    `${new URL(propertyUrl).pathname}/qr-codes`,
    `${new URL(propertyUrl).pathname}/guest-portal`,
    `${new URL(propertyUrl).pathname}/services`,
    `${new URL(propertyUrl).pathname}/rooms`,
  ]) {
    await page.goto(path);
    await scan(page, path);
  }
});
