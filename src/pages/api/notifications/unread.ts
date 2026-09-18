import type { APIRoute } from 'astro';
import { notificationQueries } from '../../../lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }

  const result = notificationQueries.unreadCount.get(user.id) as { count: number } | undefined;
  return new Response(JSON.stringify({ count: result?.count || 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
