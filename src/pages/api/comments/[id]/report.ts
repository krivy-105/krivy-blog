import type { APIRoute } from 'astro';
import { commentQueries, reportQueries, userQueries, notificationQueries } from '../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

// POST /api/comments/:id/report —— 举报评论（一次性，不可重复）
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录后再举报' }, 401);

  const commentId = Number(params.id);
  if (!Number.isFinite(commentId)) return json({ error: '评论不存在' }, 404);

  const comment = commentQueries.findById.get(commentId) as
    | { id: number; user_id: number; deleted_at: number | null; hidden_at: number | null }
    | undefined;
  if (!comment || comment.deleted_at || comment.hidden_at) {
    return json({ error: '评论不存在或已被移除' }, 404);
  }

  if (comment.user_id === user.id) {
    return json({ error: '不能举报自己的评论' }, 400);
  }

  // 已经举报过 → 不允许重复
  const existing = reportQueries.find.get(commentId, user.id);
  if (existing) return json({ error: '你已举报过该评论，请等待管理员处理' }, 409);

  let reason = '';
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json();
    reason = (body.reason as string) ?? '';
  } else {
    const form = await request.formData();
    reason = (form.get('reason') as string) ?? '';
  }
  reason = reason.trim();
  if (!reason) return json({ error: '请填写举报理由' }, 400);
  if (reason.length > 200) return json({ error: '举报理由最长 200 字' }, 400);

  reportQueries.add.run(commentId, user.id, reason, Date.now());

  // 通知管理员（admin 账号）
  const admin = userQueries.findByUsername.get(ADMIN_USERNAME) as { id: number } | undefined;
  if (admin) {
    notificationQueries.create({
      userId: admin.id,
      actorId: user.id,
      type: 'comment',
      commentId,
      content: `[举报] ${reason}`,
    });
  }

  return json({ success: true });
};
