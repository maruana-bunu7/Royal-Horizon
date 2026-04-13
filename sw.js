const CACHE_NAME = 'rh-cache-v7';

const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json'
];

// ---- INSTALL ----
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ---- ACTIVATE ----
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---- FETCH ----
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // 🚫 NEVER cache Firebase or API calls
  if (
    url.includes('anthropic.com') ||
    url.includes('googleapis.com') ||
    url.includes('firebaseio.com') ||
    url.includes('firebaseapp.com') ||
    url.includes('identitytoolkit') ||
    url.includes('securetoken')
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 🎨 Fonts → stale while revalidate
  if (
    url.includes('gstatic.com') ||
    url.includes('fonts.googleapis.com') ||
    url.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(networkRes => {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkRes.clone());
          });
          return networkRes;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 🧱 App shell → cache first
  if (APP_SHELL.some(path => url.endsWith(path))) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request);
      })
    );
    return;
  }

  // 🌐 Everything else → network only
  event.respondWith(fetch(event.request));
});
