import { expect, test } from "@playwright/test";
import { resetLoopbackRateLimits, setupHotel, unique } from "./helpers";

test.beforeEach(resetLoopbackRateLimits);
test.describe.configure({ timeout: 300_000 });

test("owner sees trial plan, usage, reports and live dashboard numbers", async ({ page }) => {
  await setupHotel(page, `Billing Hotel ${unique()}`);

  await page.goto("/billing");
  await expect(page.getByText("Free trial")).toBeVisible();
  await expect(page.getByRole("meter", { name: "Rooms" })).toHaveAttribute("aria-valuenow", "1");
  const plans = page.getByRole("list", { name: "Plans" });
  const cards = plans.locator(":scope > li");
  await expect(cards).toHaveCount(3);
  await expect(cards.filter({ hasText: "Current" })).toContainText("Professional");

  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Occupancy" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Occupancy by night" }).getByRole("row")).toHaveCount(8); // header + 7 days
  await page.getByText("How these numbers are calculated").click();
  await expect(page.getByText(/Occupancy rate = occupied room-nights/)).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Right now" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ready to sell/ })).toContainText("1");
});

test("payment webhook refuses unsigned or forged calls", async ({ request }) => {
  const res = await request.post("/api/webhooks/razorpay", {
    data: { event: "subscription.charged", payload: {} },
    headers: { "x-razorpay-signature": "0".repeat(64) },
  });
  // 400 when a webhook secret is configured, 503 when payments are not set up; never accepted.
  expect([400, 503]).toContain(res.status());
});
