import type { APIRoute } from 'astro';
import { userQueries } from '../../lib/db';
import { hashPassword, createSession, COOKIE_NAME, SESSION_DURATION } from '../../lib/auth';
import { bumpRateLimit, getClientIp } from '../../lib/rate-limit';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  // 限流：同一 IP 每小时最多 5 次注册，防止批量灌水
  const ip = getClientIp(request.headers);
  const limit = bumpRateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
  if (!limit.ok) {
    return new Response(
      JSON.stringify({ error: '注册过于频繁，请一小时后再试' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(limit.retryAfterSec),
        },
      }
    );
  }

  const formData = await request.formData();
  const username = (formData.get('username') as string)?.trim();
  const email = (formData.get('email') as string)?.trim();
  const password = formData.get('password') as string;

  if (!username || !email || !password) {
    return new Response(JSON.stringify({ error: '请填写用户名、邮箱和密码' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 服务端校验（前端 required/type=email 只是体验，随手 POST 就能绕过）。
  // 用户名会直接进 URL（/users/xxx）与 @提及，必须限定字符集，否则会出现
  // 空格、控制字符、甚至带路径语义的用户名。
  if (username.length < 2 || username.length > 20) {
    return new Response(JSON.stringify({ error: '用户名长度需在 2-20 个字符之间' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!/^[\w\u4e00-\u9fa5-]+$/.test(username)) {
    return new Response(JSON.stringify({ error: '用户名只能用中英文、数字、下划线和短横线' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
    return new Response(JSON.stringify({ error: '邮箱格式不正确' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (password.length < 6) {
    return new Response(JSON.stringify({ error: '密码至少 6 位' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // bcrypt 只取前 72 字节，超长密码会被静默截断（两个不同长密码可能等价）
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return new Response(JSON.stringify({ error: '密码过长，请控制在 72 字节以内' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 检查用户名是否已存在
  const existingUser = userQueries.findByUsernameOrEmail.get(username, email);
  if (existingUser) {
    return new Response(JSON.stringify({ error: '用户名或邮箱已被注册' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const hashedPassword = await hashPassword(password);
  const result = userQueries.create.run(username, email, hashedPassword, 'user', Date.now());
  const userId = result.lastInsertRowid as number;

  // 自动登录
  const token = createSession(userId);
  cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DURATION / 1000,
  });

  return redirect('/');
};
