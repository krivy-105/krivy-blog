import type { APIRoute } from 'astro';
import { commentQueries, postQueries, notificationQueries } from '../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// GET /api/posts/:id/comments —— 评论列表（支持 threaded + sort）
export const GET: APIRoute = async ({ params, url }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) return json({ error: '文章不存在' }, 404);

  const mode = url.searchParams.get('mode') || 'flat';
  const sort = (url.searchParams.get('sort') || 'hot') as 'hot' | 'new';
  const sortSafe = sort === 'new' ? 'new' : 'hot';

  let comments: any;
  if (mode === 'threaded') {
    comments = commentQueries.findThreadedByPost(postId, sortSafe);
  } else {
    comments = commentQueries.findByPost.all(postId);
  }
  return json({ success: true, comments });
};

// POST /api/posts/:id/comments —— 发表评论（支持 parent_id / reply_to_user_id 楼中楼）
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录后再评论' }, 401);

  const postId = Number(params.id);
  if (!Number.isFinite(postId)) return json({ error: '文章不存在' }, 404);

  const post = postQueries.findById.get(postId) as { status: string; author_id: number } | undefined;
  if (!post || post.status !== 'approved') return json({ error: '文章不存在' }, 404);

  let content = '';
  let parentId: number | null = null;
  let replyToUserId: number | null = null;
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json();
    content = (body.content as string) ?? '';
    const p = Number(body.parent_id);
    if (Number.isFinite(p) && p > 0) parentId = p;
    const r = Number(body.reply_to_user_id);
    if (Number.isFinite(r) && r > 0) replyToUserId = r;
  } else {
    const form = await request.formData();
    content = (form.get('content') as string) ?? '';
    const p = Number(form.get('parent_id'));
    if (Number.isFinite(p) && p > 0) parentId = p;
    const r = Number(form.get('reply_to_user_id'));
    if (Number.isFinite(r) && r > 0) replyToUserId = r;
  }
  content = content.trim();

  if (!content) return json({ error: '评论内容不能为空' }, 400);
  if (content.length > 500) return json({ error: '评论最长 500 字' }, 400);

  // 如果 parent_id 存在，校验 parent 是否属于本 post 且未被删
  let replyToUsername: string | null = null;
  if (parentId) {
    const parent = commentQueries.findById.get(parentId) as any | undefined;
    if (!parent || parent.post_id !== postId || parent.deleted_at || parent.hidden_at) {
      return json({ error: '被回复的评论不存在或已被移除' }, 400);
    }
    if (!replyToUserId) replyToUserId = parent.user_id;
    replyToUsername = parent.username || null;
    // 嵌套层级：仅两层（顶层评论 + 回复），不支持无限嵌套，若回复的是回复→仍挂到其顶层 parent 下
    if (parent.parent_id) {
      parentId = parent.parent_id;
    }
  }

  const now = Date.now();
  const result = commentQueries.create.run(
    postId,
    user.id,
    content,
    now,
    parentId,
    replyToUserId
  );

  // 通知文章作者被评论（评论人不是作者本人时）
  notificationQueries.create({
    userId: post.author_id,
    actorId: user.id,
    type: 'comment',
    postId,
    commentId: Number(result.lastInsertRowid),
    content,
  });
  // 楼中楼：通知被回复者（被回复者既不是作者本人也已单独收到，也不是评论人自己）
  if (replyToUserId && replyToUserId !== post.author_id) {
    notificationQueries.create({
      userId: replyToUserId,
      actorId: user.id,
      type: 'comment',
      postId,
      commentId: Number(result.lastInsertRowid),
      content,
    });
  }

  return json({
    success: true,
    comment: {
      id: result.lastInsertRowid,
      post_id: postId,
      user_id: user.id,
      username: user.username,
      avatar: user.avatar ?? null,
      content,
      created_at: now,
      parent_id: parentId,
      reply_to_user_id: replyToUserId,
      reply_to_username: replyToUsername,
      like_count: 0,
      replies: [],
    },
  });
};
