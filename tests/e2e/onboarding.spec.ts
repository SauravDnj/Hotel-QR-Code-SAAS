import { expect, test, type Page } from "@playwright/test";
import { resetLoopbackRateLimits } from "./helpers";

test.beforeEach(resetLoopbackRateLimits);

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function signup(page: Page, hotelName: string, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByLabel("Hotel display name").fill(hotelName);
  await page.getByLabel("Legal / business name").fill(`${hotelName} Pvt Ltd`);
  await page.getByRole("button", { name: "Create hotel account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("owner signs up, adds a property, signs out and back in", async ({ page }) => {
  const id = unique();
  const email = `e2e-${id}@example.test`;
  await signup(page, `E2E Hotel ${id}`, email);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.goto("/properties/new");
  await page.getByLabel("Property name").fill(`Annex ${id}`);
  await page.getByLabel("City").fill("Goa");
  await page.getByRole("button", { name: "Create property" }).click();
  await expect(page.getByText("Property created.")).toBeVisible();

  await page.goto("/properties");
  await expect(page.getByRole("link", { name: `Annex ${id}` })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("wrong password shows a generic error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`nobody-${unique()}@example.test`);
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
});

test("a tenant cannot open another tenant's property by URL", async ({ browser }) => {
  const a = await browser.newPage();
  const idA = unique();
  await signup(a, `Tenant A ${idA}`, `a-${idA}@example.test`);
  await a.goto("/properties");
  await a.getByRole("link", { name: `Tenant A ${idA}` }).click();
  await a.waitForURL(/\/properties\/[0-9a-f-]{36}$/);
  const propertyUrl = a.url();
  // Sanity check: the owner can see their own property.
  await expect(a.getByRole("heading", { name: `Tenant A ${idA}` })).toBeVisible();

  const b = await (await browser.newContext()).newPage();
  const idB = unique();
  await signup(b, `Tenant B ${idB}`, `b-${idB}@example.test`);
  const res = await b.goto(propertyUrl);
  // Most important: none of Tenant A's data is rendered for Tenant B.
  const html = await b.content();
  console.log(`[cross-tenant] status=${res?.status()} leaked=${html.includes(`Tenant A ${idA}`)} h1="${await b.locator("h1").first().textContent()}"`);
  expect(html).not.toContain(`Tenant A ${idA}`);
  await expect(b.getByRole("heading", { name: "404" })).toBeVisible();
  expect(res?.status()).toBe(404);
});

test("non-operators get 404 on the platform console", async ({ page }) => {
  const id = unique();
  await signup(page, `NoOps ${id}`, `noops-${id}@example.test`);
  const res = await page.goto("/platform");
  expect(res?.status()).toBe(404);
});
