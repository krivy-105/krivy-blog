import type { APIRoute } from 'astro';
import { bookmarkQueries, postQueries } from '../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/posts/:id/bookmark —— 收藏 / 取消收藏（切换）
export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录' }, 401);

  const postId = Number(params.id);
  if (!Number.isFinite(postId)) return json({ error: '文章不存在' }, 404);

  const post = postQueries.findById.get(postId) as { status: string } | undefined;
  if (!post || post.status !== 'approved') return json({ error: '文章不存在' }, 404);

  const existing = bookmarkQueries.find.get(user.id, postId);
  let bookmarked: boolean;
  if (existing) {
    bookmarkQueries.remove.run(user.id, postId);
    bookmarked = false;
  } else {
    bookmarkQueries.add.run(user.id, postId, Date.now());
    bookmarked = true;
  }

  const bookmarks = (bookmarkQueries.countForPost.get(postId) as { count: number }).count;
  return json({ success: true, bookmarked, bookmarks });
};
