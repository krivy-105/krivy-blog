import type { APIRoute } from 'astro';
import { scheduleQueries } from '../../../lib/db';

// ============================================================
// POST /api/schedule/import
// 由校内网的抓取脚本推送全量课表。
//
// 为什么用「推」而不是服务器去抓：
//   教务系统通常只允许校内网访问，服务器在公网根本连不上。
//
// 鉴权：请求头 x-schedule-token 必须等于环境变量 SCHEDULE_TOKEN；
//       管理员登录态也可以调用（方便手动补数据）。
//
// 请求体：
// {
//   "term": "2026-2027-1",
//   "start_date": "2026-09-07",     // 第 1 周的周一
//   "total_weeks": 20,
//   "courses": [
//     { "course":"高等数学", "teacher":"张三", "location":"A101",
//       "weekday":1, "start_section":1, "end_section":2,
//       "week_start":1, "week_end":16, "parity":"all", "note":"" }
//   ]
// }
// ============================================================

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  // ---- 鉴权 ----
  const expected = process.env.SCHEDULE_TOKEN || '';
  const got = request.headers.get('x-schedule-token') || '';
  const isAdmin = locals.user?.role === 'admin';

  const tokenOk = expected.length > 0 && got.length > 0 && got === expected;
  if (!tokenOk && !isAdmin) {
    return json({ error: 'unauthorized' }, 401);
  }

  // ---- 解析 ----
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const courses = Array.isArray(body?.courses) ? body.courses : null;
  if (!courses) return json({ error: 'courses 必须是数组' }, 400);

  // 校验每一条：缺关键字段的直接丢弃并计数，不整批失败
  const bad: number[] = [];
  const clean = courses.filter((c: any, i: number) => {
    const ok =
      c &&
      typeof c.course === 'string' &&
      c.course.trim() &&
      Number.isInteger(c.weekday) && c.weekday >= 1 && c.weekday <= 7 &&
      Number.isInteger(c.start_section) && c.start_section >= 1 &&
      Number.isInteger(c.end_section) && c.end_section >= c.start_section;
    if (!ok) bad.push(i);
    return ok;
  });

  // ---- 写入（整表替换）----
  const saved = scheduleQueries.replaceAll(clean);

  scheduleQueries.setMeta.run('term', String(body.term ?? ''));
  scheduleQueries.setMeta.run('start_date', String(body.start_date ?? ''));
  scheduleQueries.setMeta.run('total_weeks', String(Number(body.total_weeks) || 20));
  scheduleQueries.setMeta.run('source', String(body.source ?? 'script'));
  scheduleQueries.setMeta.run('synced_at', String(Date.now()));

  // 作息时间：[[开始,结束], …] 按节次顺序，第 n 项对应第 n 节。
  // 教室端不提供钟点，这份表由页面上展示、按学校实际情况配置。
  if (Array.isArray(body.section_times) && body.section_times.length > 0) {
    const cleaned = body.section_times
      .map((t: any) => {
        if (Array.isArray(t) && t.length === 2) return [String(t[0]), String(t[1])];
        if (typeof t === 'string' && t.includes('-')) {
          const [a, b] = t.split('-');
          return [a.trim(), b.trim()];
        }
        return null;
      })
      .filter(Boolean);
    if (cleaned.length > 0) {
      scheduleQueries.setMeta.run('section_times', JSON.stringify(cleaned));
    }
  }

  return json({
    ok: true,
    saved,
    rejected: bad.length,
    rejectedIndexes: bad.slice(0, 20),
  });
};

export const GET: APIRoute = () =>
  json({ error: '用 POST 推送数据' }, 405);
