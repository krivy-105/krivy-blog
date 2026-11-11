import type { APIRoute } from 'astro';
import { userQueries, type UserListRow } from '../../lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }

  // 只投影公开字段：email 是隐私数据，created_at 无任何前端消费方
  const users = (userQueries.list.all() as UserListRow[])
    .filter((u) => u.id !== user.id)
    .map((u) => ({ id: u.id, username: u.username, avatar: u.avatar, role: u.role }));

  return new Response(JSON.stringify(users), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
