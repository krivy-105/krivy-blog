import type { APIRoute } from 'astro';
import { linkQueries } from '../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/admin/links —— 新增友链（仅 admin）
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.user || locals.user.role !== 'admin') return redirect('/');

  let name: string | undefined;
  let url: string | undefined;
  let description = '';
  let sort = 0;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json();
    name = (body.name as string)?.trim();
    url = (body.url as string)?.trim();
    description = (body.description as string)?.trim() || '';
    sort = Number(body.sort) || 0;
  } else {
    const formData = await request.formData();
    name = (formData.get('name') as string)?.trim();
    url = (formData.get('url') as string)?.trim();
    description = (formData.get('description') as string)?.trim() || '';
    const s = formData.get('sort');
    sort = s ? Number(s) || 0 : 0;
  }

  if (!name) return json({ error: '名称不能为空' }, 400);
  if (!url || !/^https?:\/\//i.test(url)) {
    return json({ error: 'URL 必须以 http:// 或 https:// 开头' }, 400);
  }

  try {
    linkQueries.create.run(name, url, description, sort, Date.now());
    return json({ success: true, message: '已新增友链' });
  } catch {
    return json({ error: '新增失败，请重试' }, 500);
  }
};

// DELETE /api/admin/links —— 删除友链（仅 admin，body { id })
export const DELETE: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.user || locals.user.role !== 'admin') return redirect('/');

  let id: number | undefined;
  try {
    const body = await request.json();
    id = Number(body.id);
  } catch {
    return json({ error: '请求无效' }, 400);
  }
  if (!Number.isFinite(id)) return json({ error: 'id 无效' }, 400);

  linkQueries.remove.run(id);
  return json({ success: true });
};
