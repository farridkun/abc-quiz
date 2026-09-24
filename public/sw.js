// Minimal service worker: makes the app installable and shows the cached shell
// when a page is opened offline. API calls are never cached.
const CACHE = 'abc-shell-v3';
const SHELL = ['/', '/styles.css?v=0.4.0', '/app.js?v=0.5.0', '/assets/fonts.css', '/assets/favicon.svg', '/assets/icon-192.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match('/')));
});
