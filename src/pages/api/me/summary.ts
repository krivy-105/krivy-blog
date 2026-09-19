import type { APIRoute } from 'astro';
import {
  messageQueries,
  notificationQueries,
  postQueries,
  reportQueries,
  userQueries,
} from '../../../lib/db';

// GET /api/me/summary —— Header 角标聚合接口
// 单次请求返回未读消息/通知 +（管理员）待办数，替代原来的三个独立轮询端点
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }

  const messages =
    (messageQueries.getUnreadCount.get(user.id) as { count: number })?.count || 0;
  const notifications =
    (notificationQueries.unreadCount.get(user.id) as { count: number } | undefined)?.count || 0;

  let pending = 0;
  if (user.role === 'admin') {
    const posts = (postQueries.countByStatus.get('pending') as { count: number }).count;
    const reports = (reportQueries.pendingCount.get('pending') as { count: number }).count;
    const avatars = (userQueries.countPendingAvatars.get() as { count: number }).count;
    pending = posts + reports + avatars;
  }

  return new Response(JSON.stringify({ messages, notifications, pending }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
