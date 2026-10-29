// Caches the whole app so it works offline. The version changes whenever
// any file changes, which makes the app offer an update.
const CACHE = 'bc-e164e440a283';
const FONTS = 'fonts-v1';
const ASSETS = ["./", "index.html", "manifest.webmanifest", "js/app.js", "data.js", "content.js", "legends.js", "js/shared.js", "js/review.js", "js/learn.js", "js/legends.js", "engine/chess-0.10.3.js", "engine/stockfish-17.1-lite-single-03e3232.js", "engine/stockfish-17.1-lite-single-03e3232.wasm", "engine/stockfish-10-asm.js", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('bc-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') { e.respondWith(caches.match('./index.html').then(r => r || fetch(req))); return; }
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
