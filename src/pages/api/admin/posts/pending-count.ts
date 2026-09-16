import type { APIRoute } from 'astro';
import { postQueries } from '../../../../lib/db';

// GET /api/admin/posts/pending-count —— 待审核文章数量（仅管理员）
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: '无权限' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const count = (postQueries.countByStatus.get('pending') as { count: number }).count;
  return new Response(JSON.stringify({ count }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
