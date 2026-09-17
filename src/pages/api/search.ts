import type { APIRoute } from 'astro';
import { searchQueries } from '../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// GET /api/search?q=关键词 —— 即时搜索接口，最多返回 10 条
export const GET: APIRoute = ({ url }) => {
  const rawQ = (url.searchParams.get('q') || '').trim();
  if (!rawQ) return json([]);

  // 清洗 FTS5 运算符，仅保留普通文本
  const safeQ = rawQ.replace(/["'*:()\-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safeQ) return json([]);

  try {
    const rows = (searchQueries.search.all(safeQ + '*') as any[]).slice(0, 10).map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description || '',
      author_name: r.author_name,
      created_at: r.created_at,
      preview: r.preview || '',
    }));
    return json(rows);
  } catch {
    return json([]);
  }
};
