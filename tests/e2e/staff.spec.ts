import { devices, expect, test } from "@playwright/test";
import { resetLoopbackRateLimits, setupHotel, unique } from "./helpers";

test.beforeEach(resetLoopbackRateLimits);
test.describe.configure({ timeout: 300_000 });

test("owner invites housekeeping staff; they see only housekeeping requests; deactivation removes access", async ({ page, browser }) => {
  const hotel = `Staff Hotel ${unique()}`;
  const guestPath = await setupHotel(page, hotel);

  // Invite a housekeeper through the Staff page.
  await page.goto("/staff");
  const form = page.getByRole("form", { name: "Invite staff" });
  const email = `hema-${unique()}@example.test`;
  await form.getByLabel("Name").fill("Hema Housekeeper");
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Role").selectOption({ label: "Housekeeping" });
  await form.getByRole("button", { name: "Create invitation link" }).click();
  const link = (await page.getByTitle("Invitation link").textContent())!.trim();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole("list", { name: "Open invitations" })).toContainText(email);

  // The housekeeper joins from their phone.
  const staffCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const hema = await staffCtx.newPage();
  await hema.goto(new URL(link).pathname);
  await expect(hema.getByRole("heading", { name: hotel })).toBeVisible();
  await expect(hema.getByText("Housekeeping", { exact: true })).toBeVisible();
  await hema.getByLabel("Choose a password").fill("housekeeping pass 1");
  await hema.getByRole("button", { name: "Join the team" }).click();
  await hema.waitForURL(/\/inbox/, { timeout: 60_000 });
  await expect(hema.getByText("All caught up")).toBeVisible();
  // The invite link is single use.
  const reuse = await (await browser.newContext()).newPage();
  await reuse.goto(new URL(link).pathname);
  await expect(reuse.getByRole("heading", { name: "This invitation isn't valid" })).toBeVisible();
  await reuse.context().close();

  // A guest asks for water (Room Service) and towels (Housekeeping).
  const guest = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  for (const [tile, pick] of [["Drinking water", null], ["Housekeeping", "Extra towels"]] as const) {
    await guest.goto(guestPath);
    await guest.getByRole("link", { name: tile }).click();
    if (pick) await guest.getByLabel(pick).check();
    await guest.getByRole("button", { name: "Send request" }).click();
    await guest.waitForURL(/\/s\//);
  }

  // Housekeeper sees towels only; owner sees both.
  const list = hema.getByRole("list", { name: "Requests" });
  await expect(list).toContainText("Extra towels", { timeout: 30_000 });
  await expect(list).not.toContainText("Drinking water");
  await page.goto("/inbox");
  await expect(page.getByRole("list", { name: "Requests" })).toContainText("Drinking water");
  await expect(page.getByRole("list", { name: "Requests" })).toContainText("Extra towels");

  // Housekeeping has no staff management.
  await expect(hema.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Staff" })).toHaveCount(0);
  await hema.goto("/staff");
  await expect(hema.getByText("You don't have access to this page")).toBeVisible();

  // Owner deactivates her: the very next request loses access.
  await page.goto("/staff");
  await page.getByRole("link", { name: "Hema Housekeeper" }).click();
  await page.getByRole("button", { name: "Deactivate" }).click();
  await page.getByRole("button", { name: "Yes, remove access" }).click();
  await expect(page.getByText("Deactivated", { exact: true }).first()).toBeVisible();
  await hema.goto("/inbox");
  await expect(hema).toHaveURL(/\/no-access/);

  await Promise.all([staffCtx.close(), guest.context().close()]);
});

test("staff app is installable: manifest, icons and offline page", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ start_url: "/inbox", display: "standalone", name: "Hotel Staff" });
  for (const icon of manifest.icons as { src: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  }
  expect((await request.get("/sw.js")).status()).toBe(200);
  expect(await (await request.get("/offline.html")).text()).toContain("You're offline");
});
