import type { APIRoute } from 'astro';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createBackupNow } from '../../../lib/db';

// GET /api/admin/backup —— 立即生成一致性快照并下载，仅 admin
// 用于把数据库备份异地保存到本地，避免持久卷故障导致数据丢失。
export const GET: APIRoute = async ({ locals, redirect }) => {
  if (!locals.user || locals.user.role !== 'admin') return redirect('/');

  try {
    const filePath = await createBackupNow();
    const data = readFileSync(filePath);
    const stamp = new Date().toISOString().slice(0, 10);

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
