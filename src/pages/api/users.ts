import type { APIRoute } from 'astro';
import { userQueries, type UserListRow } from '../../lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }

  const users = userQueries.list.all() as UserListRow[];
  // 排除自己
  const filtered = users.filter((u) => u.id !== user.id);
  return new Response(JSON.stringify(filtered), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
