// Minimal service worker for AttendEdge — enables reliable
// notifications on mobile browsers (where `new Notification()` throws)
// and keeps notification taps focusing the app.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow("/");
  })());
});

// No fetch handler — we intentionally do NOT cache anything.
// This SW exists purely to unlock ServiceWorkerRegistration.showNotification
// on Android Chrome, where the direct Notification constructor is disallowed.
