/* Service worker: network-first local (evita CSS/JS viejos), fallback a cache offline. */

const VERSION = 'vm-v110';
const STATIC_ASSETS = [
    './',
    './index.html',
    './reset.html',
    './clear-cache.html',
    './manifest.json',
    './css/styles.css',
    './js/calc.js',
    './js/data.js',
    './js/excel.js',
    './js/ui.js',
    './js/palette.js',
    './js/insights.js',
    './js/lotes.js',
    './js/envios.js',
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
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) {
        event.respondWith(
            fetch(req).catch(() => caches.match(req).then(c => c || Response.error()))
        );
        return;
    }

    const isNav = req.mode === 'navigate' || req.destination === 'document'
        || url.pathname.endsWith('/') || url.pathname.endsWith('.html');

    event.respondWith((async () => {
        // HTML siempre fresco: si no, el ?v= del index se queda pegado
        if (isNav) {
            try {
                const res = await fetch(req, { cache: 'no-store' });
                if (res && res.ok) {
                    const cache = await caches.open(VERSION);
                    await cache.put('./index.html', res.clone()).catch(() => {});
                }
                return res;
            } catch {
                return (await caches.match('./index.html')) || Response.error();
            }
        }

        try {
            const res = await fetch(req, { cache: 'no-store' });
            if (res && res.ok) {
                const cache = await caches.open(VERSION);
                await cache.put(new Request(url.origin + url.pathname), res.clone());
            }
            return res;
        } catch {
            const cached = await caches.match(req, { ignoreSearch: true });
            return cached || Response.error();
        }
    })());
});
