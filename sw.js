const PREFIX = `wordloop:${self.registration.scope}:`;
const CACHE = `${PREFIX}v4`;
const ROOT = new URL('./', self.registration.scope).href;
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
const URLS = FILES.map(file => new URL(file, ROOT).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(URLS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !URLS.includes(event.request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        try { await cache.put(event.request, response.clone()); } catch { /* Keep online use available if cache storage is full. */ }
        return response;
      }
      return (await cache.match(event.request)) || response;
    } catch {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      return Response.error();
    }
  })());
});
