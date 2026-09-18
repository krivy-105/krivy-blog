import type { APIRoute } from 'astro';
import { reportQueries } from '../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// GET /api/admin/reports —— 列出 pending 举报
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') return json({ error: '无权限' }, 403);
  const reports = reportQueries.pendingList.all();
  return json({ success: true, reports });
};
