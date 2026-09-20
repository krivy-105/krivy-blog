import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db';

// 草稿免登录预览链接签名：
// token = base64url(HMAC_SHA256("{postId}.{updatedAt}"))
// - 只证明「持有链接者可预览此版本」，不带用户身份，可放心转发
// - 文章被再次编辑（updated_at 变化）后旧链接立即失效
let cachedSecret: string | null = null;

function getSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.PREVIEW_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  const file = join(DATA_DIR, '.preview-secret');
  if (existsSync(file)) {
    cachedSecret = readFileSync(file, 'utf8').trim();
    return cachedSecret;
  }
  const generated = randomBytes(32).toString('hex');
  try {
    writeFileSync(file, generated, { mode: 0o600 });
  } catch {
    // 持久卷不可写时退化为进程内密钥（重启后旧预览链接失效，可接受）
  }
  cachedSecret = generated;
  return cachedSecret;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signPreview(postId: number, updatedAt: number): string {
  return b64url(createHmac('sha256', getSecret()).update(`${postId}.${updatedAt}`).digest());
}

export function verifyPreview(
  token: string | null | undefined,
  postId: number,
  updatedAt: number
): boolean {
  if (!token) return false;
  const expected = signPreview(postId, updatedAt);
  if (expected.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}
