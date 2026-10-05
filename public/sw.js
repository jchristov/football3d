// Offline support: the game files are cached the first time they are loaded, so the game starts without a network.
const CACHE = 'fb3d-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './audio/bed.mp3', './audio/chance.mp3', './audio/chance2.mp3', './audio/goal1.mp3', './audio/goal2.mp3', './audio/goal3.mp3',
  './audio/post_hit_03.mp3', './audio/post_hit_05.mp3', './audio/post_slam_01.mp3'];

// What to do with a request: 'ignore' (the browser handles it), 'navigate' (page loads: network first, cache as fallback)
// or 'asset' (files of the game: cache first, refreshed in the background)
function route(request, origin) {
  if (request.method !== 'GET') return 'ignore';
  const url = new URL(request.url);
  if (url.origin !== origin) return 'ignore'; // other sites (fonts, STUN ...) are none of our business
  if (request.headers.get('range')) return 'ignore'; // partial audio / video requests cannot be cached as a whole
  if (url.pathname.endsWith('/sw.js')) return 'ignore';
  return request.mode === 'navigate' ? 'navigate' : 'asset';
}
self.fb3dRoute = route;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('fb3d-')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const kind = route(e.request, self.location.origin);
  if (kind === 'ignore') return;
  if (kind === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return r; })
      .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then((r) => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
