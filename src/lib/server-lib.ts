// server.mjs（自定义 HTTP 服务 + WebSocket 私信）运行时需要的最小导出集合。
//
// 为什么要有这个文件：esbuild 是按入口打包的。如果 server.mjs 分别 import
// './lib/db' 和 './lib/auth'，db.ts 会被打进两份产物，同一个进程里就出现
// 两个 Database 连接、两套定时器。集中从一个入口 re-export，只产出一份。
export { sessionQueries, messageQueries, userQueries } from './db';
export type { User, Message } from './db';
