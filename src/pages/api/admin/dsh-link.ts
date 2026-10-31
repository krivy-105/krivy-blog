import type { APIRoute } from 'astro';
import { setDshLink, ensurePushKey, verifyPushKey } from '../../../lib/dsh-link';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/admin/dsh-link
// 电脑端开机自启脚本推送最新 DSH 访问链接。鉴权：header x-dsh-key == 配对密钥，
// 或调用者本身是登录的 admin（走 session cookie）。
export const POST: APIRoute = async ({ request, locals }) => {
  const adminSession = locals.user?.role === 'admin';
  const keyOk = verifyPushKey(request.headers.get('x-dsh-key'));
  if (!adminSession && !keyOk) return json({ error: 'unauthorized' }, 401);

  let url = '';
  try {
    const body = await request.json();
    url = String(body.url ?? '');
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  // 只接受 http(s) 链接，长度兜底，防脏数据
  if (!/^https?:\/\/[^\s]{1,500}$/.test(url)) {
    return json({ error: 'invalid url' }, 400);
  }

  setDshLink(url);
  return json({ success: true });
};

// GET /api/admin/dsh-link —— 仅 admin session：查当前存的链接与配对密钥
export const GET: APIRoute = async ({ locals }) => {
  if (locals.user?.role !== 'admin') return json({ error: 'unauthorized' }, 401);
  return json({ key: ensurePushKey() });
};
