// Service worker — makes Chess Dungeon installable and playable OFFLINE.
// Strategy: NETWORK-FIRST (dev-friendly). When online we always fetch the freshest file and update the
// cache, so a `git push` shows up on the phone immediately — no version bump needed while iterating.
// When offline we fall back to the cached copy (precached on install), so the home-screen app still
// runs with no connection. Before a real "ship", consider switching to cache-first for instant loads.
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
  // Music (looped per screen).
  './sounds/title_screen.mp3',
  './sounds/dungeon.mp3',
  './sounds/hell.mp3',
  './sounds/upgrade_screen.mp3',
  './sounds/game_over.mp3',
  // Piece sprites (light + dark of each).
  './images/king_white.png', './images/king_black.png',
  './images/queen_white.png', './images/queen_black.png',
  './images/rook_white.png', './images/rook_black.png',
  './images/bishop_white.png', './images/bishop_black.png',
  './images/horse_white.png', './images/horse_black.png',
  './images/pawn_white.png', './images/pawn_black.png',
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
    // Network-first: try the live file, refresh the cache with it, and only reach for the cache when
    // the network fails (offline). Falls back to the cached index.html for navigations when offline.
    fetch(request)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
  );
});
