/*
 * Kiosk service worker: keeps the game playable when the venue network drops.
 * - Page shell ("/"): network first (4 s timeout), cached copy when offline.
 * - Hashed build assets (/_next/static): cache first, they never change.
 * - API and admin: never cached (always live data; admin needs the network anyway).
 * The page posts the URLs it loaded so assets fetched before this worker took control
 * are cached too.
 */
const CACHE = "hk-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];
const MAX_ENTRIES = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_ENTRIES) await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((k) => cache.delete(k)));
}

async function put(req, res) {
  if (!res || !res.ok || res.type === "opaque") return;
  const cache = await caches.open(CACHE);
  await cache.put(req, res);
  await trim(cache);
}

function isStatic(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg" || url.pathname.startsWith("/brand/");
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-urls") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const u of event.data.urls) {
        const url = new URL(u, self.location.origin);
        if (url.origin !== self.location.origin || !isStatic(url)) continue;
        if (await cache.match(url.href)) continue;
        try {
          await put(url.href, await fetch(url.href));
        } catch {}
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;

  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            event.waitUntil(put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate" && url.pathname === "/") {
    event.respondWith(
      (async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        try {
          const res = await fetch(req, { signal: ctrl.signal });
          clearTimeout(timer);
          if (!res.ok) {
            // Backend outage (5xx): the cached shell beats an error page on a kiosk.
            const cached = await caches.match("/");
            if (cached) return cached;
          }
          event.waitUntil(put("/", res.clone()));
          return res;
        } catch {
          clearTimeout(timer);
          return (await caches.match("/")) || Response.error();
        }
      })(),
    );
  }
});
