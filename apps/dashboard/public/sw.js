/**
 * Eventana Ops service worker — makes the dashboard installable as an app and
 * keeps it opening instantly, WITHOUT ever serving stale live data:
 *   • API calls (different origin) are never touched — always live from the network.
 *   • Page navigations are network-first, falling back to the cached shell only
 *     when the device is offline, so a cold/again-open is fast and offline-tolerant.
 *   • Hashed static assets (js/css/fonts/icons) are cache-first (safe: the file
 *     name changes on every build).
 */
const CACHE = 'eventana-ops-v3';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ── Web Push: show the notification on the phone (with the system sound) ──────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Eventana Ops';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
    vibrate: [80, 40, 80],
  }));
});

// Tapping the notification focuses the app (or opens it) at the given URL.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { try { await c.focus(); if ('navigate' in c && url && url !== '/') await c.navigate(url); } catch { /* noop */ } return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Only handle same-origin requests. The API lives on another origin, so this
  // leaves every API call completely untouched (always live).
  if (url.origin !== self.location.origin) return;

  // Page loads: network-first, cached shell as the offline fallback. On a weak
  // or dead connection (Wi-Fi with no internet) a page load can hang for a long
  // time before failing, so after 4s open the cached shell instead — the fresh
  // page still lands in the cache for next time.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const network = fetch(req).then(async (net) => {
        if (net.ok) { const cache = await caches.open(CACHE); await cache.put('/', net.clone()); }
        return net;
      });
      const cached = await caches.match('/');
      if (!cached) {
        try { return await network; } catch { return Response.error(); }
      }
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
      try {
        const first = await Promise.race([network, timeout]);
        if (first) return first;
        event.waitUntil(network.catch(() => {}));
        return cached;
      } catch {
        return cached;
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
