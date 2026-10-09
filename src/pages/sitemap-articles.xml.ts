import type { APIRoute } from 'astro';
import { postQueries, tagQueries, seriesQueries } from '../lib/db';

// GET /sitemap-articles.xml —— 数据库里的动态内容（文章 / 标签 / 连载）
//
// 为什么需要这个文件：@astrojs/sitemap 只会遍历「静态文件路由」，
// 而本站文章全部存在 SQLite 里（/blog/[slug] 是 SSR 动态路由），
// 所以集成生成的 sitemap 里一篇文章都没有——搜索引擎拿到的地图是空的。
// 这里用一条 SQL 直接吐动态 URL，并在 robots.txt 里同时声明两份 sitemap。

const escapeXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const GET: APIRoute = ({ site }) => {
  const base = site ? site.origin : 'https://krivy.cyou';
  const urls: string[] = [];

  // 文章：lastmod 用 updated_at（编辑后能被重新抓取）
  for (const p of postQueries.findApprovedForSitemap.all() as {
    slug: string;
    updated_at: number;
  }[]) {
    urls.push(
      `<url><loc>${escapeXml(`${base}/blog/${p.slug}/`)}</loc>` +
        `<lastmod>${new Date(p.updated_at).toISOString()}</lastmod>` +
        `<changefreq>weekly</changefreq></url>`
    );
  }

  // 标签页：中文标签必须 URL 编码，否则 XML 里的 loc 不合法
  for (const t of tagQueries.allWithCount.all() as { name: string }[]) {
    urls.push(
      `<url><loc>${escapeXml(`${base}/tags/${encodeURIComponent(t.name)}/`)}</loc>` +
        `<changefreq>weekly</changefreq></url>`
    );
  }

  // 连载系列页
  for (const s of seriesQueries.listAll.all() as { slug: string; updated_at: number }[]) {
    urls.push(
      `<url><loc>${escapeXml(`${base}/series/${s.slug}/`)}</loc>` +
        `<lastmod>${new Date(s.updated_at).toISOString()}</lastmod></url>`
    );
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // 边缘缓存 1 小时、浏览器 10 分钟：发新文后不用等太久
      'Cache-Control': 'public, max-age=600, s-maxage=3600, stale-while-revalidate=600',
    },
  });
};
