import type { APIRoute } from 'astro';
import { userQueries, followQueries, notificationQueries } from '../../../../lib/db';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// POST /api/users/:username/follow —— 关注 / 取消关注（切换）
export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: '请先登录' }, 401);

  const target = userQueries.findByUsername.get(params.username) as
    | { id: number }
    | undefined;
  if (!target) return json({ error: '用户不存在' }, 404);

  if (target.id === user.id) return json({ error: '不能关注自己' }, 400);

  const existing = followQueries.find.get(user.id, target.id);
  let following: boolean;
  if (existing) {
    followQueries.remove.run(user.id, target.id);
    following = false;
  } else {
    followQueries.add.run(user.id, target.id, Date.now());
    following = true;
    // 通知被关注者
    notificationQueries.create({
      userId: target.id,
      actorId: user.id,
      type: 'new_follow',
    });
  }

  const followers = (followQueries.countFollowers.get(target.id) as { count: number })
    .count;
  const followingCount = (followQueries.countFollowing.get(user.id) as {
    count: number;
  }).count;

  return json({ success: true, following, followers, followingCount });
};
