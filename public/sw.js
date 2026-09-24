// Minimal service worker — required for PWA installability (beforeinstallprompt).
// No fetch handler; all network requests are handled by the browser normally.
self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});
