import type { APIRoute } from 'astro';
import { postQueries, shareQueries } from '../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/posts/:id/share —— 记录一次转发（分享）
export const POST: APIRoute = async ({ params, locals }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) return json({ error: '文章不存在' }, 404);

  const post = postQueries.findById.get(postId) as { status: string } | undefined;
  if (!post || post.status !== 'approved') return json({ error: '文章不存在' }, 404);

  shareQueries.create.run(postId, locals.user?.id ?? null, Date.now());
  const shares = (shareQueries.countForPost.get(postId) as { count: number }).count;
  return json({ success: true, shares });
};
