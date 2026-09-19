import { defineMiddleware } from 'astro:middleware';
import crypto from 'node:crypto';
import { getUserFromToken, COOKIE_NAME } from './lib/auth';
import { statQueries, visitorQueries } from './lib/db';

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
        // 记录访客去重；返回 changes 判断是否新访客，从而把 PV/UV 各缩减为一条 UPSERT
        const isNewVisitor = visitorQueries.recordUv.run(date, ipHash).changes > 0;
        if (isNewVisitor) {
          statQueries.bumpUv.run(date);
        } else {
          statQueries.bumpPv.run(date);
        }
      }
    }
  } catch {}

  return res;
});
