/**
 * Eventana Ops service worker — makes the dashboard installable as an app and
 * keeps it opening instantly, WITHOUT ever serving stale live data:
 *   • API calls (different origin) are never touched — always live from the network.
 *   • Page navigations are network-first, falling back to the cached shell only
 *     when the device is offline, so a cold/again-open is fast and offline-tolerant.
 *   • Hashed static assets (js/css/fonts/icons) are cache-first (safe: the file
 *     name changes on every build).
 */
const CACHE = 'eventana-ops-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Only handle same-origin requests. The API lives on another origin, so this
  // leaves every API call completely untouched (always live).
  if (url.origin !== self.location.origin) return;

  // Page loads: network-first, cached shell as the offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('/', net.clone());
        return net;
      } catch {
        const cached = await caches.match('/');
        return cached || Response.error();
      }
    })());
    return;
  }

  // Hashed build assets: cache-first.
  if (/\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const net = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, net.clone());
      return net;
    })());
  }
});
