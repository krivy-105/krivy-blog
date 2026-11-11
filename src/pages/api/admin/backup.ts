import type { APIRoute } from 'astro';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createBackupNow } from '../../../lib/db';
import { dateKeyCN } from '../../../lib/time';

/**
 * 同源校验：备份是「按一下就生成整库文件」的操作，不能被跨站链接或预取触发。
 * - 有 Origin：其 host 必须等于反代后的 host（x-forwarded-host 优先）
 * - 无 Origin（部分客户端）：退回 Sec-Fetch-Site，仅放行 same-origin
 * - 两者都缺：拒绝
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (origin) {
    if (origin === 'null' || !host) return false;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

// POST /api/admin/backup —— 立即生成一致性快照并下载，仅 admin
// 用于把数据库备份异地保存到本地，避免持久卷故障导致数据丢失。
// 刻意只导出 POST：GET 能被 <a href>、<img>、预取、CDN 代理触发，
// 备份包含全部用户数据，一次跨站 GET 成功就等于把整库交出去。
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user || locals.user.role !== 'admin') {
    return new Response(JSON.stringify({ error: '无权限' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (!isSameOrigin(request)) {
    return new Response(JSON.stringify({ error: '非法请求来源' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  try {
    const filePath = await createBackupNow();
    const data = readFileSync(filePath);
    const stamp = dateKeyCN();

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="blog-backup-${stamp}.db"`,
        'Content-Length': String(data.length),
        // 备份含全部用户数据，绝不允许浏览器或边缘缓存
        'Cache-Control': 'private, no-store',
        'X-Backup-File': basename(filePath),
      },
    });
  } catch (err) {
    console.error('[backup] 生成备份失败:', err);
    return new Response(
      JSON.stringify({ error: '备份生成失败，请查看服务日志' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }
    );
  }
};
