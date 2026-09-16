import type { APIRoute } from 'astro';
import { commentQueries, postQueries } from '../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// GET /api/posts/:id/comments —— 评论列表
export const GET: APIRoute = async ({ params }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) return json({ error: '文章不存在' }, 404);

  const comments = commentQueries.findByPost.all(postId);
  return json({ success: true, comments });
};

// POST /api/posts/:id/comments —— 发表评论
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录后再评论' }, 401);

  const postId = Number(params.id);
  if (!Number.isFinite(postId)) return json({ error: '文章不存在' }, 404);

  const post = postQueries.findById.get(postId) as { status: string } | undefined;
  if (!post || post.status !== 'approved') return json({ error: '文章不存在' }, 404);

  let content = '';
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json();
    content = (body.content as string) ?? '';
  } else {
    const form = await request.formData();
    content = (form.get('content') as string) ?? '';
  }
  content = content.trim();

  if (!content) return json({ error: '评论内容不能为空' }, 400);
  if (content.length > 500) return json({ error: '评论最长 500 字' }, 400);

  const now = Date.now();
  const result = commentQueries.create.run(postId, user.id, content, now);

  return json({
    success: true,
    comment: {
      id: result.lastInsertRowid,
      post_id: postId,
      user_id: user.id,
      username: user.username,
      content,
      created_at: now,
    },
  });
};
