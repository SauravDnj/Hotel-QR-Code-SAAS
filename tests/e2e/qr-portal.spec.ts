import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { resetLoopbackRateLimits } from "./helpers";

test.beforeEach(resetLoopbackRateLimits);
// Long multi-page flows; a cold dev server against a remote DB needs more than the default.
test.describe.configure({ timeout: 240_000 });

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function signup(page: Page, hotelName: string) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Work email").fill(`qr-${unique()}@example.test`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByLabel("Hotel display name").fill(hotelName);
  await page.getByLabel("Legal / business name").fill(`${hotelName} Pvt Ltd`);
  await page.getByRole("button", { name: "Create hotel account" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 }); // Argon2 + remote DB on a busy machine
  await page.goto("/properties");
  await page.getByRole("link", { name: hotelName }).click();
  await page.waitForURL(/\/properties\/[0-9a-f-]{36}$/);
  return page.url();
}

async function createRoom101(page: Page, propertyUrl: string) {
  await page.goto(`${propertyUrl}/floors`);
  const addFloor = page.getByRole("form", { name: "Add floor" });
  await addFloor.getByLabel("Name").fill("Floor 1");
  await addFloor.getByRole("button", { name: "Add floor" }).click();
  await expect(page.getByText("Floor added.")).toBeVisible();
  await page.goto(`${propertyUrl}/room-types`);
  const addType = page.getByRole("form", { name: "Add room type" });
  await addType.getByLabel("Name").fill("Deluxe");
  await addType.getByRole("button", { name: "Add room type" }).click();
  await expect(page.getByText("Room type added.")).toBeVisible();
  await page.goto(`${propertyUrl}/rooms/new`);
  await page.getByLabel("From", { exact: true }).fill("101");
  await page.getByLabel("To", { exact: true }).fill("102");
  await page.getByRole("button", { name: "Create rooms" }).click();
  await expect(page.getByText("2 rooms created.")).toBeVisible();
}

async function guestPhone(browser: Browser) {
  // A fresh context = no staff session, like a guest's own phone.
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  return ctx.newPage();
}

test("owner sets up the portal; a guest scans the room QR on a phone; replacing the code kills the old one", async ({
  page,
  browser,
}) => {
  const hotel = `QR Hotel ${unique()}`;
  const propertyUrl = await signup(page, hotel);
  await createRoom101(page, propertyUrl);

  // Guest portal settings, including an encrypted Wi-Fi password.
  await page.goto(`${propertyUrl}/guest-portal`);
  await page.getByLabel("Network name (SSID)").fill("QR-Hotel-Guest");
  await page.getByLabel("Wi-Fi password").fill("sunrise-2026");
  await page.getByLabel("Reception phone").fill("+91 98765 43210");
  await page.getByLabel("Check-out by").fill("11:00");
  await page.getByLabel("Section 1 title").fill("Breakfast");
  await page.getByLabel("Section 1 text").fill("Served 7–10am on the ground floor.");
  await page.getByRole("button", { name: "Save guest portal" }).click();
  await expect(page.getByText("Guest portal saved.")).toBeVisible();
  // The saved password is never sent back to the browser.
  await page.reload();
  expect(await page.content()).not.toContain("sunrise-2026");
  await expect(page.getByText("A password is saved. Leave blank to keep it.")).toBeVisible();

  // QR codes were created with the rooms.
  await page.goto(`${propertyUrl}/qr-codes`);
  await expect(page.getByRole("row")).toHaveCount(3);
  await page.getByRole("link", { name: "101", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Room 101" })).toBeVisible();
  await expect(page.getByRole("img", { name: "QR code for room 101" })).toBeVisible();
  const guestUrl = (await page.getByTitle("Guest link").textContent())!.trim();
  expect(guestUrl).toMatch(/\/r\/[A-Za-z0-9_-]{43}$/);
  const guestPath = new URL(guestUrl).pathname; // same server under test, whatever APP_URL says

  // Downloads work for staff.
  const png = await page.request.get(`/api${new URL(page.url()).pathname}/qr?format=png`);
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");

  // Guest on a phone: hotel info and Wi-Fi, no login.
  const guest = await guestPhone(browser);
  const res = await guest.goto(guestPath);
  expect(res?.status()).toBe(200);
  expect(res?.headers()["cache-control"]).toContain("no-store");
  await expect(guest.getByRole("heading", { name: hotel })).toBeVisible();
  await expect(guest.getByText("Room 101")).toBeVisible();
  await expect(guest.getByText("QR-Hotel-Guest")).toBeVisible();
  await expect(guest.getByText("sunrise-2026")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Copy Wi-Fi password" })).toBeVisible();
  await expect(guest.getByRole("link", { name: "Call reception" })).toHaveAttribute("href", "tel:+919876543210");
  await guest.getByText("Breakfast").click();
  await expect(guest.getByText("Served 7–10am on the ground floor.")).toBeVisible();
  // No horizontal scrolling on a phone.
  expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Owner replaces the code: the old sticker stops working at once.
  await page.getByRole("button", { name: "Replace code" }).click();
  await page.getByRole("button", { name: "Yes, replace code" }).click();
  await expect(page.getByText(/New QR code issued/)).toBeVisible();
  const newUrl = (await page.getByTitle("Guest link").textContent())!.trim();
  expect(newUrl).not.toBe(guestUrl);

  const old = await guest.goto(guestPath);
  expect(old?.status()).toBe(404);
  await expect(guest.getByRole("heading", { name: "This QR code isn't active" })).toBeVisible();
  expect(await guest.content()).not.toContain(hotel);
  const fresh = await guest.goto(new URL(newUrl).pathname);
  expect(fresh?.status()).toBe(200);
  await expect(guest.getByRole("heading", { name: hotel })).toBeVisible();

  // Printable sheet lists both rooms.
  await page.goto(`${propertyUrl}/qr-codes`);
  const print = page.getByRole("link", { name: "Print sheet" });
  const sheetPath = await print.getAttribute("href");
  await page.goto(sheetPath!);
  await expect(page.getByRole("list", { name: "QR codes" }).getByRole("listitem")).toHaveCount(2);
  await guest.context().close();
});

test("unknown QR tokens and other tenants get nothing", async ({ browser, page }) => {
  const guest = await guestPhone(browser);
  for (const path of ["/r/" + "A".repeat(43), "/r/not-a-token", "/r/00000000-0000-0000-0000-000000000000"]) {
    const res = await guest.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(guest.getByRole("heading", { name: "This QR code isn't active" })).toBeVisible();
  }

  const hotel = `Private QR ${unique()}`;
  const propertyUrl = await signup(page, hotel);
  await createRoom101(page, propertyUrl);
  await page.goto(`${propertyUrl}/qr-codes`);
  await page.getByRole("link", { name: "101", exact: true }).click();
  await page.waitForURL(/\/rooms\/[0-9a-f-]{36}$/);
  const roomPath = new URL(page.url()).pathname;

  const intruder = await (await browser.newContext()).newPage();
  await signup(intruder, `Intruder ${unique()}`);
  for (const path of [`${roomPath.replace(/\/rooms\/.*/, "")}/qr-codes`, `${roomPath.replace(/\/rooms\/.*/, "")}/guest-portal`, roomPath]) {
    const r = await intruder.goto(path);
    expect(r?.status(), path).toBe(404);
  }
  const dl = await intruder.request.get(`/api${roomPath}/qr?format=svg`);
  expect(dl.status()).toBe(404);
  const sheet = await intruder.goto(`/print${roomPath.replace(/\/rooms\/.*/, "")}/qr`);
  expect(sheet?.status()).toBe(404);
  await Promise.all([guest.context().close(), intruder.context().close()]);
});
