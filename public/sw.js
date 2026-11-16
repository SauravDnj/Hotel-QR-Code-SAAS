/*
 * Staff PWA service worker. Deliberately minimal and privacy-safe:
 * - it NEVER caches pages or API responses (they contain hotel and guest data and must
 *   always come fresh from the server, which re-checks permissions);
 * - it only caches a static offline page, shown when a navigation fails without network.
 */
const CACHE = "hotel-staff-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" }))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate") return; // let the browser handle everything else normally
  event.respondWith(
    fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || new Response("Offline", { status: 503 })),
  );
});
