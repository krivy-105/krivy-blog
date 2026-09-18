import type { APIRoute } from 'astro';
import { postQueries, reportQueries, userQueries } from '../../../../lib/db';

// GET /api/admin/posts/pending-count —— 全站待处理事项数量（仅管理员）
// count 为待审核文章 + 待处理举报 + 待审核头像的总和，供 Header 角标统一展示
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: '无权限' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const posts = (postQueries.countByStatus.get('pending') as { count: number }).count;
  const reports = (reportQueries.pendingCount.get('pending') as { count: number }).count;
  const avatars = (userQueries.countPendingAvatars.get() as { count: number }).count;

  return new Response(JSON.stringify({ posts, reports, avatars, count: posts + reports + avatars }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
