import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UPLOAD_DIR } from '../../../lib/db';
import { bumpRateLimit, getClientIp } from '../../../lib/rate-limit';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// POST /api/upload/image（multipart 字段 image）
// 编辑器粘贴/拖入图片时调用：sharp 限宽 1600、转 webp q82，返回可插入正文的 URL
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录' }, 401);

  const ip = getClientIp(request.headers);
  if (!bumpRateLimit(`upload:${ip}`, 30, 10 * 60 * 1000).ok) {
    return json({ error: '上传太频繁，请稍后再试' }, 429);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('image');
  if (!(file instanceof File)) return json({ error: '未收到图片文件' }, 400);
  if (!ALLOWED.includes(file.type)) {
    return json({ error: '仅支持 PNG / JPG / WebP / GIF 图片' }, 400);
  }
  if (file.size === 0) return json({ error: '图片内容为空' }, 400);
  if (file.size > MAX_BYTES) return json({ error: '图片不能超过 8MB' }, 400);

  try {
    const input = Buffer.from(await file.arrayBuffer());
    const output = await sharp(input, { failOn: 'error' })
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    const filename = `${user.id}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}.webp`;
    await writeFile(join(UPLOAD_DIR, 'images', filename), output);
    return json({ success: true, url: `/uploads/images/${filename}` });
  } catch {
    return json({ error: '图片处理失败，请换一张重试' }, 400);
  }
};
