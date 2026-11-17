import { expect, test } from "@playwright/test";
import { resetLoopbackRateLimits, setupHotel, unique } from "./helpers";

test.beforeEach(resetLoopbackRateLimits);
test.describe.configure({ timeout: 300_000 });

test("book → calendar → arrival → check in from booking; sold-out nights are refused", async ({ page }) => {
  await setupHotel(page, `Booking Hotel ${unique()}`);

  await page.goto("/reservations");
  const form = page.getByRole("form", { name: "Create booking" });
  await form.getByLabel("Guest name").fill("Ravi Menon");
  await form.getByLabel("Phone (optional)").fill("+91 91111 11111");
  await form.getByRole("button", { name: "Create booking" }).click();
  const confirmation = page.getByText(/Booked\. Confirmation code R[A-Z2-9]{6}\./);
  await expect(confirmation).toBeVisible({ timeout: 30_000 });
  const code = (await confirmation.textContent())!.match(/R[A-Z2-9]{6}/)![0];

  // The only Deluxe room is now taken tonight: a second booking is refused with a clear reason.
  await form.getByLabel("Guest name").fill("Second Guest");
  await form.getByRole("button", { name: "Create booking" }).click();
  await expect(page.getByText(/No Deluxe rooms left on/)).toBeVisible({ timeout: 30_000 });

  await page.reload();
  const cal = page.getByRole("table", { name: "Availability calendar" });
  await expect(cal).toContainText("Full");

  await page.goto("/front-desk");
  const arrivals = page.getByRole("table", { name: "Arrivals" });
  await expect(arrivals).toContainText(code);
  await expect(arrivals).toContainText("Ravi Menon");
  await arrivals.getByRole("link", { name: "Check in" }).click();
  await page.waitForURL(/\/reservations\/[0-9a-f-]{36}/);
  const checkin = page.getByRole("form", { name: "Check in booking" });
  await checkin.getByLabel("Room").selectOption({ label: "101 · Floor 1" });
  await checkin.getByRole("button", { name: "Check in" }).click();
  await page.waitForURL(/\/front-desk/, { timeout: 60_000 });
  await expect(page.getByRole("table", { name: "In-house guests" })).toContainText("Ravi Menon");
  await expect(page.getByText("No bookings due today.")).toBeVisible();

  await page.goto("/reservations?view=in_house");
  await expect(page.getByRole("table", { name: "Bookings" })).toContainText(code);
  await expect(page.getByRole("table", { name: "Bookings" })).toContainText("Checked in");
});
