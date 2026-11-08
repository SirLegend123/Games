// Clocktower Daily's service worker: shows phone notifications and opens the app when one is tapped.
// It doesn't cache anything, so the app always loads fresh from the website.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) { p = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(p.title || "Clocktower Daily", {
    body: p.body || "", tag: p.tag || undefined, renotify: !!p.tag,
    icon: "img/icon-192.png", badge: "img/icon-192.png", data: { url: p.url || "daily.html" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "daily.html", self.location.href);
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if (new URL(c.url).pathname === url.pathname && "focus" in c) return c.navigate ? c.navigate(url.href).then(w => (w || c).focus()) : c.focus();
    return self.clients.openWindow(url.href);
  }));
});
