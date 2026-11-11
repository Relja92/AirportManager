// Build-time placeholders are filled after Vite emits its hashed assets.
const VERSION = __PWA_VERSION__;
const SHELL = __PWA_SHELL__;
const PREFIX = 'airport-manager-';
const APP_CACHE = `${PREFIX}app-${VERSION}`;
const IMAGE_CACHE = `${PREFIX}images-${VERSION}`;
const MAX_IMAGES = 96;
const MAX_IMAGE_BYTES = 1024 * 1024;
const shellPaths = new Set(SHELL);
let imageWrites = Promise.resolve();

self.addEventListener('install', event => {
  // Installation is atomic: never activate a build missing its JS or CSS.
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))));
  // Updates wait for the player to choose Save & update, or close every tab.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Retain the preceding shell for any older tab still using its hashed code.
    const older = keys.filter(key => key.startsWith(`${PREFIX}app-`) && key !== APP_CACHE);
    let previous;
    for (const key of older.reverse()) {
      if (await (await caches.open(key)).match('/index.html')) { previous = key; break; }
    }
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && ![APP_CACHE, IMAGE_CACHE, previous].includes(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

async function shellResponse(request, path) {
  const cache = await caches.open(APP_CACHE);
  return await cache.match(path) || fetch(request);
}

async function storeImage(request, response) {
  // Bounds both entry count and size. Quota failures must never break the game.
  const blob = await response.blob();
  if (blob.size > MAX_IMAGE_BYTES) return;
  const cached = new Response(blob, { status: response.status, statusText: response.statusText, headers: response.headers });
  imageWrites = imageWrites.then(async () => {
    const cache = await caches.open(IMAGE_CACHE);
    await cache.put(request, cached);
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_IMAGES)).map(key => cache.delete(key)));
  }).catch(() => {});
  await imageWrites;
}

async function imageResponse(event, path) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  try {
    const response = await fetch(event.request);
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Image unavailable');
    event.waitUntil(storeImage(event.request, response.clone()).catch(() => {}));
    return response;
  } catch {
    // Larger desktop basemaps can use the saved phone basemaps while offline.
    const fallback = { '/textures/earth-day.jpg': '/textures/earth-day-mobile.jpg', '/textures/earth-night.jpg': '/textures/earth-night-mobile.jpg' }[path];
    if (fallback) return shellResponse(event.request, fallback);
    return Response.error(); // Tile loaders keep drawing their base imagery.
  }
}

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    if (url.pathname === '/' || url.pathname === '/index.html') event.respondWith(shellResponse(request, '/index.html'));
    return;
  }
  if (shellPaths.has(url.pathname)) {
    event.respondWith(shellResponse(request, url.pathname));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  } else if (/^\/textures\/(?:earth-(?:day|night)\.jpg|(?:terrain|night)-tiles\/\d+\/\d+-\d+\.jpg)$/.test(url.pathname)) {
    event.respondWith(imageResponse(event, url.pathname));
  }
});
