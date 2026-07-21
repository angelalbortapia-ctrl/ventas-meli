/* Service worker minimalista: cache-first para assets estáticos.
   Deja pasar las peticiones al CDN de SheetJS y Google Fonts como network-first. */

const VERSION = 'vm-v8';
const STATIC_ASSETS = [
    './',
    './index.html',
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
    const url = new URL(req.url);

    if (req.method !== 'GET') return;

    // Assets locales: cache-first
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(req).then(cached => {
                if (cached) return cached;
                return fetch(req).then(res => {
                    if (res.ok) {
                        const clone = res.clone();
                        caches.open(VERSION).then(c => c.put(req, clone)).catch(() => {});
                    }
                    return res;
                }).catch(() => cached);
            })
        );
        return;
    }

    // Externos (CDN): network-first, cache como respaldo
    event.respondWith(
        fetch(req).then(res => {
            if (res.ok) {
                const clone = res.clone();
                caches.open(VERSION).then(c => c.put(req, clone)).catch(() => {});
            }
            return res;
        }).catch(() => caches.match(req))
    );
});
