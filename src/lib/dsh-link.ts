import crypto from 'node:crypto';
import { db } from './db';

// DSH 手机通道链接的持久化：存在 meta(key,value) 表里，
// 电脑端开机脚本通过 /api/admin/dsh-link 推送最新链接到这里，
// 页面（仅 admin 可见）优先读库，本地文件只做兜底。

export const DSH_LINK = 'dsh_link';
export const DSH_LINK_AT = 'dsh_link_at';
export const DSH_PUSH_KEY = 'dsh_push_key';

const getMeta = (key: string): string | null => {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
};

const setMeta = (key: string, value: string): void => {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
};

export function getDshLink(): { url: string; at: number | null } | null {
  const url = getMeta(DSH_LINK);
  if (!url) return null;
  const at = getMeta(DSH_LINK_AT);
  return { url, at: at ? Number(at) : null };
}

export function setDshLink(url: string): void {
  setMeta(DSH_LINK, url);
  setMeta(DSH_LINK_AT, String(Date.now()));
}

// 配对密钥：首次访问时由服务器生成并落库（持久卷），此后保持稳定
export function ensurePushKey(): string {
  let key = getMeta(DSH_PUSH_KEY);
  if (!key) {
    key = crypto.randomBytes(16).toString('hex');
    setMeta(DSH_PUSH_KEY, key);
  }
  return key;
}

export function verifyPushKey(candidate: string | null): boolean {
  const real = getMeta(DSH_PUSH_KEY);
  if (!real || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(real);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
