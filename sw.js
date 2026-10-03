const CACHE_NAME = 'autosale-stable-20261003c';
const CORE = ['./', './index.html', './styles.css', './app.js', './supabase-config.js', './logo.png', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isCode = event.request.mode === 'navigate' || /\.(?:html|js|css|json)$/i.test(url.pathname) || url.pathname.endsWith('/');
  if (isCode) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone())).catch(() => {});
      return response;
    }).catch(async () => (await caches.match(event.request)) || (await caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone())).catch(() => {});
    return response;
  })));
});
