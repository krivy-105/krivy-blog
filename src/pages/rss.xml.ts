import type { APIRoute } from 'astro';
import { postQueries } from '../lib/db';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';

// GET /rss.xml —— RSS 2.0 订阅源
//
// 本站原来只有 /feed（登录后「关注的人」动态流），不是给阅读器订阅的。
// 这里输出最近 20 篇已发布文章，配合 <link rel="alternate"> 让阅读器自动发现。
// 只放摘要不放全文：正文进 feed 会让每次抓取都跑一遍 Markdown 渲染。

const MAX_ITEMS = 20;

const escapeXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// 无 description 的老文章：从正文里截一段纯文本当摘要
function excerpt(content: string, len = 160): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > len ? `${plain.slice(0, len)}…` : plain;
}

export const GET: APIRoute = ({ site }) => {
  const base = site ? site.origin : 'https://krivy.cyou';
  const posts = postQueries.findApprovedRecent.all(MAX_ITEMS) as {
    slug: string;
    title: string;
    description: string | null;
    content: string;
    created_at: number;
  }[];

  const items = posts
    .map((p) => {
      const link = `${base}/blog/${p.slug}/`;
      const summary = (p.description || '').trim() || excerpt(p.content);
      return [
        '<item>',
        `<title>${escapeXml(p.title)}</title>`,
        `<link>${escapeXml(link)}</link>`,
        `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `<pubDate>${new Date(p.created_at).toUTCString()}</pubDate>`,
        `<description>${escapeXml(summary)}</description>`,
        '</item>',
      ].join('');
    })
    .join('');

  const lastBuild = posts[0]
    ? new Date(posts[0].created_at).toUTCString()
    : new Date().toUTCString();

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">` +
    `<channel>` +
    `<title>${escapeXml(SITE_TITLE)}</title>` +
    `<link>${base}/</link>` +
    `<description>${escapeXml(SITE_DESCRIPTION)}</description>` +
    `<language>zh-CN</language>` +
    `<lastBuildDate>${lastBuild}</lastBuildDate>` +
    `<atom:link href="${base}/rss.xml" rel="self" type="application/rss+xml"/>` +
    items +
    `</channel></rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=1800, s-maxage=3600, stale-while-revalidate=600',
    },
  });
};
