// Minimal service worker — required for PWA installability (beforeinstallprompt).
// No caching strategy; the app relies on the server for all network requests.
self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (e) {
  // Pass all requests through to the network unchanged.
  e.respondWith(fetch(e.request));
});
