// Network-first app shell cache so the app opens offline (e.g. on a run with no signal).
const CACHE = 'runner-v40';
const SHELL = [
  './', 'index.html', 'styles.css', 'icon.svg', 'manifest.webmanifest', 'fonts/anton-latin.woff2',
  'js/app.js', 'js/db.js', 'js/stats.js', 'js/recorder.js', 'js/ble.js', 'js/game.js', 'js/earn-view.js', 'js/onboarding.js', 'js/auth.js', 'js/config.js', 'js/wallet.js', 'js/collection.js', 'js/sneaker-art.js', 'js/geo.js', 'js/nft.js', 'js/rewards.js', 'js/rewards-view.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com';
  if (!cacheable) return; // map tiles etc. go straight to network
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
