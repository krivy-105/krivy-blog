import type { APIRoute } from 'astro';
import { messageQueries } from '../../../lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }

  const result = messageQueries.getUnreadCount.get(user.id) as any;
  return new Response(JSON.stringify({ count: result?.count || 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
