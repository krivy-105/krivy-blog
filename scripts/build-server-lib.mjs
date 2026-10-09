// 把 server.mjs 运行时依赖的 TypeScript 模块预编译成一个 ESM 文件。
//
// 原来生产环境是 `tsx server.mjs`：每次启动都要现场转译 src/lib/*.ts，
// 镜像里也得带上 tsx（连同 esbuild 原生二进制）。预编译后直接用 node 启动，
// 依赖更少、启动更快，Dockerfile 也不必再往运行阶段拷 src/lib。
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

const OUT_DIR = 'dist/server/lib';
const OUTFILE = `${OUT_DIR}/index.mjs`;

mkdirSync(OUT_DIR, { recursive: true });

await build({
  entryPoints: ['src/lib/server-lib.ts'],
  outfile: OUTFILE,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // better-sqlite3 是原生模块、bcryptjs 等在 node_modules 里运行时解析即可，
  // 不打进产物（打进去也没用，原生 .node 二进制没法内联）
  packages: 'external',
  logLevel: 'info',
});

console.log(`[server-lib] 已生成 ${OUTFILE}`);
