import type { APIRoute } from 'astro';
import { messageQueries, userQueries } from '../../lib/db';

// GET /api/messages?with=userId - 获取与某用户的对话历史
export const GET: APIRoute = async ({ url, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }

  const withId = Number(url.searchParams.get('with'));
  if (!withId) {
    return new Response(JSON.stringify({ error: '缺少 with 参数' }), { status: 400 });
  }

  const messages = messageQueries.getConversation.all(user.id, withId, withId, user.id) as any[];
  // 标记已读
  messageQueries.markAsRead.run(withId, user.id);

  return new Response(JSON.stringify(messages), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /api/messages - 发送消息
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }

  const body = await request.json();
  const receiverId = Number(body.receiverId);
  const content = (body.content as string)?.trim();

  if (!receiverId || !content) {
    return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400 });
  }

  const receiver = userQueries.findById.get(receiverId);
  if (!receiver) {
    return new Response(JSON.stringify({ error: '接收方不存在' }), { status: 404 });
  }

  const now = Date.now();
  const result = messageQueries.create.run(user.id, receiverId, content, now);
  const message = {
    id: result.lastInsertRowid,
    sender_id: user.id,
    receiver_id: receiverId,
    content,
    is_read: 0,
    created_at: now,
  };

  return new Response(JSON.stringify(message), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
