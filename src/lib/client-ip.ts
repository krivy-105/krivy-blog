/**
 * 取真实客户端 IP。
 *
 * 背景：本站只监听 127.0.0.1，外部流量必须经过 Cloudflare Tunnel / Caddy 反代。
 * X-Forwarded-For 是「往后面追加」的，第一个值由客户端自己填，
 * 取第一个值等于让攻击者随便换 IP 绕过限流。
 *
 * 优先级：
 *   1) cf-connecting-ip —— Cloudflare 边缘写入，客户端伪造不了（隧道模式必有）
 *   2) x-forwarded-for 的最后一个值 —— 最靠近服务器的这一跳
 *   3) x-real-ip
 *   4) 都没有则 unknown
 */
export function getClientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip');
  if (cf && cf.trim()) return cf.trim();

  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }

  const realIp = headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();

  return 'unknown';
}
