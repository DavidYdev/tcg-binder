/* Service worker: keeps a copy of the app so it opens without a connection.
   Network first: when online you always get the latest version (and the
   copy is refreshed); offline, the saved copy is used. Only the app's own
   files go through here. Card data, prices and images come from other
   sites and go straight to the network, so offline you still see your
   collection, but searching and updating prices need a connection. */
const CACHE = 'tcg-binder-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
