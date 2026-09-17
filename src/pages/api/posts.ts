import type { APIRoute } from 'astro';
import { postQueries, tagQueries } from '../../lib/db';

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

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) {
    return redirect('/login');
  }

  let title: string | undefined;
  let description = '';
  let content: string | undefined;
  let tagsRaw: string | null = null;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json();
    title = (body.title as string)?.trim();
    description = (body.description as string)?.trim() || '';
    content = (body.content as string)?.trim();
    tagsRaw = (body.tags as string) || null;
  } else {
    const formData = await request.formData();
    title = (formData.get('title') as string)?.trim();
    description = (formData.get('description') as string)?.trim() || '';
    content = (formData.get('content') as string)?.trim();
    tagsRaw = (formData.get('tags') as string) || null;
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

  try {
    const result = postQueries.create.run(
      user.id,
      slug,
      title,
      description,
      content,
      'pending',
      now,
      now
    );
    if (tagList.length) {
      tagQueries.setForPost(Number(result.lastInsertRowid), tagList);
    }
    return new Response(JSON.stringify({ success: true, id: result.lastInsertRowid, message: '文章已提交，等待审核' }), {
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
