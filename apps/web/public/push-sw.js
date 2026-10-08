/* global self */
/* Push notifications (SPEC §8.2), pulled into the generated service worker by importScripts. */
self.addEventListener('push', (event) => {
  let n;
  try {
    n = event.data ? event.data.json() : {};
  } catch {
    n = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(n.title || 'Rise', {
      body: n.body || '',
      icon: '/icon-192.png',
      data: { url: n.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (wins) => {
      for (const w of wins) {
        try {
          await w.focus();
          await w.navigate(url);
          return;
        } catch {
          /* not ours to steer; open a fresh window instead */
        }
      }
      await self.clients.openWindow(url);
    }),
  );
});
