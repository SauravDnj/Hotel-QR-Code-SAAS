import { devices, expect, test, type Page } from "@playwright/test";
import { resetLoopbackRateLimits } from "./helpers";

test.beforeEach(resetLoopbackRateLimits);
test.describe.configure({ timeout: 300_000 });

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function setupHotel(page: Page, hotel: string) {
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

test("guest orders water on a phone; staff see it live, handle it; guest sees progress", async ({ page, browser }) => {
  const hotel = `Req Hotel ${unique()}`;
  const guestPath = await setupHotel(page, hotel);

  // Staff opens the inbox BEFORE the request exists; it must appear without a manual reload.
  await page.goto("/inbox");
  await expect(page.getByText("All caught up")).toBeVisible();

  const guest = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  await guest.goto(guestPath);
  await expect(guest.getByRole("heading", { name: "How can we help?" })).toBeVisible();
  await expect(guest.getByRole("link", { name: "Something else" })).toHaveCount(0); // disabled by default
  await guest.getByRole("link", { name: "Drinking water" }).click();
  await guest.getByRole("button", { name: "More" }).click();
  await guest.getByLabel("Anything else? (optional)").fill("Cold please");
  await guest.getByRole("button", { name: "Send request" }).click();
  await guest.waitForURL(/\/s\/[A-Za-z0-9_-]{43}$/);
  await expect(guest.getByRole("status").filter({ hasText: "Request sent" })).toBeVisible();
  await expect(guest.getByText("We'll bring it to your room shortly.")).toBeVisible();
  const statusPath = new URL(guest.url()).pathname;

  // Live/polling refresh (≤ 10 s) brings it into the open inbox.
  const item = page.getByRole("list", { name: "Requests" }).getByRole("listitem").filter({ hasText: "Room 101" });
  await expect(item).toContainText("Drinking water", { timeout: 30_000 });
  await expect(item).toContainText("× 2");
  await expect(item).toContainText("Cold please");
  await expect(page.getByRole("link", { name: /Requests/ }).first()).toBeVisible();

  await item.getByRole("button", { name: "Accept" }).click();
  await expect(item).toContainText("Accepted");
  await guest.goto(statusPath);
  await expect(guest.getByRole("status").filter({ hasText: "Hotel team notified" })).toBeVisible();

  // Detail page: start, then complete with a guest-visible message and an internal note.
  await item.getByRole("link").first().click();
  await page.waitForURL(/\/inbox\/[0-9a-f-]{36}$/);
  await page.getByRole("form", { name: "Start" }).getByRole("button", { name: "Start" }).click();
  // The form for a finished step disappears; the badge and history show the new state.
  await expect(page.getByRole("heading", { level: 1 }).locator("..").getByText("In progress", { exact: true })).toBeVisible();
  const complete = page.getByRole("form", { name: "Complete" });
  await complete.getByLabel("Complete: internal note").fill("Delivered by night shift");
  await complete.getByLabel("Complete: message to guest").fill("Enjoy! Call us if you need more.");
  await complete.getByRole("button", { name: "Complete" }).click();
  await expect(page.getByRole("heading", { level: 1 }).locator("..").getByText("Completed", { exact: true })).toBeVisible();
  await expect(page.getByText("Delivered by night shift")).toBeVisible(); // internal note in staff history

  // The guest page refreshes itself; it shows the guest message but never the internal note.
  await expect(guest.getByRole("status").filter({ hasText: "Completed" })).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByText("Enjoy! Call us if you need more.")).toBeVisible();
  expect(await guest.content()).not.toContain("Delivered by night shift");
  expect(await guest.content()).not.toContain("E2E Owner");

  // "Your requests on this phone" remembers it (device-local only).
  await guest.goto(guestPath);
  await expect(guest.getByText("Your requests on this phone")).toBeVisible();
  await guest.context().close();
});

test("bad tokens and other tenants get nothing", async ({ page, browser }) => {
  const guest = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  const res = await guest.goto("/s/" + "Q".repeat(43));
  expect(res?.status()).toBe(404);
  await expect(guest.getByRole("heading", { name: "This request link has expired" })).toBeVisible();
  const bad = await guest.goto(`/r/${"Q".repeat(43)}/request/00000000-0000-0000-0000-000000000000`);
  expect(bad?.status()).toBe(404);

  // A request in hotel A is invisible to hotel B.
  const guestPath = await setupHotel(page, `Iso Hotel ${unique()}`);
  await guest.goto(guestPath);
  await guest.getByRole("link", { name: "Reception assistance" }).click();
  await guest.getByRole("button", { name: "Send request" }).click();
  await guest.waitForURL(/\/s\//);
  await page.goto("/inbox");
  const link = page.getByRole("list", { name: "Requests" }).getByRole("link").first();
  const requestPath = await link.getAttribute("href");

  const intruder = await (await browser.newContext()).newPage();
  await intruder.goto("/signup");
  await intruder.getByLabel("Your name").fill("Intruder");
  await intruder.getByLabel("Work email").fill(`intr-${unique()}@example.test`);
  await intruder.getByLabel("Password").fill("correct horse battery");
  await intruder.getByLabel("Hotel display name").fill(`Intruder ${unique()}`);
  await intruder.getByLabel("Legal / business name").fill("Intruder Pvt Ltd");
  await intruder.getByRole("button", { name: "Create hotel account" }).click();
  await expect(intruder).toHaveURL(/\/dashboard/, { timeout: 60_000 });
  const r = await intruder.goto(requestPath!);
  expect(r?.status()).toBe(404);
  await intruder.goto("/inbox");
  await expect(intruder.getByText("All caught up")).toBeVisible();
  await Promise.all([guest.context().close(), intruder.context().close()]);
});

test("a request made while staff are offline appears after they reconnect", async ({ page, browser }) => {
  const guestPath = await setupHotel(page, `Offline Hotel ${unique()}`);
  await page.goto("/inbox");
  await expect(page.getByText("All caught up")).toBeVisible();

  // Staff device drops off the network (realtime and polling both fail).
  await page.context().setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible({ timeout: 30_000 });

  const guest = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  await guest.goto(guestPath);
  await guest.getByRole("link", { name: "Report a problem" }).click();
  await guest.getByLabel("Air conditioning").check();
  await guest.getByRole("button", { name: "Send request" }).click();
  await guest.waitForURL(/\/s\//);
  await expect(guest.getByRole("status").filter({ hasText: "Request sent" })).toBeVisible();

  // Back online: the inbox recovers the missed request from the database.
  await page.context().setOffline(false);
  const item = page.getByRole("list", { name: "Requests" }).getByRole("listitem").filter({ hasText: "Report a problem" });
  await expect(item).toContainText("Air conditioning", { timeout: 30_000 });
  await expect(item).toContainText("high");
  await guest.context().close();
});
