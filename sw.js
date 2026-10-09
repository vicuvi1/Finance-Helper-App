// Offline support. Network first so you always get the newest version when
// online; the cache is the fallback when there is no connection.

const CACHE = 'finance-helper-v4';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/model.js',
  './js/money.js',
  './js/dates.js',
  './js/store.js',
  './js/csv.js',
  './js/importer.js',
  './js/charts.js',
  './js/logviews.js',
  './js/xlsx.js',
  './js/fx.js',
  './js/rates.js',
  './js/ctx.js',
  './js/screens/accounts.js',
  './js/screens/rates.js',
  './js/screens/spending.js',
  './js/screens/people.js',
  './js/screens/reports.js',
  './js/screens/security.js',
  './js/lock.js',
  './js/version.js',
  './js/screens/updates.js',
  './js/screens/binance.js',
  './js/binance.js',
  './fonts/Geist-Variable.woff2',
  './fonts/GeistMono-Variable.woff2',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
