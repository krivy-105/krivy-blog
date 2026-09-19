import type { APIRoute } from 'astro';
import { userQueries } from '../../lib/db';
import { verifyPassword, createSession, COOKIE_NAME, SESSION_DURATION } from '../../lib/auth';
import { isLimited, bumpRateLimit, resetRateLimit, getClientIp } from '../../lib/rate-limit';

const FAIL_WINDOW_MS = 15 * 60 * 1000;

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

  // 限流（只统计失败尝试，成功登录不受影响）：
  // 同一 IP+账号 15 分钟内错 5 次密码 -> 锁定；同一 IP 15 分钟内累计错 30 次
  // （防换账号绕过）-> 锁定
  const ip = getClientIp(request.headers);
  const ipKey = `login-ip-fail:${ip}`;
  const failKey = `login-fail:${ip}:${identifier}`;
  if (isLimited(ipKey, 30) || isLimited(failKey, 5)) {
    return tooMany();
  }

  const user = userQueries.findByUsernameOrEmail.get(identifier, identifier);
  if (!user) {
    bumpRateLimit(ipKey, 30, FAIL_WINDOW_MS);
    bumpRateLimit(failKey, 5, FAIL_WINDOW_MS);
    return new Response(JSON.stringify({ error: '账号不存在' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    bumpRateLimit(ipKey, 30, FAIL_WINDOW_MS);
    bumpRateLimit(failKey, 5, FAIL_WINDOW_MS);
    return new Response(JSON.stringify({ error: '密码错误' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 登录成功，清除该账号的失败计数
  resetRateLimit(failKey);

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

function tooMany(): Response {
  return new Response(JSON.stringify({ error: '尝试次数过多，请 15 分钟后再试' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '900' },
  });
}
