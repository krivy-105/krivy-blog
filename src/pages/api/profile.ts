import type { APIRoute } from 'astro';
import { userQueries } from '../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/profile —— 当前登录用户更新个人简介
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录' }, 401);

  const body = await request.json();
  const bio = ((body.bio as string) ?? '').trim();

  if (bio.length > 200) return json({ error: '简介最长 200 字' }, 400);

  userQueries.updateBio.run(bio || null, user.id);
  return json({ success: true, bio: bio || null });
};
