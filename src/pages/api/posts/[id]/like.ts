import type { APIRoute } from 'astro';
import { likeQueries, postQueries } from '../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/posts/:id/like —— 点赞 / 取消点赞（切换）
export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录' }, 401);

  const postId = Number(params.id);
  if (!Number.isFinite(postId)) return json({ error: '文章不存在' }, 404);

  const post = postQueries.findById.get(postId) as { status: string } | undefined;
  if (!post || post.status !== 'approved') return json({ error: '文章不存在' }, 404);

  const existing = likeQueries.find.get(user.id, postId);
  let liked: boolean;
  if (existing) {
    likeQueries.remove.run(user.id, postId);
    liked = false;
  } else {
    likeQueries.add.run(user.id, postId, Date.now());
    liked = true;
  }

  const likes = (likeQueries.countForPost.get(postId) as { count: number }).count;
  return json({ success: true, liked, likes });
};
