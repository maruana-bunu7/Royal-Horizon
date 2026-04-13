const CACHE_NAME = 'royal-horizon-v3';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
];

// INSTALL
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ACTIVATE (clean old caches)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// FETCH
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

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
