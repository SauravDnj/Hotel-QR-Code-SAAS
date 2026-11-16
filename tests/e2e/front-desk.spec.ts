import { expect, test } from "@playwright/test";
import { resetLoopbackRateLimits, setupHotel, unique } from "./helpers";

test.beforeEach(resetLoopbackRateLimits);
test.describe.configure({ timeout: 300_000 });

test("check-in → checkout → cleaning → inspection → ready again; checkout never makes a room ready", async ({ page }) => {
  await setupHotel(page, `Desk Hotel ${unique()}`);

  // Check in to room 101 (a brand-new, clean room is ready).
  await page.goto("/front-desk");
  const form = page.getByRole("form", { name: "Check in" });
  await form.getByLabel("Room").selectOption({ label: "101 · Floor 1" });
  await form.getByLabel("Guest name").fill("Asha Rao");
  await form.getByLabel("Phone (optional)").fill("+91 90000 00000");
  await form.getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText("Checked in to room.")).toBeVisible();
  const inHouse = page.getByRole("table", { name: "In-house guests" });
  await expect(inHouse).toContainText("Asha Rao");
  await expect(form.getByLabel("Room")).toContainText("No room is ready");

  await page.goto("/housekeeping?show=all");
  await expect(page.getByRole("list", { name: "Rooms" }).getByRole("listitem").filter({ hasText: "Room 101" })).toContainText("Occupied");
  expect(await page.content()).not.toContain("Asha Rao"); // the board shows no guest identity

  // Checkout: room needs cleaning and is NOT offered for check-in.
  await page.goto("/front-desk");
  await page.getByRole("button", { name: "Check out" }).click();
  await page.getByRole("button", { name: "Confirm checkout" }).click();
  await expect(page.getByText("No guests checked in")).toBeVisible();
  await expect(page.getByRole("form", { name: "Check in" }).getByLabel("Room")).toContainText("No room is ready");

  await page.goto("/housekeeping");
  const card = page.getByRole("list", { name: "Rooms" }).getByRole("listitem").filter({ hasText: "Room 101" });
  await expect(card).toContainText("Needs cleaning");
  await expect(card).toContainText("After checkout");
  await card.getByRole("button", { name: "Start cleaning" }).click();
  await expect(card).toContainText("Cleaning", { timeout: 30_000 });
  await card.getByLabel("Cleaning note").fill("Changed linen");
  await card.getByRole("button", { name: "Done" }).click();
  await expect(card).toContainText("Awaiting inspection", { timeout: 30_000 });

  // Still not allocatable until inspected.
  await page.goto("/front-desk");
  await expect(page.getByRole("form", { name: "Check in" }).getByLabel("Room")).toContainText("No room is ready");

  await page.goto("/housekeeping");
  await card.getByRole("button", { name: "Pass" }).click();
  await expect(page.getByText("Nothing to clean or inspect")).toBeVisible({ timeout: 30_000 });

  await page.goto("/front-desk");
  await expect(page.getByRole("form", { name: "Check in" }).getByLabel("Room")).toContainText("101");
});
