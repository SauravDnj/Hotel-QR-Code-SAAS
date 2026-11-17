// Captures the screenshots and videos used by the in-app guide (public/guide/).
// Usage: start the app on :3457 (pnpm build && npx next start -p 3457), then
//   DEMO_PW=<demo staff password> node scripts/capture-guide-media.mjs [shots guest-shots tour design guest staff]
// Uses the demo hotel manager. Room QR codes and links are masked; the "guest" and "staff" videos
// send and complete one real "Guide demo" request in the demo hotel.
import { chromium } from "@playwright/test";
import { mkdirSync, renameSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://localhost:3457";
const OUT = join(process.cwd(), "public", "guide");
const TMP = join(process.cwd(), ".guide-video-tmp");
mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const PW = process.env.DEMO_PW;
const only = process.argv.slice(2);
const want = (k) => only.length === 0 || only.includes(k);

const browser = await chromium.launch();
const pause = (p, ms = 900) => p.waitForTimeout(ms);

async function login(page, email = "manager@grandstay.example.com") {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 60000 });
}

async function shot(page, name, opts = {}) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await pause(page, 400);
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 78, ...opts });
  console.log("shot", name);
}

/** Runs `fn` in a fresh context that records a video, saved as public/guide/<name>.webm. */
async function video(name, viewport, fn, loginFirst = true) {
  // Reuse the one signed-in session (sign-in is rate limited), so recordings start signed in.
  const ctx = await browser.newContext({ viewport, recordVideo: { dir: TMP, size: viewport }, ...(loginFirst ? { storageState: session } : {}) });
  const page = await ctx.newPage();
  await fn(page);
  await pause(page, 1200);
  await ctx.close();
  const file = readdirSync(TMP).find((f) => f.endsWith(".webm"));
  renameSync(join(TMP, file), join(OUT, `${name}.webm`));
  console.log("video", name);
}

// --- discover the demo property, a room and its guest link -------------------------------------
// The session is kept in a local file between runs: sign-in is limited to 5 tries per 15 minutes.
const SESSION_FILE = join(process.cwd(), ".guide-session.json");
const { existsSync } = await import("node:fs");
const setup = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(existsSync(SESSION_FILE) ? { storageState: SESSION_FILE } : {}) });
const page = await setup.newPage();
await page.goto(`${BASE}/dashboard`);
if (!/\/dashboard/.test(page.url())) await login(page);
await setup.storageState({ path: SESSION_FILE });
await page.goto(`${BASE}/properties`);
const pid = (await page.locator('a[href^="/properties/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href"))))
  .map((h) => h.split("/")[2])
  .find((x) => /^[0-9a-f-]{36}$/.test(x));
await page.goto(`${BASE}/properties/${pid}/rooms`);
const roomHref = (await page.locator(`a[href^="/properties/${pid}/rooms/"]`).evaluateAll((as) => as.map((a) => a.getAttribute("href")))).find(
  (h) => !h.endsWith("/new"),
);
await page.goto(`${BASE}${roomHref}`);
const guestUrl = await page.locator('a[href*="/r/"]').first().getAttribute("href");
const guestPath = new URL(guestUrl, BASE).pathname;
const P = `/properties/${pid}`;
const session = await setup.storageState();

// --- desktop screenshots ------------------------------------------------------------------------
if (want("shots")) {
  const pages = [
    ["dashboard", "/dashboard"],
    ["properties", "/properties"],
    ["rooms", `${P}/rooms`],
    ["room-qr", roomHref],
    ["qr-codes", `${P}/qr-codes`],
    ["services", `${P}/services`],
    ["guest-portal", `${P}/guest-portal`],
    ["design", `${P}/design`],
    ["staff", "/staff"],
    ["reservations", "/reservations"],
    ["front-desk", "/front-desk"],
    ["requests", "/inbox"],
    ["housekeeping", "/housekeeping"],
    ["reports", "/reports"],
    ["billing", "/billing"],
    ["profile", "/profile"],
  ];
  for (const [name, path] of pages) {
    await page.goto(`${BASE}${path}`);
    // Never publish a working room QR: hide the guest link text and blur the code itself.
    await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (/\/r\/[A-Za-z0-9_-]{10,}/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/\S*\/r\/[A-Za-z0-9_-]+/g, "https://your-hotel-domain/r/••••••••");
      }
      for (const el of document.querySelectorAll('img[src*="qr"], img[alt*="QR" i], svg[aria-label*="QR" i], canvas, main svg')) {
        const r = el.getBoundingClientRect();
        if (r.width >= 100 && r.height >= 100) el.style.filter = "blur(7px)";
      }
    });
    await shot(page, name);
  }
}
await setup.close();

// --- guest screenshots (phone) ------------------------------------------------------------------
if (want("guest-shots")) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const g = await ctx.newPage();
  await g.goto(`${BASE}${guestPath}`);
  await shot(g, "guest-home", { quality: 70 });
  await g.getByRole("link", { name: /drinking water/i }).first().click();
  await g.waitForURL(/request/);
  await shot(g, "guest-request", { quality: 70 });
  await ctx.close();
}

// --- videos -------------------------------------------------------------------------------------
if (want("tour")) {
  await video("video-tour", { width: 1280, height: 720 }, async (v) => {
    await v.goto(`${BASE}/dashboard`);
    await pause(v, 1800);
    for (const label of ["Requests", "Front desk", "Reservations", "Housekeeping", "Rooms", "Properties", "Reports", "Staff", "Help & guide"]) {
      await v.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label, exact: false }).first().click();
      await v.waitForLoadState("networkidle").catch(() => {});
      await pause(v, 1700);
    }
  });
}

if (want("design")) {
  await video("video-design", { width: 1280, height: 720 }, async (v) => {
    await v.goto(`${BASE}${P}/design`);
    await pause(v, 1500);
    for (const t of ["Photo", "Elegant", "Minimal", "Classic"]) {
      await v.getByRole("radiogroup", { name: "Template" }).getByRole("radio", { name: new RegExp(`^${t}`) }).click();
      await pause(v, 1300);
    }
    for (const p of ["Emerald", "Royal maroon", "Night & gold", "Ocean"]) {
      await v.getByRole("button", { name: p }).click();
      await pause(v, 1300);
    }
    await v.getByRole("region", { name: "Guest page preview" }).hover();
    await v.mouse.wheel(0, 500);
    await pause(v, 1500);
    // Not saved: the demo hotel keeps its current design.
  });
}

if (want("guest")) {
  await video(
    "video-guest-request",
    { width: 390, height: 780 },
    async (v) => {
      await v.goto(`${BASE}${guestPath}`);
      await pause(v, 2000);
      await v.mouse.wheel(0, 400);
      await pause(v, 1500);
      await v.mouse.wheel(0, -400);
      await pause(v, 800);
      await v.getByRole("link", { name: /drinking water/i }).first().click();
      await v.waitForURL(/request/);
      await pause(v, 1500);
      const note = v.locator("textarea").first();
      if (await note.count()) await note.pressSequentially("Guide demo - please ignore", { delay: 40 });
      await pause(v, 800);
      await v.getByRole("button", { name: /send/i }).click();
      await v.waitForURL(/\/s\//, { timeout: 30000 });
      await pause(v, 3000);
    },
    false,
  );
}

if (want("staff")) {
  await video("video-staff-request", { width: 1280, height: 720 }, async (v) => {
    await v.goto(`${BASE}/inbox`);
    await pause(v, 2000);
    await v.locator('a[href^="/inbox/"]').first().click();
    await v.waitForURL(/\/inbox\/[0-9a-f-]{36}/);
    await pause(v, 1800);
    // Wait for the status badge after each click so the video shows every state, ending on Completed.
    for (const [step, status] of [["Accept", "Accepted"], ["Start", "In progress"], ["Complete", "Completed"]]) {
      await v.getByRole("button", { name: step, exact: true }).click();
      await v.waitForFunction((s) => document.querySelector("main")?.innerText.includes(s), status, { timeout: 20000 }).catch(() => {});
      await pause(v, 1800);
    }
    await pause(v, 1500);
  });
}

await browser.close();
rmSync(TMP, { recursive: true, force: true });
