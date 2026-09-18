import type { APIRoute } from 'astro';
import { reportQueries } from '../../../../lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });
  }
  const result = reportQueries.pendingCount.get('pending') as { count: number } | undefined;
  return new Response(JSON.stringify({ count: result?.count || 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
