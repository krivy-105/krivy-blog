import type { APIRoute } from 'astro';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { userQueries, notificationQueries, AVATAR_DIR } from '../../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/admin/avatars/:id/approve —— 头像审核通过：待审文件转正，全站即刻生效
export const POST: APIRoute = async ({ params, locals }) => {
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

  const now = Date.now();
  try {
    // 同目录 rename 是原子操作：待审文件直接替换正式文件
    await rename(
      join(AVATAR_DIR, `${userId}.pending.webp`),
      join(AVATAR_DIR, `${userId}.webp`)
    );
  } catch {
    return json({ error: '待审头像文件缺失，可能已被处理，请刷新页面' }, 400);
  }

  const avatar = `/avatars/${userId}?v=${now}`;
  userQueries.approveAvatar.run(avatar, userId);

  // 直接写通知（管理员审自己头像时也保留记录），不走去重 helper
  notificationQueries._add.run(
    userId,
    admin.id,
    'avatar_approved',
    null,
    null,
    null,
    now
  );

  return json({ success: true, avatar });
};
