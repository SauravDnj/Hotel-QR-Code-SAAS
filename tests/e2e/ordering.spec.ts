import { devices, expect, test } from "@playwright/test";
import { resetLoopbackRateLimits, setupHotel, unique } from "./helpers";

test.beforeEach(resetLoopbackRateLimits);
test.describe.configure({ timeout: 300_000 });

test("in-room dining: guest orders to the room bill → staff deliver → charge on the bill → settled at the desk", async ({ page, browser }) => {
  const guestPath = await setupHotel(page, `Dining Hotel ${unique()}`);
  const propertyUrl = page.url().replace(/\/rooms\/[0-9a-f-]{36}$/, "");

  // Enable the dining module (added hidden, with a sample menu).
  await page.goto(`${propertyUrl}/services`);
  await page.getByRole("button", { name: "Add dining, laundry & spa" }).click();
  await expect(page.getByText(/5 services added/)).toBeVisible({ timeout: 30_000 });
  await page.getByText("In-room dining", { exact: true }).click();
  const edit = page.getByRole("form", { name: "Edit In-room dining" });
  await edit.getByRole("checkbox", { name: "Shown to guests" }).check();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 30_000 });

  // A guest is checked in to 101, so room charge is offered.
  await page.goto("/front-desk");
  const form = page.getByRole("form", { name: "Check in" });
  await form.getByLabel("Room").selectOption({ label: "101 · Floor 1" });
  await form.getByLabel("Guest name").fill("Diner Guest");
  await form.getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText("Checked in to room.")).toBeVisible();

  const guest = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  await guest.goto(guestPath);
  await guest.getByRole("link", { name: "In-room dining" }).click();
  await guest.getByRole("button", { name: "More Masala chai" }).click();
  await guest.getByRole("button", { name: "More Masala chai" }).click();
  await guest.getByLabel("Add to my room bill").check();
  await guest.getByRole("button", { name: /Place order · ₹180\.00/ }).click();
  await guest.waitForURL(/\/s\/[A-Za-z0-9_-]{43}$/);
  await expect(guest.getByText("2 × Masala chai")).toBeVisible();
  await expect(guest.getByText("Added to your room bill when delivered.")).toBeVisible();

  // Staff deliver it.
  await page.goto("/inbox");
  const item = page.getByRole("list", { name: "Requests" }).getByRole("listitem").filter({ hasText: "In-room dining" });
  await expect(item).toContainText("₹180.00 to room", { timeout: 30_000 });
  await item.getByRole("link").first().click();
  await page.waitForURL(/\/inbox\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("list", { name: "Order lines" })).toContainText("2 × Masala chai");
  await page.getByRole("form", { name: "Accept" }).getByRole("button", { name: "Accept" }).click();
  await page.getByRole("form", { name: "Start" }).getByRole("button", { name: "Start" }).click();
  await page.getByRole("form", { name: "Complete" }).getByRole("button", { name: "Complete" }).click();
  await expect(page.getByRole("heading", { level: 1 }).locator("..").getByText("Completed", { exact: true })).toBeVisible({ timeout: 30_000 });

  // The bill shows the charge; checkout is guarded until it is paid.
  await page.goto("/front-desk");
  const due = page.getByRole("link", { name: "₹180.00 due" });
  await expect(due).toBeVisible();
  await due.click();
  await page.waitForURL(/\/front-desk\/folio\//);
  await expect(page.getByRole("table", { name: "Charges" })).toContainText("In-room dining");
  const pay = page.getByRole("form", { name: "Record payment" });
  await pay.getByLabel("Method").selectOption("upi");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByTestId("balance")).toContainText("Settled", { timeout: 30_000 });

  await page.goto("/front-desk");
  await page.getByRole("button", { name: "Check out" }).click();
  await page.getByRole("button", { name: "Confirm checkout" }).click();
  await expect(page.getByText("No guests checked in")).toBeVisible({ timeout: 30_000 });
});
