/* Service worker : affiche les notifications « Tes combats sont prêts » */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'L’Arène des Cogneurs', {
    body: d.body || 'Tes combats sont prêts !', icon: '/icon-192.png', badge: '/icon-192.png', tag: 'combats', renotify: true, data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if (new URL(w.url).origin === self.location.origin && 'focus' in w) return w.focus();
    return self.clients.openWindow(url);
  }));
});
