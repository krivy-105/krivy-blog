// Service Worker —— want to see you
// 策略：页面 network-first（离线回退缓存/offline.html），
// 静态资源 stale-while-revalidate；不拦截 /api 与跨域请求。
// v2：页面缓存改为只收公开响应（见 isCacheablePage），
//     版本号必须跟着变——否则 activate 阶段清不掉旧版本里混进去的私有页。
const VERSION = 'v2';
const CACHE = `wtsy-cache-${VERSION}`;
// 不再预缓存 '/'：访客登录状态下它是带个人信息的响应，属于不该进缓存的内容。
const PRECACHE = ['/offline.html', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 单个资源 404 不该让整个 SW 安装失败
      .then((c) => Promise.all(PRECACHE.map((url) => c.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
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
    // 只缓存"公开页面"。
    // 私信、通知、后台这些页面是登录后服务端渲染的，内容属于个人数据；
    // 以前不看响应头就 cache.put，等于把别人（或自己登出前）的私信正文
    // 留在 Cache Storage 里——同一台设备换人用、或者断网回退时会被读出来。
    // 后端已经给私有页标了 Cache-Control: private，直接照着这个信号决定。
    if (res && res.status === 200 && isCacheablePage(res)) {
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return caches.match('/offline.html');
  }
}

// 私有页面一律不进缓存；没有 cache-control 的响应保守起见也不缓存。
function isCacheablePage(res) {
  const cc = (res.headers.get('cache-control') || '').toLowerCase();
  if (!cc) return false;
  if (cc.includes('private') || cc.includes('no-store') || cc.includes('no-cache')) return false;
  return true;
}
