import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { postQueries } from '../../lib/db';

export const prerender = false;

// GET /og/{slug}.png —— 文章分享卡（1200×630）
// SVG 模板经 sharp 栅格化为 PNG；中文字体优先 Noto Sans CJK（Docker 镜像内置），
// 本地开发回退微软雅黑。
export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug?.replace(/\.png$/, '');
  if (!slug) return new Response('Not found', { status: 404 });

  const post = postQueries.findBySlug.get(slug) as
    | { title: string; author_name: string; created_at: number; status: string }
    | undefined;
  if (!post || post.status !== 'approved') {
    return new Response('Not found', { status: 404 });
  }

  const date = new Date(post.created_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const W = 1200;
  const fontSize = 58;
  const maxWidth = 1000;
  const lines = wrapText(post.title, fontSize, maxWidth, 3);

  const lineHeight = fontSize * 1.35;
  const blockHeight = lines.length * lineHeight;
  const startY = 310 - blockHeight / 2 + fontSize * 0.35;

  const textSvg = lines
    .map(
      (line, i) =>
        `<text x="100" y="${Math.round(startY + i * lineHeight)}" font-size="${fontSize}" font-weight="700" fill="#ffffff">${escapeXml(line)}</text>`
    )
    .join('');

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="630" viewBox="0 0 ${W} 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7fa3b8"/>
      <stop offset="0.55" stop-color="#5f889d"/>
      <stop offset="1" stop-color="#426a7f"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="630" fill="url(#bg)"/>
  <circle cx="1060" cy="90" r="230" fill="#ffffff" opacity="0.07"/>
  <circle cx="120" cy="600" r="190" fill="#ffffff" opacity="0.06"/>
  <circle cx="980" cy="560" r="70" fill="#ffffff" opacity="0.05"/>

  <!-- 品牌行 -->
  <g transform="translate(100,108)">
    <path d="M20 35 L6 22 C-4 12 -4 2 4 -2 C11 -5 17 -2 20 4 C23 -2 29 -5 36 -2 C44 2 44 12 34 22 Z"
          transform="scale(1.15)" fill="#ffffff" opacity="0.92"/>
    <text x="56" y="22" font-size="26" font-weight="600" fill="#ffffff" opacity="0.92"
          font-family="sans-serif">want to see you</text>
    <text x="56" y="52" font-size="20" fill="#ffffff" opacity="0.65"
          font-family="sans-serif">krivy.cyou</text>
  </g>

  <!-- 标题 -->
  <g font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">
    ${textSvg}
  </g>

  <!-- 底部署名 -->
  <line x1="100" y1="505" x2="1100" y2="505" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="100" y="552" font-size="24" fill="#ffffff" opacity="0.85"
        font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">✍️ ${escapeXml(post.author_name)}</text>
  <text x="1100" y="552" font-size="24" text-anchor="end" fill="#ffffff" opacity="0.85"
        font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">${escapeXml(date)}</text>
</svg>`;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
};

// 中英文混排按等宽估算折行；CJK 计 1em，ASCII 计 0.56em，最多 maxLines 行，末行省略
function wrapText(text: string, fontSize: number, maxWidth: number, maxLines: number): string[] {
  const chars = Array.from(text.trim());
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  const charWidth = (ch: string) =>
    /[⺀-鿿　-〿＀-￯]/.test(ch) ? fontSize : fontSize * 0.56;

  for (const ch of chars) {
    const w = charWidth(ch);
    if (currentWidth + w > maxWidth && current) {
      lines.push(current);
      current = ch;
      currentWidth = w;
      if (lines.length === maxLines) break;
    } else {
      current += ch;
      currentWidth += w;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    const consumed = lines.join('').length;
    if (consumed < chars.length) {
      let last = lines[maxLines - 1];
      while (last.length > 1 && measure(last + '…', fontSize) > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = last + '…';
    }
  }
  return lines;
}

function measure(text: string, fontSize: number): number {
  return Array.from(text).reduce(
    (sum, ch) =>
      sum + (/[⺀-鿿　-〿＀-￯]/.test(ch) ? fontSize : fontSize * 0.56),
    0
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
