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

  postQueries.updatePinned.run(null, Date.now(), id);
  return new Response(JSON.stringify({ success: true, pinned: false }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
