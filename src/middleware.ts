import { defineMiddleware } from 'astro:middleware';
import crypto from 'node:crypto';
import { getUserFromToken, COOKIE_NAME } from './lib/auth';
import { recordPageView } from './lib/db';

export const onRequest = defineMiddleware(async (context, next) => {
  const token = context.cookies.get(COOKIE_NAME)?.value;
  if (token) {
    const user = getUserFromToken(token);
    if (user) {
      context.locals.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        avatar: user.avatar,
      };
    }
  }

  const res = await next();

  // 安全响应头（覆盖所有 SSR 页面；静态资源由 server.mjs 直出无需这些头）
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // 内容安全策略。
  // 说明：script/style 仍保留 'unsafe-inline'——站点大量使用内联 <script is:inline>
  // 与行内样式属性，Astro 没有内建的 nonce/hash 注入，强行上 nonce 会整站白屏。
  // 即便如此，下面这些指令仍然挡掉真实攻击面：object/embed 载体、<base> 劫持、
  // 表单被改向外域（钓鱼）、页面被 iframe 嵌套（点击劫持）、意外加载第三方脚本。
  // img/media 放开 http(s)：Markdown 允许贴外链图片；connect 放开 ws/wss：站内私信走 WebSocket。
  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: http:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "media-src 'self' https: http:",
      "manifest-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );

  // 缓存策略（仅 HTML 页面）：
  // - 匿名访客的公开页面：浏览器不缓存，Cloudflare 边缘缓存 30s（过期后 60s 内可用旧响应边刷新）
  // - 登录用户 / 私有路径：完全不缓存，避免把含用户信息的页面共享给其他访客
  // 非 HTML（CSS/JS/字体/图片）不动，保留静态资源的 immutable 长缓存
  const contentType = res.headers.get('content-type') || '';
  if (context.request.method === 'GET' && res.status === 200 && contentType.includes('text/html')) {
    const reqPath = new URL(context.request.url).pathname;
    const hasSession = (context.request.headers.get('cookie') || '').includes(`${COOKIE_NAME}=`)
      || !!context.locals.user;
    const privatePrefixes = [
      '/api/', '/admin', '/write', '/edit', '/messages',
      '/login', '/register', '/notifications',
    ];
    const isPrivatePath = privatePrefixes.some((p) => reqPath.startsWith(p));
    if (!hasSession && !isPrivatePath) {
      res.headers.set(
        'Cache-Control',
        'public, max-age=0, s-maxage=30, stale-while-revalidate=60'
      );
    } else {
      res.headers.set('Cache-Control', 'private, no-cache');
    }
  }

  // 站点 PV/UV 统计（仅在 GET 请求、跳过静态资源 / API / 爬虫）
  try {
    if (context.request.method === 'GET') {
      const ua = context.request.headers.get('user-agent') || '';
      if (/bot|crawler|spider|slurp|curl|wget|headless/i.test(ua)) {
        return res;
      }
      const url = new URL(context.request.url);
      const path = url.pathname;
      if (
        !path.startsWith('/api/') &&
        !path.startsWith('/_astro/') &&
        !/\.[a-z0-9]+$/i.test(path)
      ) {
        const ip = (context.request.headers.get('x-forwarded-for') || '')
          .split(',')[0]
          ?.trim();
        const ipHash = ip
          ? crypto
              .createHash('sha256')
              .update(ip + (process.env.VIEW_SALT || 'blog-stats-salt'))
              .digest('hex')
              .slice(0, 16)
          : '';
        const date = new Date().toISOString().slice(0, 10);
        // 记录访客去重 + PV/UV，合并为单个事务（详见 db.ts 的 recordPageView）
        recordPageView(date, ipHash);
      }
    }
  } catch {}

  return res;
});
