import type { APIRoute } from 'astro';
import { userQueries } from '../../lib/db';
import { verifyPassword, createSession, COOKIE_NAME, SESSION_DURATION } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const formData = await request.formData();
  const identifier = (formData.get('identifier') as string)?.trim();
  const password = formData.get('password') as string;

  if (!identifier || !password) {
    return new Response(JSON.stringify({ error: '请填写账号和密码' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = userQueries.findByUsernameOrEmail.get(identifier, identifier);
  if (!user) {
    return new Response(JSON.stringify({ error: '账号不存在' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    return new Response(JSON.stringify({ error: '密码错误' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = createSession(user.id);
  cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DURATION / 1000,
  });

  return new Response(JSON.stringify({ success: true, redirect: '/' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
