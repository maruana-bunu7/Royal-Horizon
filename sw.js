const CACHE_NAME = 'rh-cache-v5';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});  const url = event.request.url;

  // 🚫 NEVER cache APIs
  if (
    url.includes('anthropic.com') ||
    url.includes('googleapis.com') ||
    url.includes('firebaseio.com')
  ) {
    return;
  }

  // 🎨 Fonts & external assets → stale while revalidate
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

  // 🧱 APP SHELL → cache first
  if (APP_SHELL.some(path => url.endsWith(path))) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request);
      })
    );
    return;
  }

  // 🌐 Default → network only (NO caching)
  event.respondWith(fetch(event.request));
});  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
