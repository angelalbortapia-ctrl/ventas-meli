/* Service worker: auto-desregistro.
   Safari iOS + SW rompía Sync (Load failed). La app ya no registra SW;
   este archivo solo limpia instalaciones viejas si el navegador lo actualiza. */

const VERSION = 'vm-v458-off';

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        } catch (_) { /* ignore */ }
        try {
            await self.registration.unregister();
        } catch (_) { /* ignore */ }
        const clientsList = await self.clients.matchAll({ type: 'window' });
        for (const client of clientsList) {
            try { client.navigate(client.url); } catch (_) { /* ignore */ }
        }
    })());
});

// No interceptar fetch: dejar la red al navegador.
