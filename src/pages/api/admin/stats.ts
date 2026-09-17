import type { APIRoute } from 'astro';
import { statQueries } from '../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// GET /api/admin/stats —— 最近 30 天 PV/UV 统计，仅 admin
export const GET: APIRoute = ({ locals, redirect }) => {
  if (!locals.user || locals.user.role !== 'admin') return redirect('/');
  return json({
    rows: statQueries.last30.all(),
    today: statQueries.today.get(),
  });
};
