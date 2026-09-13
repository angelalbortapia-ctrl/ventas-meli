/* Service worker: solo limpia instalaciones viejas. No intercepta red ni recarga pestañas.
   (Safari iOS + clients.navigate dejaba la PWA en blanco.) */

const VERSION = 'vm-v459-off';

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
        try {
            const clientsList = await self.clients.matchAll({ type: 'window' });
            for (const client of clientsList) {
                client.postMessage({ type: 'vm-sw-off', version: VERSION });
            }
        } catch (_) { /* ignore */ }
    })());
});
