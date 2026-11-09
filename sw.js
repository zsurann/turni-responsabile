/* Service worker: prima la rete, offline usa la copia salvata.
   IMPORTANTE: a ogni rilascio aumenta il numero in CACHE, così le app installate si aggiornano. */
const CACHE = 'resp-v13';
const ASSETS = [
 './', 'index.html', 'style.css', 'manager.css', 'manager.js', 'config.js',
 'manifest.webmanifest', 'logo.png', 'favicon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'fonts/inter-latin.woff2',
];

self.addEventListener('install', (e) => {
 e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
 e.waitUntil(
 caches.keys()
 .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
 .then(() => self.clients.claim())
 );
});

self.addEventListener('fetch', (e) => {
 const req = e.request;
 if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
 e.respondWith(
 fetch(req)
 .then((res) => {
 if (res.ok) {
 const c = res.clone();
 caches.open(CACHE).then((x) => x.put(req, c));
 }
 return res;
 })
 .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => {
 if (r) return r;
 // la pagina di riserva solo per le navigazioni, non per immagini/script mancanti
 if (req.mode === 'navigate') return caches.match('index.html');
 return Response.error();
 }))
 );
});
