import type { APIRoute } from 'astro';
import { guestbookQueries } from '../../lib/db';
import { bumpRateLimit, getClientIp } from '../../lib/rate-limit';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const MAX_LEN = 500;

// POST /api/guestbook { content } —— 登录用户留言
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录' }, 401);

  const ip = getClientIp(request.headers);
  if (bumpRateLimit(`guestbook:${ip}`, 10, 10 * 60 * 1000).ok === false) {
    return json({ error: '操作太频繁，请稍后再试' }, 429);
  }

  let content = '';
  try {
    const body = await request.json();
    content = (body.content as string) ?? '';
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  content = content.trim();
  if (!content) return json({ error: '留言内容不能为空' }, 400);
  if (content.length > MAX_LEN) return json({ error: `留言最长 ${MAX_LEN} 字` }, 400);

  try {
    const result = guestbookQueries.create.run(user.id, content, Date.now());
    return json({ success: true, id: Number(result.lastInsertRowid) });
  } catch {
    return json({ error: '留言失败，请重试' }, 500);
  }
};
