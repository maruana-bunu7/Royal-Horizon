// Royal Horizon — Firebase Cloud Messaging Service Worker
// Place this file in the ROOT of your GitHub Pages repo (same folder as index.html)

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyAaN87Ce6H5vyzTctlUocJvMAcJqPnW6zA",
  authDomain:        "royal-horizon.firebaseapp.com",
  databaseURL:       "https://royal-horizon-default-rtdb.firebaseio.com",
  projectId:         "royal-horizon",
  storageBucket:     "royal-horizon.firebasestorage.app",
  messagingSenderId: "536841749759",
  appId:             "1:536841749759:web:70715758286b8b269b38ca"
});

const messaging = firebase.messaging();

// ── BACKGROUND MESSAGES (app closed / tab not focused) ──
messaging.onBackgroundMessage(payload => {
  const title = (payload.notification && payload.notification.title)
    || (payload.data && payload.data.title)
    || 'Royal Horizon';

  const body = (payload.notification && payload.notification.body)
    || (payload.data && payload.data.body)
    || '';

  const icon  = (payload.data && payload.data.icon)  || '/icon-192.png';
  const badge = (payload.data && payload.data.badge) || '/icon-192.png';
  const tag   = (payload.data && payload.data.tag)   || 'rh-notification';
  const url   = (payload.data && payload.data.url)   || '/';

  return self.registration.showNotification(title, {
    body,
    icon,
    badge,
    tag,
    renotify: true,
    data: { url }
  });
});

// ── NOTIFICATION CLICK — open or focus the app ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('Royal-Hori') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── CACHE SHELL FOR OFFLINE USE ──
const CACHE_NAME = 'rh-shell-v2';
const SHELL_ASSETS = [
  './',
  './index.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for HTML/JS, cache fallback for offline
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
