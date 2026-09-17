import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { postQueries, viewQueries } from '../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/posts/:id/view —— 记录一次浏览（按 post_id + date + ip_hash 去重）
export const POST: APIRoute = ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) return json({ error: '文章不存在' }, 404);

  const post = postQueries.findById.get(postId) as { status: string } | undefined;
  if (!post || post.status !== 'approved') return json({ error: '文章不存在' }, 404);

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
  const hash = crypto
    .createHash('sha256')
    .update(ip + (process.env.VIEW_SALT || 'blog-view-salt'))
    .digest('hex')
    .slice(0, 16);
  const date = new Date().toISOString().slice(0, 10);

  try {
    viewQueries.record.run(postId, date, hash, Date.now());
  } catch {}

  const count = (viewQueries.countForPost.get(postId) as { count: number }).count;
  return json({ success: true, views: count });
};
