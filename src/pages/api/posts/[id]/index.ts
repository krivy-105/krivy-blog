import type { APIRoute } from 'astro';
import { postQueries, tagQueries, seriesQueries } from '../../../../lib/db';

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function ensureId(idParam: string | undefined): number | null {
  const n = Number(idParam);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readStr(v: FormDataEntryValue | string | null | undefined): string | null {
  if (v == null) return null;
  const s = typeof v === 'string' ? v : String(v);
  return s;
}

export const PUT: APIRoute = async ({ request, locals, params, redirect }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const id = ensureId(params.id);
  if (!id) {
    return new Response(JSON.stringify({ error: '无效的文章 ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const post = postQueries.findById.get(id) as { author_id: number; status: string } | undefined;
  if (!post) {
    return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (post.author_id !== user.id) {
    return new Response(JSON.stringify({ error: '无权限编辑此文章' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let title: string | undefined;
  let description = '';
  let content: string | undefined;
  let tagsRaw: string | null = null;
  let seriesSel: string | null = null;
  let seriesOrderRaw: string | null = null;
  let seriesNewTitle: string | null = null;
  let seriesNewDesc: string | null = null;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json();
    title = (body.title as string)?.trim();
    description = (body.description as string)?.trim() || '';
    content = (body.content as string)?.trim();
    tagsRaw = (body.tags as string) || null;
    seriesSel = body.series_id ?? null;
    seriesOrderRaw = body.series_order ?? null;
    seriesNewTitle = body.series_new_title ?? null;
    seriesNewDesc = body.series_new_desc ?? null;
  } else {
    const formData = await request.formData();
    title = (formData.get('title') as string)?.trim();
    description = (formData.get('description') as string)?.trim() || '';
    content = (formData.get('content') as string)?.trim();
    tagsRaw = (formData.get('tags') as string) || null;
    seriesSel = readStr(formData.get('series_id'));
    seriesOrderRaw = readStr(formData.get('series_order'));
    seriesNewTitle = readStr(formData.get('series_new_title'));
    seriesNewDesc = readStr(formData.get('series_new_desc'));
  }

  if (!title || !content) {
    return new Response(JSON.stringify({ error: '标题和正文不能为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let seriesId: number | null = null;
  const rawSelId = seriesSel && seriesSel !== '__new__' ? Number(seriesSel) : null;
  const seriesRes = seriesQueries.ensureByAuthor(user.id, {
    id: Number.isFinite(rawSelId as number) ? (rawSelId as number) : null,
    newTitle: seriesSel === '__new__' ? seriesNewTitle || '' : '',
    newDesc: seriesSel === '__new__' ? seriesNewDesc || '' : '',
  });
  if (seriesRes.error) {
    return new Response(JSON.stringify({ error: seriesRes.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  seriesId = seriesRes.id;
  if (seriesSel === '__new__' && !seriesId) {
    return new Response(JSON.stringify({ error: '新建系列时请填写系列名称' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const seriesOrder = seriesOrderRaw && seriesOrderRaw.trim() ? Number(seriesOrderRaw) : null;

  const now = Date.now();
  const tagList = parseTags(tagsRaw);

  try {
    const result = postQueries.update.run(title, description, content, now, id, user.id);
    if (result.changes === 0) {
      return new Response(JSON.stringify({ error: '更新失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    tagQueries.setForPost(id, tagList);
    seriesQueries.setForPost(id, seriesId, seriesOrder);
    return new Response(JSON.stringify({ success: true, message: '文章已更新，请耐心等待审核' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: '更新失败，请重试' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const id = ensureId(params.id);
  if (!id) {
    return new Response(JSON.stringify({ error: '无效的文章 ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const post = postQueries.findById.get(id) as { author_id: number } | undefined;
  if (!post) {
    return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (post.author_id !== user.id) {
    return new Response(JSON.stringify({ error: '无权限删除此文章' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const now = Date.now();
    const result = postQueries.softDelete.run(now, now, id, user.id);
    if (result.changes === 0) {
      return new Response(JSON.stringify({ error: '删除失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: true, message: '文章已删除' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: '删除失败，请重试' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
