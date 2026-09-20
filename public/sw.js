// Service Worker —— want to see you
// 策略：页面 network-first（离线回退缓存/offline.html），
// 静态资源 stale-while-revalidate；不拦截 /api 与跨域请求。
const VERSION = 'v1';
const CACHE = `wtsy-cache-${VERSION}`;
const PRECACHE = ['/', '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 接口、私信、后台数据一律不缓存，避免离线时展示陈旧/他人数据
  if (url.pathname.startsWith('/api/')) return;
  // 每次发布哈希文件名会变的构建产物 / 图标 / 字体：SWR
  const isStatic =
    url.pathname.startsWith('/_astro/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/favicon-32.png';
  if (isStatic) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // 页面导航：网络优先，离线回退缓存，再回退离线页
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(req));
  }
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

async function networkFirstPage(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return caches.match('/offline.html');
  }
}
