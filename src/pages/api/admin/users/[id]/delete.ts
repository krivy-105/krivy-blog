import type { APIRoute } from 'astro';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { userQueries, AVATAR_DIR } from '../../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/admin/users/:id/delete —— 管理员永久删除用户
// 事务内级联删除其文章、评论、点赞、收藏、关注、私信、会话等全部关联数据，不可恢复
export const POST: APIRoute = async ({ params, locals }) => {
  const admin = locals.user;
  if (!admin || admin.role !== 'admin') return json({ error: '无权限' }, 403);

  const userId = Number(params.id);
  if (!Number.isFinite(userId)) return json({ error: '用户不存在' }, 404);

  const target = userQueries.findById.get(userId) as
    | { id: number; username: string; role: string }
    | undefined;
  if (!target) return json({ error: '用户不存在' }, 404);
  if (target.id === admin.id) return json({ error: '不能删除当前登录的管理员账号' }, 400);

  const changes = userQueries.deleteWithData(userId) as number;
  if (changes === 0) return json({ error: '用户不存在或已被删除' }, 404);

  // 头像文件为磁盘资源，不在事务内，删除失败不影响账号删除结果。
  // Windows 上杀软/文件监视器可能瞬时占用，重试几次
  const rmRetry = async (file: string, attempts = 3) => {
    for (let i = 0; i < attempts; i++) {
      try {
        await rm(file, { force: true });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 120 * (i + 1)));
      }
    }
  };
  await Promise.allSettled([
    rmRetry(join(AVATAR_DIR, `${userId}.webp`)),
    rmRetry(join(AVATAR_DIR, `${userId}.pending.webp`)),
  ]);

  return json({ success: true, username: target.username });
};
