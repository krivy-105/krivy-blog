// 一次性脚本：生成 PWA 所需的各尺寸 PNG
// 运行：node scripts/generate-icons.mjs
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public', 'icon.svg'));
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const t of targets) {
  await sharp(svg, { density: 384 })
    .resize(t.size, t.size, { fit: 'contain' })
    .png()
    .toFile(join(outDir, t.name));
  console.log('generated', t.name);
}

// maskable 图标：全出血渐变底 + 心形收进 60% 安全区（系统会裁圆形）
const maskableSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8fb4c5"/>
      <stop offset="1" stop-color="#4f7a90"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(128,128) scale(0.5)">
    <path d="M256 372l-31-28c-69-62-110-100-110-152 0-40 31-71 70-71 23 0 46 11 60 30l11 15 11-15c14-19 37-30 60-30 39 0 70 31 70 71 0 52-41 90-110 152l-31 28z" fill="#ffffff"/>
  </g>
</svg>`);
for (const size of [192, 512]) {
  await sharp(maskableSvg, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(join(outDir, `icon-maskable-${size}.png`));
  console.log('generated icon-maskable-' + size + '.png');
}

await sharp(svg, { density: 192 })
  .resize(32, 32)
  .png()
  .toFile(join(root, 'public', 'favicon-32.png'));
console.log('generated favicon-32.png');
