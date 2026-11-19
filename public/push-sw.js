// Service worker só para notificações push da área de gestão (/app).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'insightFrota', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'insightFrota', { body: d.body || '', icon: '/icons/icon-192.png', data: { url: d.url || '/app/alerts' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data && e.notification.data.url ? e.notification.data.url : '/app/alerts'));
});
