import type { APIRoute } from 'astro';
import { notificationQueries } from '../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// GET /api/notifications —— 当前用户的通知列表（前 100 条，未读优先）
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录' }, 401);

  const notifications = notificationQueries.listByUser.all(user.id);
  const unread = (notificationQueries.unreadCount.get(user.id) as { count: number }).count;
  return json({ success: true, notifications, unread });
};

// POST /api/notifications —— 全部标记为已读
export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录' }, 401);

  notificationQueries.markAllRead.run(Date.now(), user.id);
  return json({ success: true });
};
