/* ==========================================================================
   sw.js - service worker: makes Playbox installable and playable offline.

   Strategy is network-first with a cache fallback. Online, you always get the
   deployed files, so a new game or a CSS change can never render against a
   stale copy of the other. Offline, everything falls back to the cache.

   An earlier stale-while-revalidate version shipped new HTML against old CSS
   after a deploy, which is why this trades a little latency for consistency.

   Both precache and runtime fetches bypass the browser's HTTP cache -
   cache:'reload' on install, cache:'no-cache' at runtime. GitHub Pages sends
   max-age=600 on everything, so without this a deploy can serve new HTML
   against a ten-minute-old stylesheet. That is the bug that rendered the
   X's & O's board unstyled, and it is why playbox-v2 was populated with
   v1's CSS.

   Bump CACHE on every deploy. Only runs over http(s); opening index.html off
   disk (file://) skips registration - see the bottom of index.html.
   ========================================================================== */

var CACHE = 'playbox-v6';

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
      .then(function (c) {
        return Promise.all(SHELL.map(function (u) {
          // cache:'reload' forces a network hit, never the HTTP cache.
          return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
        }));
      })
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
    // cache:'no-cache' revalidates with the server (cheap 304s) instead of
    // trusting GitHub Pages' 10-minute max-age, which is what let new HTML
    // load against an old stylesheet.
    fetch(new Request(req, { cache: 'no-cache' }))
      .then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        // Offline: serve the cached copy, or the shell for a navigation.
        return caches.match(req).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
  );
});
