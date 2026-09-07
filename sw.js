/* Service Worker：缓存应用外壳，实现离线使用 */
const CACHE = 'jz-cache-v37';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/store.js',
  './js/theme.js',
  './js/license.js',
  './js/modal.js',
  './js/parser.js',
  './js/ai.js',
  './js/ocr.js',
  './js/charts.js',
  './js/xlsx.js',
  './js/backup.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/creator-qr.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  /* 网络优先。必须带 cache:'no-store' 绕开浏览器自己的 HTTP 缓存，
     否则 fetch 会把旧文件原样返回 —— 表现为「明明发了新版，用户还在跑旧代码」，
     连 index.html 都会被钉死在旧版本上。离线时再回落到 SW 缓存。 */
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
