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

  // 站点 PV/UV 统计（仅在 GET 请求、跳过静态资源 / API / rss）
  try {
    if (context.request.method === 'GET') {
      const url = new URL(context.request.url);
      const path = url.pathname;
      if (
        !path.startsWith('/api/') &&
        !path.startsWith('/_astro/') &&
        !path.startsWith('/rss') &&
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
        statQueries.ensureUv.run(date);
        if (visitorQueries.recordUv.run(date, ipHash).changes > 0) {
          statQueries.bumpUv.run(date);
        }
        statQueries.bumpPv.run(date);
      }
    }
  } catch {}

  return res;
});
