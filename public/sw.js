/*
 * Staff PWA service worker. Deliberately minimal and privacy-safe:
 * - it NEVER caches pages or API responses (they contain hotel and guest data and must
 *   always come fresh from the server, which re-checks permissions);
 * - it only caches a static offline page, shown when a navigation fails without network.
 */
const CACHE = "hotel-staff-v2";
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

/*
 * Phase 9: staff push notifications. The payload carries only a title, a short body
 * (room + service, never guest details) and a same-origin inbox URL.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "New guest request";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/inbox";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/inbox";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
