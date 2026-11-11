// 内存级固定窗口限流（单进程部署，本站规模足够；重启即清零可接受）
const buckets = new Map<string, { count: number; resetAt: number }>();

function prune(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export function isLimited(key: string, max: number): boolean {
  const bucket = buckets.get(key);
  if (!bucket) return false;
  if (bucket.resetAt <= Date.now()) {
    buckets.delete(key);
    return false;
  }
  return bucket.count >= max;
}

// 计数一次；返回是否仍在限额内
export function bumpRateLimit(
  key: string,
  max: number,
  windowMs: number
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  prune(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  // 先比较再自增：原来的「先自增再比较」实际会多放行一次
  if (bucket.count >= max) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count++;
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}

// 取真实客户端 IP：优先 Cloudflare 写入的 CF-Connecting-IP，
// 兜底取 X-Forwarded-For 的最后一个值（详见 ./client-ip.ts）。
// 保留函数名与签名，所有既有调用方无需改动。
export { getClientIp } from './client-ip';
