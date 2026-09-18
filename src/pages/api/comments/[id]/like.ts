import type { APIRoute } from 'astro';
import { commentQueries, notificationQueries } from '../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/comments/:id/like —— 切换评论点赞
export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录' }, 401);

  const commentId = Number(params.id);
  if (!Number.isFinite(commentId)) return json({ error: '评论不存在' }, 404);

  const comment = commentQueries.findById.get(commentId) as
    | { id: number; post_id: number; user_id: number; deleted_at: number | null; hidden_at: number | null }
    | undefined;
  if (!comment || comment.deleted_at || comment.hidden_at) {
    return json({ error: '评论不存在或已被移除' }, 404);
  }

  const now = Date.now();
  const exist = commentQueries.likeFind.get(user.id, commentId) as { id: number } | undefined;
  let liked = false;
  if (exist) {
    commentQueries.likeRemove.run(user.id, commentId);
    liked = false;
  } else {
    try {
      commentQueries.likeAdd.run(user.id, commentId, now);
      liked = true;
      // 通知评论作者被点赞
      notificationQueries.create({
        userId: comment.user_id,
        actorId: user.id,
        type: 'comment_like',
        postId: comment.post_id,
        commentId,
      });
    } catch {
      liked = !!commentQueries.likeFind.get(user.id, commentId);
    }
  }
  const allCounts = commentQueries.likeCountForList.all() as { comment_id: number; count: number }[];
  const countRow = allCounts.find((r) => r.comment_id === commentId);
  const likes = liked && !countRow ? 1 : countRow?.count ?? 0;

  return json({ success: true, liked, likes });
};
