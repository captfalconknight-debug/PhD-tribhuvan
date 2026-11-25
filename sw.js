/**
 * sw.js — service worker for offline use after the first visit.
 *
 * App files: network first (so updates arrive), cached copy when offline.
 * MediaPipe files in vendor/ (large, never change): cache first.
 * Bump CACHE when the vendor files change.
 */
const CACHE = 'vbbt-v3';
const CORE = [
  './', './index.html', './styles.css', './app.js', './engine.js', './render.js', './render3d.js', './filters.js',
  './storage.js', './setup.js', './config.js',
  './inputs/mouse.js', './inputs/camera.js', './inputs/handmath.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
];
const VENDOR = [
  './vendor/mediapipe/vision_bundle.mjs',
  './vendor/mediapipe/vision_wasm_internal.js',
  './vendor/mediapipe/vision_wasm_internal.wasm',
  './vendor/mediapipe/vision_wasm_nosimd_internal.js',
  './vendor/mediapipe/vision_wasm_nosimd_internal.wasm',
  './vendor/mediapipe/hand_landmarker.task',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    // Vendor files are large; cache them without failing the install if one is slow.
    await Promise.allSettled(VENDOR.map((u) => c.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/vendor/')) {
    e.respondWith((async () => {
      const hit = await caches.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
      return res;
    })());
    return;
  }
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
      return res;
    } catch {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw new Error('offline and not cached');
    }
  })());
});
