#!/usr/bin/env node
/**
 * 强智教务系统登录（湖南强智 QZDatasoft / jsxsd）
 *
 * 登录机制（从学校页面 JS 里扒出来的，不是猜的）：
 *   1. GET  /jsxsd/                      拿 JSESSIONID
 *   2. GET  /jsxsd/verifycode.servlet    拿验证码图片（同一 session）
 *   3. encoded = base64(账号) + "%%%" + base64(密码)
 *   4. POST /jsxsd/xk/LoginToXk
 *         userAccount, userPassword(空), RANDOMCODE, encoded, loginMethod=LoginToXk
 *
 * 用法：
 *   node scripts/jwc-login.mjs              第一次：拉验证码存成 captcha.jpg
 *   node scripts/jwc-login.mjs <验证码>      第二次：带验证码完成登录并保存 cookie
 *
 * 成功后 cookie 存到 .jwc-session.json，之后 jwc-schedule.mjs 直接复用。
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const BASE = process.env.JW_BASE || 'https://jw.gdpt.edu.cn';
const USER = process.env.JW_USER || '';
const PASS = process.env.JW_PASS || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const STATE = '.jwc-state.json';   // 登录过程中的 session + 验证码
const SESSION = '.jwc-session.json'; // 登录成功后的 cookie

// 强智的 encodeInp 就是标准 base64（UTF-8 输入）
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/** 从 Set-Cookie 里收集 name=value */
function collectCookies(res, jar) {
  const raw = res.headers.getSetCookie?.() || [];
  for (const c of raw) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}
const cookieHeader = (jar) =>
  Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function step1() {
  if (!USER || !PASS) throw new Error('缺少 JW_USER / JW_PASS 环境变量');

  // 1) 拿 session
  const loginPage = await fetch(`${BASE}/jsxsd/`, {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  const jar = collectCookies(loginPage, {});
  await loginPage.text();

  // 2) 拿验证码（必须带同一个 session，否则校验不过）
  const cap = await fetch(`${BASE}/jsxsd/verifycode.servlet?t=${Date.now()}`, {
    headers: { 'User-Agent': UA, Cookie: cookieHeader(jar) },
  });
  collectCookies(cap, jar);
  const buf = Buffer.from(await cap.arrayBuffer());
  const ext = (cap.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
  const file = `captcha.${ext}`;
  writeFileSync(file, buf);

  writeFileSync(STATE, JSON.stringify({ jar, captchaFile: file, at: Date.now() }, null, 2));

  console.log(`✅ 验证码已保存：${file}（${buf.length} 字节）`);
  console.log(`   session: ${cookieHeader(jar)}`);
  console.log('');
  console.log('下一步：看图识别 4 位验证码，然后运行');
  console.log('  node scripts/jwc-login.mjs <验证码>');
}

async function step2(code) {
  if (!existsSync(STATE)) throw new Error('先跑一次不带参数的：node scripts/jwc-login.mjs');
  const { jar } = JSON.parse(readFileSync(STATE, 'utf8'));

  if (!USER || !PASS) throw new Error('缺少 JW_USER / JW_PASS 环境变量');

  const encoded = `${b64(USER)}%%%${b64(PASS)}`;
  const body = new URLSearchParams({
    loginMethod: 'LoginToXk',
    userAccount: USER,
    userPassword: '',
    RANDOMCODE: code,
    encoded,
  });

  const res = await fetch(`${BASE}/jsxsd/xk/LoginToXk`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar),
      Referer: `${BASE}/jsxsd/`,
    },
    body,
    redirect: 'manual',
  });
  collectCookies(res, jar);
  const text = await res.text();

  // 强智登录失败会回登录页并带提示；成功一般是 302 跳 /jsxsd/framework/xsMain.jsp
  const location = res.headers.get('location') || '';
  const looksOk = res.status === 302 && !/LoginToXk|login/i.test(location) || /xsMain/.test(location);

  // 用「能否进主框架」做最终判定，比看返回码可靠
  const probe = await fetch(`${BASE}/jsxsd/framework/xsMain.jsp`, {
    headers: { 'User-Agent': UA, Cookie: cookieHeader(jar) },
    redirect: 'manual',
  });
  collectCookies(probe, jar);
  const probeLoc = probe.headers.get('location') || '';
  const loggedIn = probe.status === 200 && !/login/i.test(probeLoc);

  if (!loggedIn) {
    console.log(`❌ 登录失败（HTTP ${res.status} → ${location}）`);
    if (/验证码|yzm|RANDOMCODE/i.test(text)) console.log('   可能是验证码错误，重新跑不带参数的再试');
    else console.log('   可能是账号密码错误，或需要重新获取验证码');
    process.exit(1);
  }

  writeFileSync(
    SESSION,
    JSON.stringify({ jar, cookie: cookieHeader(jar), at: Date.now(), user: USER }, null, 2)
  );
  console.log('✅ 登录成功，cookie 已保存到 .jwc-session.json');
  console.log(`   跳转: ${location || '(直接 200)'}`);
}

const code = process.argv[2];
try {
  if (code) await step2(code);
  else await step1();
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
