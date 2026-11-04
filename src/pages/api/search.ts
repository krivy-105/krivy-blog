import type { APIRoute } from 'astro';
import { sanitizeQuery, searchPosts } from '../../lib/search';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// GET /api/search?q=关键词 —— 即时搜索接口，最多返回 10 条
// 检索逻辑（FTS5 优先 + 中文子串兜底 + 摘要转义）统一在 src/lib/search.ts
export const GET: APIRoute = ({ url }) => {
  const safeQ = sanitizeQuery(url.searchParams.get('q') || '');
  if (!safeQ) return json([]);
  return json(searchPosts(safeQ, 10));
};
