/* Service worker for the hiking app: app shell + map tiles cache-first, so the page and maps work offline. */
const VERSION = "hike-v1";
const SHELL = VERSION + "-shell";
const TILES = "hike-tiles"; // shared across versions: downloaded maps survive app updates
const SHELL_URLS = [
  "./hike.html",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"
];
const TILE_HOSTS = /tile\.opentopomap\.org|tile\.openstreetmap\.org|tiles\.openseamap\.org/;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.endsWith("-shell") && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (TILE_HOSTS.test(url.host)) {
    // map tiles: cache first, then network (and keep what we fetch)
    e.respondWith(caches.open(TILES).then(async cache => {
      const hit = await cache.match(req.url);
      if (hit) return hit;
      try { const res = await fetch(req); if (res && (res.ok || res.type === "opaque")) cache.put(req.url, res.clone()); return res; }
      catch { return new Response("", { status: 504, statusText: "offline" }); }
    }));
    return;
  }
  const isShell = SHELL_URLS.some(u => url.href === new URL(u, self.location.href).href) || (url.origin === self.location.origin && /hike\.html$/.test(url.pathname)) || req.mode === "navigate";
  if (isShell) {
    // app shell: cached copy first (ignoring ?v= cache-busters), refresh in the background
    e.respondWith(caches.open(SHELL).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => { if (res && res.ok) cache.put(req.url.split("?")[0], res.clone()); return res; }).catch(() => null);
      return hit || (await net) || new Response("Offline and not cached yet — open the app once while online.", { status: 503, headers: { "Content-Type": "text/plain" } });
    }));
  }
});
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });
