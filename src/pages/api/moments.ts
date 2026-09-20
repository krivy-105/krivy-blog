import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { momentQueries, UPLOAD_DIR } from '../../lib/db';
import { bumpRateLimit, getClientIp } from '../../lib/rate-limit';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const MAX_LEN = 1000;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// POST /api/moments（multipart：content 必填，image 可选，一张图）
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录' }, 401);

  const ip = getClientIp(request.headers);
  if (!bumpRateLimit(`moment:${ip}`, 12, 10 * 60 * 1000).ok) {
    return json({ error: '发得太频繁啦，喝口水稍后再试' }, 429);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: '请求格式错误' }, 400);
  const content = ((form.get('content') as string) ?? '').trim();
  const image = form.get('image');
  const hasImage = image instanceof File && image.size > 0;

  if (!content && !hasImage) return json({ error: '说点什么或选张图吧' }, 400);
  if (content.length > MAX_LEN) return json({ error: `正文最长 ${MAX_LEN} 字` }, 400);

  let imageUrl: string | null = null;
  if (hasImage) {
    if (!ALLOWED.includes(image.type)) {
      return json({ error: '仅支持 PNG / JPG / WebP / GIF 图片' }, 400);
    }
    if (image.size > MAX_BYTES) return json({ error: '图片不能超过 8MB' }, 400);
    try {
      const input = Buffer.from(await image.arrayBuffer());
      const output = await sharp(input, { failOn: 'error' })
        .rotate()
        .resize({ width: 1400, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const filename = `${user.id}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}.webp`;
      await writeFile(join(UPLOAD_DIR, 'moments', filename), output);
      imageUrl = `/uploads/moments/${filename}`;
    } catch {
      return json({ error: '图片处理失败，请换一张重试' }, 400);
    }
  }

  try {
    const result = momentQueries.create.run(user.id, content || ' ', imageUrl, Date.now());
    return json({ success: true, id: Number(result.lastInsertRowid) });
  } catch {
    return json({ error: '发布失败，请重试' }, 500);
  }
};
