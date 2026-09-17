import type { APIRoute } from 'astro';
import rss from '@astrojs/rss';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';
import { postQueries } from '../lib/db';

// GET /rss.xml —— 全站 RSS 订阅
export const GET: APIRoute = ({ site }) =>
  rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: site ?? 'https://krivy.cyou',
    items: (postQueries.findApproved.all() as any[]).map((p) => ({
      title: p.title,
      description: p.description || '',
      pubDate: new Date(p.created_at).toUTCString(),
      link: `/blog/${p.slug}/`,
      author: p.author_name,
    })),
    customData: '<language>zh-CN</language>',
  });
