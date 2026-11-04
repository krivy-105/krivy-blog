import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { join, normalize, relative, isAbsolute } from 'node:path';
import { AVATAR_DIR } from '../../lib/db';

// 目录归属判断不能用 startsWith（同名前缀的兄弟目录会绕过），用 relative
function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// GET /avatars/:id —— 读取用户头像
// 头像文件保存在数据持久卷（data/avatars/），不在 dist/client 静态目录里，
// 因此通过 SSR 路由动态读取（生产环境自定义 server.mjs 也会回退到该路由）。
export const GET: APIRoute = async ({ params, url }) => {
  const id = String(params.id || '');
  if (!/^\d+$/.test(id)) {
    return new Response('Not found', { status: 404 });
  }

  // ?kind=pending 读取待审核头像文件（审核通过后会替换为正式文件）
  const isPending = url.searchParams.get('kind') === 'pending';
  const filePath = normalize(join(AVATAR_DIR, `${id}${isPending ? '.pending' : ''}.webp`));
  if (!isInside(AVATAR_DIR, filePath)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const data = await readFile(filePath);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        // URL 带 ?v= 版本号，文件更新后版本号即变化，可永久缓存
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
