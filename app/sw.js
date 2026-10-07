// FitFit service worker: offline cache + push notifications
const CACHE = "fitfit-v1";
const ASSETS = ["./", "index.html", "styles.css", "app.js", "foods.js", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // APIs go straight to network
  // Network first for the app itself so updates arrive; fall back to cache offline
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
  );
});

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "FitFit", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "FitFit", {
    body: d.body || "Jebi has something to say 👀",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag || "fitfit",
    data: { url: d.url || "./" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) { c.postMessage({ url: target }); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
