import type { APIRoute } from 'astro';
import { userQueries } from '../../lib/db';
import { hashPassword, createSession, COOKIE_NAME, SESSION_DURATION } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
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

  if (password.length < 6) {
    return new Response(JSON.stringify({ error: '密码至少 6 位' }), {
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
