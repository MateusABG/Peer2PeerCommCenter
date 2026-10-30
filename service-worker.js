/* Conservative app-shell cache. PeerJS and Google Fonts stay network-only. */
const CACHE_NAME = "peerly-shell-v11";
const APP_SHELL = [
  "./", "./index.html", "./room.html", "./manifest.webmanifest",
  "./css/themes.css", "./css/base.css", "./css/login.css", "./css/room.css", "./css/streaming.css", "./css/media-sync.css",
  "./js/theme.js", "./js/config.js", "./js/login.js", "./js/room.js", "./js/whiteboard.js", "./js/streaming.js",
  "./js/laser.js", "./js/voices.js", "./js/speaking.js", "./js/network.js", "./js/notifications.js",
  "./js/media-sync.js", "./js/export.js", "./js/backup.js", "./js/pwa.js", "./icon.png", "./icon-192.png", "./icon-512.png", "./logo.png"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // network first (so updated CSS/JS always arrive), the cache only when offline
  event.respondWith(fetch(request, { cache: "no-cache" }).then(response => {
    if (response && response.ok && response.type === "basic") {
      const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request, { ignoreSearch: true }).then(cached => cached || caches.match("./index.html"))));
});
