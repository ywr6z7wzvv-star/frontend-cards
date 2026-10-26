/* Service worker: makes the app work offline.
   Strategy: network first (so edits pushed to GitHub show up right away),
   falling back to the cache when offline or when the network is slow. */
const CACHE = 'fe-cards-v4';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'data/questions.json',
  'data/experience.md',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon-32.png',
];
const NETWORK_TIMEOUT = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(networkFirst(e, req, url));
});

async function networkFirst(e, req, url) {
  const cache = await caches.open(CACHE);
  // Cache key without the query string and hash: `./?source=pwa` and `./` are the same page.
  const key = url.origin + url.pathname;
  const network = fetch(key, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  e.waitUntil(network.catch(() => {}));

  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch (err) { /* offline: fall through to the cache */ }

  const cached = await cache.match(key);
  if (cached) return cached;
  if (req.mode === 'navigate') {
    const shell = await cache.match(new URL('./', self.location).href);
    if (shell) return shell;
  }
  return network; // nothing cached: wait for the network after all
}
