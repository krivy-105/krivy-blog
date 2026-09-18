import type { APIRoute } from 'astro';
import { reportQueries, commentQueries } from '../../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/admin/reports/:id/approve —— 举报成立：隐藏评论 + 标记举报处理
export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') return json({ error: '无权限' }, 403);

  const id = Number(params.id);
  if (!Number.isFinite(id)) return json({ error: '举报记录不存在' }, 404);

  const report = reportQueries.findById.get(id) as { id: number; comment_id: number; status: string } | undefined;
  if (!report) return json({ error: '举报记录不存在' }, 404);
  if (report.status !== 'pending') return json({ error: '该举报已处理' }, 400);

  const now = Date.now();
  reportQueries.resolve.run('approved', user.id, now, id);
  // 隐藏评论（hide）而非软删（softDelete），保留评论本体以便追溯
  commentQueries.hide.run(now, report.comment_id);

  return json({ success: true });
};
