import type { APIRoute } from 'astro';
import { postQueries, tagQueries, seriesQueries } from '../../lib/db';

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  const ts = Date.now().toString(36);
  return `${base}-${ts}`;
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function readStr(v: FormDataEntryValue | string | null | undefined): string | null {
  if (v == null) return null;
  const s = typeof v === 'string' ? v : String(v);
  return s;
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) {
    return redirect('/login');
  }

  let title: string | undefined;
  let description = '';
  let content: string | undefined;
  let tagsRaw: string | null = null;
  let seriesSel: string | null = null;
  let seriesOrderRaw: string | null = null;
  let seriesNewTitle: string | null = null;
  let seriesNewDesc: string | null = null;
  let publishAtRaw: string | null = null;

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
    publishAtRaw = body.publish_at ?? null;
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
    publishAtRaw = readStr(formData.get('publish_at'));
  }

  if (!title || !content) {
    return new Response(JSON.stringify({ error: '标题和正文不能为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const slug = slugify(title);
  const now = Date.now();
  const tagList = parseTags(tagsRaw);

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

  try {
    // 定时发布：填写了未来时间则直接 scheduled，到点由调度器转 approved
    const publishAt = parseFutureTime(publishAtRaw);
    if (publishAtRaw && publishAtRaw.trim() && publishAt === null) {
      return new Response(JSON.stringify({ error: '定时时间无效，必须是未来的时间' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let result;
    if (publishAt) {
      result = postQueries.createScheduled.run(
        user.id, slug, title, description, content, 'scheduled', now, now, publishAt
      );
    } else {
      result = postQueries.create.run(
        user.id, slug, title, description, content, 'pending', now, now
      );
    }
    const postId = Number(result.lastInsertRowid);
    if (tagList.length) {
      tagQueries.setForPost(postId, tagList);
    }
    if (seriesId != null) {
      seriesQueries.setForPost(postId, seriesId, seriesOrder);
    }
    const message = publishAt
      ? `已设定定时发布：${new Date(publishAt).toLocaleString('zh-CN')}`
      : '文章已提交，等待审核';
    return new Response(JSON.stringify({ success: true, id: result.lastInsertRowid, message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: '提交失败，请重试' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// 解析 datetime-local 输入；返回未来时间戳，空串返回 undefined，无效/过去时间返回 null
function parseFutureTime(raw: string | null | undefined): number | null | undefined {
  if (!raw || !raw.trim()) return undefined;
  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts)) return null;
  return ts > Date.now() ? ts : null;
}
