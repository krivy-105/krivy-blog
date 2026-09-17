import type { APIRoute } from 'astro';
import { postQueries } from '../../../../../lib/db';

export const POST: APIRoute = async ({ params, locals, redirect }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return redirect('/');
  }

  const id = Number(params.id);
  if (!id) {
    return new Response(JSON.stringify({ error: '无效的文章 ID' }), { status: 400 });
  }

  const post = postQueries.findById.get(id) as { status: string } | undefined;
  if (!post) {
    return new Response(JSON.stringify({ error: '文章不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (post.status !== 'approved') {
    return new Response(JSON.stringify({ error: '仅可置顶已发布的文章' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  postQueries.updatePinned.run(Date.now(), Date.now(), id);
  return new Response(JSON.stringify({ success: true, pinned: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
