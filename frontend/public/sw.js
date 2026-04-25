const CACHE_NAME = "nf-scout-shell-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Navigation requests: network-first with cache fallback.
// Static requests: cache-first.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const isNavigation = req.mode === "navigate";
  const url = new URL(req.url);

  // Never cache API calls.
  if (url.pathname.startsWith("/api/")) return;

  if (isNavigation) {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (req.method === "GET" && res.status === 200 && req.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
/* global self */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((c) => c.postMessage({ type: "SYNC_OUTBOX" }));
}

self.addEventListener("sync", (event) => {
  if (event.tag === "outbox-sync") {
    event.waitUntil(notifyClientsToSync());
  }
});

self.addEventListener("online", () => {
  notifyClientsToSync();
});
