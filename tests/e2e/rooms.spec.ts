import { expect, test, type Page } from "@playwright/test";
import { resetLoopbackRateLimits } from "./helpers";

test.beforeEach(resetLoopbackRateLimits);

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function signup(page: Page, hotelName: string) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Work email").fill(`rooms-${unique()}@example.test`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByLabel("Hotel display name").fill(hotelName);
  await page.getByLabel("Legal / business name").fill(`${hotelName} Pvt Ltd`);
  await page.getByRole("button", { name: "Create hotel account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function openProperty(page: Page, hotelName: string) {
  await page.goto("/properties");
  await page.getByRole("link", { name: hotelName }).click();
  await page.waitForURL(/\/properties\/[0-9a-f-]{36}$/);
  return page.url();
}

test("owner configures floors, room types and a room range, then manages a room", async ({ page }) => {
  const hotel = `Rooms Hotel ${unique()}`;
  await signup(page, hotel);
  const propertyUrl = await openProperty(page, hotel);

  // The property tabs are shown, and the Rooms tab tells the owner what is missing.
  const tabs = page.getByRole("navigation", { name: "Property sections" });
  await expect(tabs.getByRole("link", { name: "Rooms" })).toBeVisible();
  await page.goto(`${propertyUrl}/rooms`);
  await expect(page.getByText("Set up floors and room types first")).toBeVisible();

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
  await page.getByLabel("To", { exact: true }).fill("110");
  await page.getByRole("button", { name: "Create rooms" }).click();
  await expect(page.getByText("10 rooms created.")).toBeVisible();

  // Overlapping range is rejected as a whole.
  await page.getByLabel("From", { exact: true }).fill("110");
  await page.getByLabel("To", { exact: true }).fill("112");
  await page.getByRole("button", { name: "Create rooms" }).click();
  await expect(page.getByText(/already exist: 110/)).toBeVisible();

  await page.goto(`${propertyUrl}/rooms`);
  await expect(page.getByRole("list", { name: "Rooms" }).getByRole("listitem")).toHaveCount(10);
  await page.getByLabel("Search room number").fill("105");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("list", { name: "Rooms" }).getByRole("listitem")).toHaveCount(1);

  await page.getByRole("link", { name: /^105/ }).click();
  await expect(page.getByRole("heading", { name: "Room 105" })).toBeVisible();
  const op = page.getByRole("form", { name: "Operational status" });
  await op.getByLabel("Operational status").selectOption("out_of_order");
  await op.getByLabel("Reason").fill("Leaking tap");
  await op.getByRole("button", { name: "Update" }).click();
  await expect(page.getByText("Status updated.")).toBeVisible();
  await expect(page.getByText(/In service → Out of order · Leaking tap/)).toBeVisible();

  // Filter by status finds it; housekeeping status is untouched.
  await page.goto(`${propertyUrl}/rooms?operational=out_of_order&view=list`);
  await expect(page.getByRole("row")).toHaveCount(2); // header + 105
  await expect(page.getByRole("row").nth(1)).toContainText("Clean");
});

test("another tenant cannot open this hotel's rooms by URL", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const hotel = `Private Rooms ${unique()}`;
  await signup(a, hotel);
  const propertyUrl = await openProperty(a, hotel);

  const b = await (await browser.newContext()).newPage();
  await signup(b, `Intruder ${unique()}`);
  for (const path of ["/rooms", "/floors", "/room-types", "/departments", "/rooms/new"]) {
    const res = await b.goto(`${propertyUrl}${path}`);
    expect(res?.status(), path).toBe(404);
    expect(await b.content(), path).not.toContain(hotel);
  }
});
