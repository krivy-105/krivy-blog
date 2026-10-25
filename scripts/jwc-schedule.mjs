#!/usr/bin/env node
/**
 * 强智教务（湖南强智 jsxsd）课表抓取 + 推送
 *
 * 前置：先跑 scripts/jwc-login.mjs 登录，会生成 .jwc-session.json
 *
 * 用法：
 *   node scripts/jwc-schedule.mjs            只抓取并打印摘要（不推送）
 *   node scripts/jwc-schedule.mjs --push     抓取并推送到站点
 *
 * 解析依据（来自真实页面结构，不是猜的）：
 *   #timetable  周网格，行 = 大节（第一大节(01,02小节)…第六大节(11,12小节)），列 = 星期一…星期日
 *   每个单元格里有多门课，每门一个 div.kbcontent（含教师/周次/教室）
 *   周次格式是列表：3-5(周)  1,3-4,6-17(周)  4,6,8,10,12,14(周)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = process.env.JW_BASE || 'https://jw.gdpt.edu.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SESSION = '.jwc-session.json';
const SITE_URL = process.env.SITE_URL || 'https://krivy.cyou';
const TOKEN = process.env.SCHEDULE_TOKEN || '';

if (!existsSync(SESSION)) {
  console.error('❌ 找不到 .jwc-session.json，先跑：node scripts/jwc-login.mjs');
  process.exit(1);
}
const S = JSON.parse(readFileSync(SESSION, 'utf8'));

const BIDX = BASE + '/jsxsd/xskb/xskb_list.do';

// ---------- 抓 ----------
async function fetchHtml() {
  const res = await fetch(BIDX, {
    headers: { 'User-Agent': UA, Cookie: S.cookie, Referer: BASE + '/jsxsd/framework/xsMainV.jsp' },
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`cookie 已失效（跳转 ${res.headers.get('location')}），重新跑 scripts/jwc-login.mjs`);
  }
  const html = await res.text();
  if (!/id="timetable"/.test(html)) {
    throw new Error(`页面里没有 #timetable（${html.length} 字节），可能是登录态失效或接口变更`);
  }
  return html;
}

// ---------- 工具 ----------
const strip = (s) =>
  s.replace(/<br\s*\/?>/gi, '\n')
   .replace(/<[^>]+>/g, '')
   .replace(/&nbsp;/g, ' ')
   .replace(/&amp;/g, '&')
   .replace(/&lt;/g, '<')
   .replace(/&gt;/g, '>')
   .trim();

/** 从「第一大节 <br>(01,02小节)」解析出 [1,2] */
function sectionRange(label) {
  const m = label.match(/\((\d+)\s*,\s*(\d+)\s*小节\)/);
  if (m) return [Number(m[1]), Number(m[2])];
  const m2 = label.match(/[（(](\d+)[-—](\d+)[)）]?/);
  if (m2) return [Number(m2[1]), Number(m2[2])];
  return null;
}

/** 「3-5(周)[01-02节]」→「3-5」；「4,6,8,10,12,14(周)」→ 原样 */
function normWeeks(raw) {
  if (!raw) return null;
  const m = raw.match(/([\d,\-\s]+)\s*[（(]周[)）]/);
  const spec = (m ? m[1] : raw).replace(/\s/g, '').replace(/[^\d,\-]/g, '');
  return spec || null;
}

// ---------- 解析 ----------
function parse(html) {
  const ti = html.indexOf('id="timetable"');
  const start = html.lastIndexOf('<table', ti);
  const end = html.indexOf('</table>', ti);
  const table = html.slice(start, end + 8);

  const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
  const courses = [];
  let headerSeen = false;

  for (const row of rows) {
    const thMatch = row.match(/<th[^>]*>([\s\S]*?)<\/th>/);
    const thText = thMatch ? strip(thMatch[1]).replace(/\s+/g, ' ') : '';

    // 第一行是「星期一…星期日」表头
    if (/星期/.test(thText) || (!headerSeen && /^$/.test(thText))) {
      headerSeen = true;
      continue;
    }
    const range = sectionRange(thText);
    if (!range) continue;
    const [secStart, secEnd] = range;

    // 该行里所有 td，第 n 个（从 1 起）就是星期 n
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    tds.forEach((cell, i) => {
      const weekday = i + 1;
      if (weekday > 7) return;

      // 优先用带教师信息的完整块；没有再退回简版
      let blocks = [...cell.matchAll(/<div[^>]*class="kbcontent"[^>]*>([\s\S]*?)<\/div>/gi)].map((m) => m[1]);
      if (blocks.length === 0) {
        blocks = [...cell.matchAll(/<div[^>]*class="kbcontent1"[^>]*>([\s\S]*?)<\/div>/gi)].map((m) => m[1]);
      }
      for (const b of blocks) {
        const txt = b.replace(/\s+/g, ' ');
        if (/^(&nbsp;|\s)*$/.test(txt) || strip(b) === '') continue;

        // 课程名：第一个 <br> 之前
        const nameRaw = b.split(/<br\s*\/?>/i)[0];
        const course = strip(nameRaw).replace(/\s+/g, ' ');
        if (!course) continue;

        const teacher = strip((b.match(/<font[^>]*title=['"]教师['"][^>]*>([\s\S]*?)<\/font>/i) || [])[1] || '') || null;
        const weeksRaw = strip((b.match(/<font[^>]*title=['"]周次\(节次\)['"][^>]*>([\s\S]*?)<\/font>/i) || [])[1] || '');
        const location = strip((b.match(/<font[^>]*title=['"]教室['"][^>]*>([\s\S]*?)<\/font>/i) || [])[1] || '') || null;

        courses.push({
          course,
          teacher,
          location,
          weekday,
          start_section: secStart,
          end_section: secEnd,
          week_start: 1,
          week_end: 30,
          parity: 'all',
          weeks: normWeeks(weeksRaw),
        });
      }
    });
  }
  return courses;
}

// ---------- 去重 ----------
function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => {
    const k = [c.course, c.weekday, c.start_section, c.week_end, c.weeks, c.location, c.teacher].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- 主流程 ----------
const html = await fetchHtml();
writeFileSync('jwc-xskb.html', html);
console.log(`✅ 抓到课表页 ${html.length} 字节，已存 jwc-xskb.html`);

const raw = parse(html);
const courses = dedupe(raw);
console.log(`✅ 解析出 ${courses.length} 条课程记录（去重前 ${raw.length}）`);

// 摘要
const byDay = {};
for (const c of courses) (byDay[c.weekday] ||= []).push(c);
const DAYNAME = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
console.log('\n--- 按天 ---');
for (let d = 1; d <= 7; d++) {
  if (!byDay[d]) continue;
  console.log(`  ${DAYNAME[d]}: ${byDay[d].map((c) => `${c.course}(${c.start_section}-${c.end_section}节,${c.weeks || '?'}周)`).join('  ')}`);
}

const teachers = [...new Set(courses.map((c) => c.teacher).filter(Boolean))];
const locs = [...new Set(courses.map((c) => c.location).filter(Boolean))];
console.log(`\n教师 ${teachers.length} 位: ${teachers.join('、')}`);
console.log(`地点 ${locs.length} 个: ${locs.join('、')}`);
const noWeeks = courses.filter((c) => !c.weeks).length;
if (noWeeks) console.log(`⚠️ 有 ${noWeeks} 条没解析出周次`);

// ---------- 推送 ----------
if (process.argv.includes('--push')) {
  if (!TOKEN) {
    console.error('\n❌ 缺 SCHEDULE_TOKEN，无法推送');
    process.exit(1);
  }
  const payload = {
    term: process.env.JW_TERM || '',
    start_date: process.env.JW_START_DATE || '',
    total_weeks: Number(process.env.JW_TOTAL_WEEKS || 20),
    source: 'jwc-gdpt',
    // 教务系统只给节次编号（第1节…第12节），不给钟点。
    // 作息时间由这里提供：JW_SECTION_TIMES="08:00-08:45,08:55-09:40,…"
    // 下面这份是常见的高校作息，第一次推上去后按学校实际作息核对修改即可。
    // 教务系统只给节次编号，不给钟点。以下是广东职业技术学院的实际作息
    // （按【大节】给，每项覆盖 2 个小节），可用 JW_SECTION_TIMES 覆盖。
    section_times: (
      process.env.JW_SECTION_TIMES ||
      '08:30-10:10,10:20-12:00,14:00-15:40,15:50-17:30,18:30-20:05,20:15-21:50'
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split('-').map((x) => x.trim())),
    courses,
  };
  const res = await fetch(`${SITE_URL}/api/schedule/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-schedule-token': TOKEN },
    body: JSON.stringify(payload),
  });
  const out = await res.text();
  console.log(`\n推送结果 HTTP ${res.status}: ${out}`);
} else {
  console.log('\n（未推送。加 --push 参数才会推到站点）');
}
