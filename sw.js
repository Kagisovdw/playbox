/* ==========================================================================
   sw.js - service worker: makes Playbox installable and playable offline.

   Strategy is stale-while-revalidate: serve the cached copy immediately, then
   refresh it in the background so the next load has your latest edits. That
   avoids the classic "I changed a file and the browser won't show it" trap of
   a pure cache-first worker.

   Only runs over http(s). Opening index.html straight off disk (file://)
   skips registration entirely - see the bottom of index.html.
   ========================================================================== */

var CACHE = 'playbox-v2';

var SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/core.js',
  './js/connect4.js',
  './js/snakes.js',
  './js/ludo.js',
  './js/uno.js',
  './js/memory.js',
  './js/xo.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // addAll is all-or-nothing, so one bad path would fail the whole install.
      .then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;

  // Leave anything that isn't a plain same-origin GET to the network.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function (cached) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // Offline: fall back to the cache, or the shell for a navigation.
        return cached || caches.match('./index.html');
      });

      return cached || fresh;
    })
  );
});
