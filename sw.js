// Çevrimdışı çalışma: uygulama dosyaları önbellekten, piyasa verisi önce internetten.
const CACHE = 'bb-v7';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'cloud.js', 'firebase-config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png', 'icons/logo.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Bildirim: FCM'den gelen mesajı göster (uygulama kapalıyken de)
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) { p = { body: e.data?.text() }; }
  const n = p.notification || p.data || p;
  e.waitUntil(self.registration.showNotification(n.title || 'Büt Ç.', {
    body: n.body || 'Bugün ne harcadın la?',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: 'but-c-durt',
    renotify: true,
    data: { url: n.url || './' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => x.url.startsWith(self.registration.scope));
    return w ? w.focus() : clients.openWindow(e.notification.data?.url || './');
  }));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Firebase kütüphaneleri sürüm numaralı, değişmez → bir kez indir, hep önbellekten
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
      return r;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('/data/market.json')) {
    e.respondWith(fetch(e.request).then(r => {
      const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c));
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // Önbellekten hızlı aç, arkada güncelle (yeni sürüm bir sonraki açılışta gelir)
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
      return r;
    }).catch(() => hit);
    return hit || net;
  }));
});
