// Service worker: cache-first con precache delle risorse statiche (tutti i percorsi sono relativi allo scope).
const CACHE = 'minisheet-v1';   // cambiare versione a ogni modifica dei file per invalidare la cache
const LOCAL = ['./', './index.html', './manifest.json', './css/style.css', './js/app.js', './js/engine.js',
  './js/coordinates.js', './icons/icon-192.png', './icons/icon-512.png'];
const BOOTSTRAP = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(LOCAL);                                         // obbligatorio
    await c.add(new Request(BOOTSTRAP, { mode: 'cors' })).catch(() => {});   // Bootstrap da CDN: best effort
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit ||
    fetch(e.request).then(res => {                                 // risorse non previste: cache a runtime
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
