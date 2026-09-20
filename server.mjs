// 自定义服务器入口：Astro SSR + WebSocket 聊天
import { handler } from './dist/server/entry.mjs';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { sessionQueries, messageQueries, userQueries } from './src/lib/db.ts';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4321;
const CLIENT_DIR = join(process.cwd(), 'dist', 'client');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const filePath = normalize(join(CLIENT_DIR, pathname));
  // 防止路径穿越
  if (!filePath.startsWith(CLIENT_DIR)) return false;
  if (!existsSync(filePath)) return false;
  let stat;
  try { stat = statSync(filePath); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  // 缓存策略：SW/manifest 必须每次校验；哈希构建产物与图标可长缓存
  let cacheControl = 'public, max-age=3600';
  if (pathname === '/sw.js' || pathname === '/manifest.webmanifest') {
    cacheControl = 'no-cache';
  } else if (pathname.startsWith('/_astro/')) {
    cacheControl = 'public, max-age=31536000, immutable';
  } else if (ext === '.ico' || ext === '.png' || ext === '.jpg' || ext === '.jpeg' ||
             ext === '.gif' || ext === '.webp' || ext === '.svg' || ext === '.woff' ||
             ext === '.woff2' || ext === '.ttf') {
    cacheControl = 'public, max-age=604800';
  }
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': cacheControl,
  });
  createReadStream(filePath).pipe(res);
  return true;
}

const server = createServer((req, res) => {
  // Railway 等反向代理通过 x-forwarded-* 传递原始域名/协议。
  // 用第一个值（最接近客户端的那一跳）覆盖，确保 Astro 构造的请求 URL
  // 与浏览器地址栏一致（canonical、cookie、Origin 判断等）。
  const xfh = req.headers['x-forwarded-host'];
  if (xfh) req.headers.host = String(xfh).split(',')[0].trim();
  const xfp = req.headers['x-forwarded-proto'];
  if (xfp) req.headers['x-forwarded-proto'] = String(xfp).split(',')[0].trim();

  // www 域名统一 301 跳转到主域名（本地 localhost 不受影响）
  const host = req.headers.host || '';
  const hostNoPort = host.split(':')[0];
  if (hostNoPort.startsWith('www.')) {
    res.writeHead(301, { Location: 'https://' + host.slice(4) + (req.url || '/') });
    res.end();
    return;
  }
  if (serveStatic(req, res)) return;
  handler(req, res);
});

// ---- WebSocket 聊天服务器 ----
const wss = new WebSocketServer({ noServer: true });

// userId -> Set<WebSocket>
const userConnections = new Map();

const COOKIE_NAME = process.env.SESSION_COOKIE || 'blog_session';

function getUserIdFromRequest(req) {
  // 从 cookie 中读取 session token
  const cookies = req.headers.cookie || '';
  const match = cookies.match(new RegExp(COOKIE_NAME + '=([^;]+)'));
  if (!match) return null;
  const token = match[1];
  const row = sessionQueries.findByToken.get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  return row.user_id;
}

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = userId;
    if (!userConnections.has(userId)) {
      userConnections.set(userId, new Set());
    }
    userConnections.get(userId).add(ws);

    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // { type: 'message', receiverId, content }
      if (msg.type === 'message' && ws.userId) {
        const receiverId = Number(msg.receiverId);
        const content = String(msg.content || '').trim();
        if (!receiverId || !content) return;

        const now = Date.now();
        const result = messageQueries.create.run(ws.userId, receiverId, content, now);
        const message = {
          id: result.lastInsertRowid,
          sender_id: ws.userId,
          receiver_id: receiverId,
          content,
          is_read: 0,
          created_at: now,
        };

        // 发送给接收方的所有在线连接
        const receiverSockets = userConnections.get(receiverId);
        if (receiverSockets) {
          for (const client of receiverSockets) {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'message', message }));
            }
          }
        }
        // 发送给发送方自己（确认）
        ws.send(JSON.stringify({ type: 'message_sent', message }));
      }
    } catch (e) {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    const conns = userConnections.get(ws.userId);
    if (conns) {
      conns.delete(ws);
      if (conns.size === 0) {
        userConnections.delete(ws.userId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 博客服务器运行在 http://localhost:${PORT}`);
});
