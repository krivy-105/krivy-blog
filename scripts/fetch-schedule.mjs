#!/usr/bin/env node
/**
 * 课表同步脚本 —— 在【校内网的电脑】上运行
 *
 * 两种用法：
 *
 *   ① 手动推送（现在就能用）
 *      准备好一个 schedule.json，然后：
 *        node scripts/fetch-schedule.mjs --push schedule.json
 *
 *   ② 自动抓教务系统（需要先填 §2 里的学校参数）
 *        node scripts/fetch-schedule.mjs --fetch
 *
 * 环境变量（也可以写进 .env.local）：
 *   SITE_URL        默认 https://krivy.cyou
 *   SCHEDULE_TOKEN  与服务器上 .env 里的一致
 *
 * JSON 格式：
 * {
 *   "term": "2026-2027-1",
 *   "start_date": "2026-09-07",     // 第 1 周的周一
 *   "total_weeks": 20,
 *   "courses": [
 *     { "course":"高等数学", "teacher":"张三", "location":"A101",
 *       "weekday":1, "start_section":1, "end_section":2,
 *       "week_start":1, "week_end":16, "parity":"all" }
 *   ]
 * }
 */

import { readFileSync, existsSync } from 'node:fs';

const SITE_URL = process.env.SITE_URL || 'https://krivy.cyou';
const TOKEN = process.env.SCHEDULE_TOKEN || '';

// ============================================================
// §1 推送
// ============================================================
async function push(payload) {
  if (!TOKEN) {
    throw new Error('缺少 SCHEDULE_TOKEN 环境变量（与服务器 .env 里的一致）');
  }
  const res = await fetch(`${SITE_URL}/api/schedule/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-schedule-token': TOKEN,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`推送失败 HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ============================================================
// §2 抓教务系统（需要按你学校的情况填）
// ------------------------------------------------------------
// 国内高校主流三套，登录接口不同，这里给的是最常见的「正方教务」骨架。
// 你只要把 SCHOOL 里的几项换成自己的，再按实际返回结构调整 parse()。
//
// 关键信息需要你提供：
//   1) 教务系统登录页地址
//   2) 登录表单的字段名（浏览器 F12 → Network → 看 login 请求的 Form Data）
//   3) 课表页面地址（登录后点开课表，看地址栏）
//   4) 有没有验证码
// ============================================================
const SCHOOL = {
  loginUrl: process.env.JW_LOGIN_URL || '',      // 例：https://jw.xxx.edu.cn/jwglxt/xtgl/login_slogin.html
  scheduleUrl: process.env.JW_SCHEDULE_URL || '',// 例：https://jw.xxx.edu.cn/jwglxt/kbcx/xskbcx_cxXsKb.html
  username: process.env.JW_USER || '',
  password: process.env.JW_PASS || '',
  // 正方常见的字段名，你们学校可能不同
  userField: process.env.JW_USER_FIELD || 'yhm',
  passField: process.env.JW_PASS_FIELD || 'mm',
};

async function fetchSchedule() {
  if (!SCHOOL.loginUrl || !SCHOOL.scheduleUrl) {
    throw new Error(
      '还没配置教务系统地址。请提供：登录页 URL、课表页 URL、账号密码、以及登录表单的字段名。'
    );
  }

  // ---- 登录 ----
  const body = new URLSearchParams();
  body.set(SCHOOL.userField, SCHOOL.username);
  body.set(SCHOOL.passField, SCHOOL.password);

  const loginRes = await fetch(SCHOOL.loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });
  const cookie = loginRes.headers.getSetCookie?.().map((c) => c.split(';')[0]).join('; ') || '';

  // ---- 取课表 ----
  const schedRes = await fetch(SCHOOL.scheduleUrl, {
    headers: { Cookie: cookie },
  });
  const html = await schedRes.text();

  // ---- 解析 ----
  // TODO(需按你学校实际结构填)：下面是正方教务典型的表格结构思路，
  // 真正跑之前要先 print 出来看一遍 HTML。
  const courses = parseHtmlSchedule(html);
  if (courses.length === 0) {
    throw new Error('解析出 0 门课 —— 把返回的 HTML 存下来发我，我照着改解析规则');
  }
  return {
    term: '',            // 从页面里取，或手动填
    start_date: '',      // 教学周第一天，最重要的一项
    total_weeks: 20,
    courses,
  };
}

/** 占位：正方课表的解析。等拿到真实 HTML 再实现。 */
function parseHtmlSchedule(_html) {
  return [];
}

// ============================================================
// §3 入口
// ============================================================
const args = process.argv.slice(2);
const mode = args[0] || '--help';

try {
  if (mode === '--push') {
    const file = args[1];
    if (!file || !existsSync(file)) throw new Error(`找不到文件：${file}`);
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    console.log(`推送 ${payload.courses?.length ?? 0} 门课到 ${SITE_URL} …`);
    const out = await push(payload);
    console.log('✅ 成功：', out);
  } else if (mode === '--fetch') {
    console.log('抓取教务系统 …');
    const payload = await fetchSchedule();
    const out = await push(payload);
    console.log('✅ 成功：', out);
  } else {
    console.log(`用法：
  node scripts/fetch-schedule.mjs --push <schedule.json>   手动推送
  node scripts/fetch-schedule.mjs --fetch                  自动抓取（需先配置 §2）`);
  }
} catch (err) {
  console.error('❌', err.message);
  process.exit(1);
}
