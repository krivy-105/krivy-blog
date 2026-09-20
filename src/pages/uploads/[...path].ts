import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { UPLOAD_DIR } from '../../lib/db';

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

// GET /uploads/images/xxx.webp、/uploads/moments/xxx.webp
// 用户上传文件存在数据持久卷的 data/uploads/ 下，经 SSR 路由读取
export const GET: APIRoute = async ({ params }) => {
  const raw = params.path || '';
  // 防目录穿越：归一化后必须仍位于 UPLOAD_DIR 内，且只允许单层子目录
  const filePath = normalize(join(UPLOAD_DIR, raw));
  if (!filePath.startsWith(UPLOAD_DIR)) {
    return new Response('Not found', { status: 404 });
  }
  const ext = extname(filePath).toLowerCase();
  if (!MIME[ext] || !/\.(images|moments)[\\/]/.test(filePath)) {
    return new Response('Not found', { status: 404 });
  }
  // 文件名只允许安全字符
  const base = filePath.split(/[\\/]/).pop() || '';
  if (!/^[\w.-]+$/.test(base)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const data = await readFile(filePath);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': MIME[ext],
        // 上传图内容不可变（文件名含时间戳），可长缓存
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
