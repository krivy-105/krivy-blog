import type { APIRoute } from 'astro';
import { scheduleQueries, type ScheduleCourse } from '../../lib/db';

// GET /api/schedule —— 只读 JSON，方便自己写小程序/桌面小组件取数据
export const GET: APIRoute = () => {
  const courses = scheduleQueries.all.all() as ScheduleCourse[];
  const metaRows = scheduleQueries.allMeta.all() as { key: string; value: string }[];
  const meta: Record<string, string> = {};
  for (const r of metaRows) meta[r.key] = r.value;

  return new Response(
    JSON.stringify({
      term: meta.term || '',
      start_date: meta.start_date || '',
      total_weeks: Number(meta.total_weeks || 20),
      synced_at: Number(meta.synced_at || 0),
      count: courses.length,
      courses,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // 课表变动不频繁，允许边缘缓存 5 分钟
        'Cache-Control': 'public, max-age=60, s-maxage=300',
      },
    }
  );
};
