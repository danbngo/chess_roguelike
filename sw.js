// Service worker — makes Chess Dungeon installable and fully playable OFFLINE.
// Strategy: precache the whole (small, static) bundle on install, then serve cache-first so a launch
// from the home screen needs no network. Bump CACHE_VERSION whenever any cached file changes — the new
// worker precaches the fresh set and the `activate` handler purges the old cache.
const CACHE_VERSION = 'chess-dungeon-v1';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './icon-maskable-512.png',
  // Scripts, in the same order index.html loads them.
  './src/config.js',
  './src/constants.js',
  './src/utils.js',
  './src/terrain.js',
  './src/pieces.js',
  './src/board.js',
  './src/game.js',
  './src/storage.js',
  './src/achievements.js',
  './src/audio.js',
  './src/renderer.js',
  './src/input.js',
  './src/tutorials.js',
  './src/main.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // only ever cache reads
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      // Not precached (e.g. a query-string variant): fetch, and tuck a copy away for next time.
      return fetch(request)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html')); // offline fallback for navigations
    }),
  );
});
