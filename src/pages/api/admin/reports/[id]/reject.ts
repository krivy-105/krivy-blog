import type { APIRoute } from 'astro';
import { reportQueries } from '../../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/admin/reports/:id/reject —— 举报不成立：仅标记驳回
export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') return json({ error: '无权限' }, 403);

  const id = Number(params.id);
  if (!Number.isFinite(id)) return json({ error: '举报记录不存在' }, 404);

  const report = reportQueries.findById.get(id) as { id: number; status: string } | undefined;
  if (!report) return json({ error: '举报记录不存在' }, 404);
  if (report.status !== 'pending') return json({ error: '该举报已处理' }, 400);

  reportQueries.resolve.run('rejected', user.id, Date.now(), id);
  return json({ success: true });
};
