import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { userQueries, AVATAR_DIR } from '../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// POST /api/profile
// - application/json：更新个人简介 { bio }
// - multipart/form-data：上传头像（字段 avatar；sharp 居中裁剪 256x256，输出 webp）
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录' }, 401);

  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('avatar');
    if (!(file instanceof File)) return json({ error: '未收到头像文件' }, 400);
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      return json({ error: '仅支持 PNG / JPG / WebP / GIF 格式的图片' }, 400);
    }
    if (file.size === 0) return json({ error: '图片内容为空' }, 400);
    if (file.size > MAX_AVATAR_BYTES) {
      return json({ error: '头像图片不能超过 5MB' }, 400);
    }

    try {
      const input = Buffer.from(await file.arrayBuffer());
      // rotate() 会自动按 EXIF 方向转正（手机照片常见问题）
      const output = await sharp(input, { failOn: 'error' })
        .rotate()
        .resize(256, 256, { fit: 'cover', position: 'center' })
        .webp({ quality: 82 })
        .toBuffer();

      const version = Date.now();

      // 管理员上传即时生效；普通用户先落待审文件，审核通过后才替换正式头像
      if (user.role === 'admin') {
        await writeFile(join(AVATAR_DIR, `${user.id}.webp`), output);
        const avatar = `/avatars/${user.id}?v=${version}`;
        userQueries.updateAvatar.run(avatar, user.id);
        return json({ success: true, approved: true, avatar });
      }

      // 待审文件与正式文件分离，被拒/覆盖都不影响线上头像
      await writeFile(join(AVATAR_DIR, `${user.id}.pending.webp`), output);
      const avatarPending = `/avatars/${user.id}?kind=pending&v=${version}`;
      userQueries.setAvatarPending.run(avatarPending, version, user.id);
      return json({ success: true, pending: true, avatar_pending: avatarPending });
    } catch {
      return json({ error: '图片处理失败，请更换一张图片后重试' }, 400);
    }
  }

  const body = await request.json();
  const bio = ((body.bio as string) ?? '').trim();

  if (bio.length > 200) return json({ error: '简介最长 200 字' }, 400);

  userQueries.updateBio.run(bio || null, user.id);
  return json({ success: true, bio: bio || null });
};
