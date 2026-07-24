/* Service worker: cache-first local, network-first CDN. */

const VERSION = 'vm-v37';
const STATIC_ASSETS = [
    './',
    './index.html',
    './reset.html',
    './manifest.json',
    './css/styles.css',
    './js/calc.js',
    './js/data.js',
    './js/excel.js',
    './js/ui.js',
    './js/palette.js',
    './js/insights.js',
    './js/lotes.js',
    './js/dashboard.js',
    './js/sync.js',
    './js/settings.js',
    './js/app.js',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(VERSION).then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== VERSION).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    if (url.origin === self.location.origin) {
        event.respondWith((async () => {
            // ignoreSearch: sirve cache instalado aunque el HTML pida ?v=N
            const cached = await caches.match(req, { ignoreSearch: true });
            try {
                const res = await fetch(req);
                if (res && res.ok) {
                    const cache = await caches.open(VERSION);
                    await cache.put(new Request(url.origin + url.pathname), res.clone());
                }
                return res;
            } catch {
                return cached || Response.error();
            }
        })());
        return;
    }

    event.respondWith(
        fetch(req).then(res => {
            if (res && res.ok) {
                const clone = res.clone();
                caches.open(VERSION).then(c => c.put(req, clone)).catch(() => {});
            }
            return res;
        }).catch(() => caches.match(req).then(c => c || Response.error()))
    );
});
