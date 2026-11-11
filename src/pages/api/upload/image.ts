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

// 声明的 MIME → 文件头应当是什么容器
const MIME_KIND: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** 读文件头判断真实容器格式；无法识别返回 null。 */
function sniffImageType(b: Buffer): string | null {
  const hex = (start: number, end: number) => b.subarray(start, end).toString('hex');
  const ascii = (start: number, end: number) => b.subarray(start, end).toString('latin1');
  if (b.length >= 8 && hex(0, 8) === '89504e470d0a1a0a') return 'png';
  if (b.length >= 3 && hex(0, 3) === 'ffd8ff') return 'jpeg';
  if (b.length >= 6 && ascii(0, 4) === 'GIF8') return 'gif';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

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
  if (file.type === 'image/svg+xml' || file.type === 'text/html') {
    return json({ error: '不支持 SVG / HTML 上传' }, 400);
  }
  if (!ALLOWED.includes(file.type)) {
    return json({ error: '仅支持 PNG / JPG / WebP / GIF 图片' }, 400);
  }
  if (file.size === 0) return json({ error: '图片内容为空' }, 400);
  if (file.size > MAX_BYTES) return json({ error: '图片不能超过 8MB' }, 400);

  try {
    const input = Buffer.from(await file.arrayBuffer());
    // file.type 只是客户端自称，必须用 magic number 复核真实容器格式
    if (sniffImageType(input) !== MIME_KIND[file.type]) {
      return json({ error: '文件内容与声明的图片类型不符' }, 400);
    }

    const output = await sharp(input, { failOn: 'error' })
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    // 兜底确认输出真的是 webp（怪输入下 sharp 可能直通原容器）
    const outMeta = await sharp(output).metadata();
    if (outMeta.format !== 'webp') {
      return json({ error: '图片处理失败，请换一张重试' }, 400);
    }

    const filename = `${user.id}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}.webp`;
    await writeFile(join(UPLOAD_DIR, 'images', filename), output);
    return json({ success: true, url: `/uploads/images/${filename}` });
  } catch {
    return json({ error: '图片处理失败，请换一张重试' }, 400);
  }
};
