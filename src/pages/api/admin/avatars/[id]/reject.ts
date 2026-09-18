import type { APIRoute } from 'astro';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { userQueries, notificationQueries, AVATAR_DIR } from '../../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/admin/avatars/:id/reject —— 头像审核驳回：删除待审文件，保留旧头像，站内信告知用户
// body: { reason?: string }
export const POST: APIRoute = async ({ params, request, locals }) => {
  const admin = locals.user;
  if (!admin || admin.role !== 'admin') return json({ error: '无权限' }, 403);

  const userId = Number(params.id);
  if (!Number.isFinite(userId)) return json({ error: '用户不存在' }, 404);

  const target = userQueries.findById.get(userId) as
    | { id: number; avatar_status: string; avatar_pending: string | null }
    | undefined;
  if (!target) return json({ error: '用户不存在' }, 404);
  if (target.avatar_status !== 'pending' || !target.avatar_pending) {
    return json({ error: '该用户没有待审核的头像' }, 400);
  }

  let reason = '';
  try {
    const body = await request.json();
    reason = String(body?.reason ?? '').trim().slice(0, 200);
  } catch {}

  // 待审文件删除即可；正式头像文件不动，用户线上头像保持原样
  await rm(join(AVATAR_DIR, `${userId}.pending.webp`), { force: true });
  userQueries.rejectAvatar.run(userId);

  notificationQueries._add.run(
    userId,
    admin.id,
    'avatar_rejected',
    null,
    null,
    reason || null,
    Date.now()
  );

  return json({ success: true });
};
