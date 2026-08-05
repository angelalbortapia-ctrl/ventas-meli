/* Service worker: network-first local (evita CSS/JS viejos), fallback a cache offline. */

const VERSION = 'vm-v193';
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
    './js/keepa.js',
    './js/keepa-view.js',
    './js/palette.js',
    './js/insights.js',
    './js/envios.js',
    './js/wishlist.js',
    './js/lotes.js',
    './js/dashboard.js',
    './js/caja.js',
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

    // Las respuestas Keepa dependen de ASIN, parámetros y una key privada.
    // Nunca guardarlas bajo una URL sin query ni servir datos de otro producto.
    if (url.pathname.startsWith('/api/keepa/')) {
        event.respondWith(fetch(req, { cache: 'no-store' }));
        return;
    }

    const isNav = req.mode === 'navigate' || req.destination === 'document'
        || url.pathname.endsWith('/') || url.pathname.endsWith('.html');

    event.respondWith((async () => {
        // HTML siempre fresco: si no, el ?v= del index se queda pegado
        if (isNav) {
            const path = url.pathname || '/';
            const isAppShell = path === '/' || path.endsWith('/') || path.endsWith('/index.html');
            try {
                const res = await fetch(req, { cache: 'no-store' });
                if (res && res.ok) {
                    const cache = await caches.open(VERSION);
                    // Nunca guardar reset.html / clear-cache.html como index.html
                    if (isAppShell) {
                        await cache.put('./index.html', res.clone()).catch(() => {});
                    } else {
                        await cache.put(new Request(url.origin + url.pathname), res.clone()).catch(() => {});
                    }
                }
                return res;
            } catch {
                if (isAppShell) {
                    return (await caches.match('./index.html')) || Response.error();
                }
                return (await caches.match(req, { ignoreSearch: true }))
                    || (await caches.match('./index.html'))
                    || Response.error();
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

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientsList) {
            if ('focus' in client) {
                await client.focus();
                return;
            }
        }
        if (self.clients.openWindow) await self.clients.openWindow('./');
    })());
});
