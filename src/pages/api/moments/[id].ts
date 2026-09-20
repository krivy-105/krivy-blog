import type { APIRoute } from 'astro';
import { momentQueries } from '../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// DELETE /api/moments/:id —— 作者本人或管理员删除
export const DELETE: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: '未登录' }, 401);

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return json({ error: '无效 ID' }, 400);

  const row = momentQueries.findById.get(id) as { user_id: number } | undefined;
  if (!row) return json({ error: '动态不存在' }, 404);
  if (row.user_id !== user.id && user.role !== 'admin') {
    return json({ error: '无权限删除此动态' }, 403);
  }

  momentQueries.softDelete.run(Date.now(), id);
  return json({ success: true });
};
