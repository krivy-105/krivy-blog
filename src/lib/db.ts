import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

// 数据库路径：优先使用 DB_PATH 环境变量（Railway 等部署环境的持久卷挂载点），
// 否则以进程工作目录为基准，指向项目根目录的 data/
const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'blog.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    avatar TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (author_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS post_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );

  CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
  CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_likes_post ON post_likes(post_id);
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_shares_post ON post_shares(post_id);

  -- 标签
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );
  CREATE TABLE IF NOT EXISTS post_tags (
    post_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (post_id, tag_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id)
  );
  CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id);

  -- 全文搜索 FTS5（外部内容表 + 触发器同步）
  CREATE VIRTUAL TABLE IF NOT EXISTS post_fts USING fts5(
    title, description, content,
    content='posts', content_rowid='id'
  );
  CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO post_fts(rowid, title, description, content)
    VALUES (new.id, new.title, new.description, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
    INSERT INTO post_fts(post_fts, rowid, title, description, content)
    VALUES ('delete', old.id, old.title, old.description, old.content);
  END;
  CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
    INSERT INTO post_fts(post_fts, rowid, title, description, content)
    VALUES ('delete', old.id, old.title, old.description, old.content);
    INSERT INTO post_fts(rowid, title, description, content)
    VALUES (new.id, new.title, new.description, new.content);
  END;

  -- 文章浏览量（按 post_id + date + ip_hash 去重）
  CREATE TABLE IF NOT EXISTS post_views (
    post_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, date, ip_hash),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_post_views_post ON post_views(post_id);

  -- 友链
  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  -- 站点统计
  CREATE TABLE IF NOT EXISTS site_stats (
    date TEXT PRIMARY KEY,
    pv INTEGER NOT NULL DEFAULT 0,
    uv INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS daily_visitors (
    date TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    PRIMARY KEY (date, ip_hash)
  );
`);

// FTS5 初始灌数据：仅在表为空时跑一次（避免重启重复插入）
try {
  const ftsCount = db.prepare('SELECT COUNT(*) AS c FROM post_fts').get() as { c: number };
  if (ftsCount.c === 0) {
    db.exec(
      `INSERT INTO post_fts(rowid, title, description, content)
       SELECT id, title, description, content FROM posts WHERE status = 'approved'`
    );
    console.log('[db] FTS5 初始数据已灌入');
  }
} catch (e) {
  console.warn('[db] FTS5 初始灌数据失败（可能未启用 FTS5）:', (e as Error).message);
}

// 线上持久卷中可能是旧库，逐列做幂等迁移（IF NOT EXISTS 不会给已存在的表补列）
const userColumns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
if (!userColumns.some((c) => c.name === 'bio')) {
  db.exec('ALTER TABLE users ADD COLUMN bio TEXT');
}

// posts 表幂等迁移：新增 pinned_at 列（NULL = 未置顶，时间戳 = 置顶时间）
const postColumns = db.prepare('PRAGMA table_info(posts)').all() as { name: string }[];
if (!postColumns.some((c) => c.name === 'pinned_at')) {
  db.exec('ALTER TABLE posts ADD COLUMN pinned_at INTEGER');
}


// 确保管理员账号存在，并与环境变量中的密码保持一致
// （部署后修改 ADMIN_PASSWORD，重启服务即生效，无需手动操作数据库）
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';

const adminRow = db
  .prepare('SELECT * FROM users WHERE username = ?')
  .get(adminUsername) as User | undefined;

if (!adminRow) {
  const hash = bcrypt.hashSync(adminPassword, 10);
  db.prepare(
    'INSERT INTO users (username, email, password, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(adminUsername, `${adminUsername}@blog.local`, hash, 'admin', Date.now());
  console.log(`[db] 管理员账号已创建: ${adminUsername}`);
} else if (!bcrypt.compareSync(adminPassword, adminRow.password) || adminRow.role !== 'admin') {
  // 环境变量密码与库中不一致（首次挂卷时可能用默认密码初始化过），或角色被降级
  const hash = bcrypt.hashSync(adminPassword, 10);
  db.prepare('UPDATE users SET password = ?, role = ? WHERE id = ?').run(
    hash,
    'admin',
    adminRow.id
  );
  console.log(`[db] 管理员账号密码已按环境变量同步: ${adminUsername}`);
}

// ---- 用户相关查询 ----
export const userQueries = {
  findById: db.prepare('SELECT * FROM users WHERE id = ?'),
  findByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  findByUsernameOrEmail: db.prepare(
    'SELECT * FROM users WHERE username = ? OR email = ?'
  ),
  create: db.prepare(
    'INSERT INTO users (username, email, password, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  list: db.prepare('SELECT id, username, email, role, avatar, created_at FROM users ORDER BY created_at DESC'),
  updateBio: db.prepare('UPDATE users SET bio = ? WHERE id = ?'),
};

// ---- 文章相关查询 ----
export const postQueries = {
  findApproved: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.status = 'approved'
     ORDER BY (p.pinned_at IS NULL), p.pinned_at DESC, p.created_at DESC`
  ),
  findBySlug: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.slug = ?`
  ),
  findById: db.prepare('SELECT * FROM posts WHERE id = ?'),
  findByStatus: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.status = ?
     ORDER BY (p.pinned_at IS NULL), p.pinned_at DESC, p.created_at DESC`
  ),
  findByAuthor: db.prepare('SELECT * FROM posts WHERE author_id = ? ORDER BY (pinned_at IS NULL), pinned_at DESC, created_at DESC'),
  findApprovedByAuthor: db.prepare(
    `SELECT * FROM posts WHERE author_id = ? AND status = 'approved' ORDER BY (pinned_at IS NULL), pinned_at DESC, created_at DESC`
  ),
  create: db.prepare(
    'INSERT INTO posts (author_id, slug, title, description, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateStatus: db.prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?'),
  updatePinned: db.prepare('UPDATE posts SET pinned_at = ?, updated_at = ? WHERE id = ?'),
  countByStatus: db.prepare('SELECT COUNT(*) AS count FROM posts WHERE status = ?'),
  all: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     ORDER BY (p.pinned_at IS NULL), p.pinned_at DESC, p.created_at DESC`
  ),
  findRelated: db.prepare(
    `SELECT DISTINCT p.id, p.slug, p.title, p.description, p.created_at,
            u.username AS author_name
     FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.status = 'approved' AND p.id <> ?
       AND (p.author_id = ?
            OR p.id IN (SELECT pt2.post_id FROM post_tags pt1
                        JOIN post_tags pt2 ON pt1.tag_id = pt2.tag_id
                        WHERE pt1.post_id = ?))
     ORDER BY (p.id IN (SELECT pt2.post_id FROM post_tags pt1
                        JOIN post_tags pt2 ON pt1.tag_id = pt2.tag_id
                        WHERE pt1.post_id = ?)) DESC,
              p.created_at DESC
     LIMIT 3`
  ),
  findApprovedForArchive: db.prepare(
    `SELECT p.id, p.slug, p.title, p.created_at, u.username AS author_name
     FROM posts p JOIN users u ON p.author_id = u.id
     WHERE p.status = 'approved'
     ORDER BY p.created_at DESC`
  ),
};

// ---- 消息相关查询 ----
export const messageQueries = {
  create: db.prepare(
    'INSERT INTO messages (sender_id, receiver_id, content, is_read, created_at) VALUES (?, ?, ?, 0, ?)'
  ),
  getConversation: db.prepare(
    `SELECT * FROM messages
     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
     ORDER BY created_at ASC`
  ),
  getUnreadCount: db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND is_read = 0'
  ),
  markAsRead: db.prepare(
    'UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?'
  ),
  getConversationList: db.prepare(
    `SELECT
       CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS other_id,
       MAX(created_at) AS last_time
     FROM messages
     WHERE sender_id = ? OR receiver_id = ?
     GROUP BY other_id
     ORDER BY last_time DESC`
  ),
};

// ---- 点赞相关查询 ----
export const likeQueries = {
  find: db.prepare('SELECT id FROM post_likes WHERE user_id = ? AND post_id = ?'),
  add: db.prepare('INSERT INTO post_likes (user_id, post_id, created_at) VALUES (?, ?, ?)'),
  remove: db.prepare('DELETE FROM post_likes WHERE user_id = ? AND post_id = ?'),
  countForPost: db.prepare('SELECT COUNT(*) AS count FROM post_likes WHERE post_id = ?'),
  // 某用户名下所有已发布文章收获的点赞总数
  totalReceivedByAuthor: db.prepare(
    `SELECT COUNT(*) AS count FROM post_likes l
     JOIN posts p ON l.post_id = p.id
     WHERE p.author_id = ? AND p.status = 'approved'`
  ),
};

// ---- 评论相关查询 ----
export const commentQueries = {
  create: db.prepare('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)'),
  findByPost: db.prepare(
    `SELECT c.id, c.content, c.created_at, c.user_id, u.username
     FROM comments c JOIN users u ON c.user_id = u.id
     WHERE c.post_id = ? ORDER BY c.created_at DESC`
  ),
  countForPost: db.prepare('SELECT COUNT(*) AS count FROM comments WHERE post_id = ?'),
  totalReceivedByAuthor: db.prepare(
    `SELECT COUNT(*) AS count FROM comments c
     JOIN posts p ON c.post_id = p.id
     WHERE p.author_id = ? AND p.status = 'approved'`
  ),
};

// ---- 转发相关查询 ----
export const shareQueries = {
  create: db.prepare('INSERT INTO post_shares (post_id, user_id, created_at) VALUES (?, ?, ?)'),
  countForPost: db.prepare('SELECT COUNT(*) AS count FROM post_shares WHERE post_id = ?'),
};

// ---- 标签相关查询 ----
export const tagQueries = {
  ensure: db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)'),
  findByName: db.prepare('SELECT * FROM tags WHERE name = ?'),
  setForPost: (postId: number, names: string[]) => {
    const del = db.prepare('DELETE FROM post_tags WHERE post_id = ?');
    const link = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');
    const tx = db.transaction((ns: string[]) => {
      del.run(postId);
      for (const n of ns) {
        tagQueries.ensure.run(n);
        const t = tagQueries.findByName.get(n) as { id: number } | undefined;
        if (t) link.run(postId, t.id);
      }
    });
    tx(names);
  },
  forPost: db.prepare(
    `SELECT t.name FROM post_tags pt JOIN tags t ON pt.tag_id = t.id
     WHERE pt.post_id = ? ORDER BY t.name`
  ),
  forPostList: db.prepare(
    `SELECT pt.post_id, GROUP_CONCAT(t.name, ',') AS tags
     FROM post_tags pt JOIN tags t ON pt.tag_id = t.id
     GROUP BY pt.post_id`
  ),
  postsByTag: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     JOIN post_tags pt ON pt.post_id = p.id
     JOIN tags t ON t.id = pt.tag_id
     WHERE p.status = 'approved' AND t.name = ?
     ORDER BY (p.pinned_at IS NULL), p.pinned_at DESC, p.created_at DESC`
  ),
  allWithCount: db.prepare(
    `SELECT t.name, COUNT(pt.post_id) AS cnt FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id
     JOIN posts p ON p.id = pt.post_id AND p.status = 'approved'
     GROUP BY t.id ORDER BY cnt DESC`
  ),
};

// ---- 全文搜索查询 ----
export const searchQueries = {
  search: db.prepare(
    `SELECT p.id, p.slug, p.title, p.description, p.created_at,
            u.username AS author_name,
            snippet(post_fts, 2, '<mark>', '</mark>', '…', 18) AS preview
     FROM post_fts
     JOIN posts p ON p.id = post_fts.rowid
     JOIN users u ON p.author_id = u.id
     WHERE post_fts MATCH ? AND p.status = 'approved'
     ORDER BY rank`
  ),
};

// ---- 浏览量相关查询 ----
export const viewQueries = {
  record: db.prepare(
    `INSERT OR IGNORE INTO post_views (post_id, date, ip_hash, created_at) VALUES (?, ?, ?, ?)`
  ),
  countForPost: db.prepare('SELECT COUNT(*) AS count FROM post_views WHERE post_id = ?'),
  countForPostList: db.prepare(
    `SELECT post_id, COUNT(*) AS count FROM post_views GROUP BY post_id`
  ),
};

// ---- 友链相关查询 ----
export const linkQueries = {
  list: db.prepare('SELECT * FROM links ORDER BY sort ASC, created_at DESC'),
  create: db.prepare(
    'INSERT INTO links (name, url, description, sort, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  remove: db.prepare('DELETE FROM links WHERE id = ?'),
};

// ---- 站点统计相关查询 ----
export const statQueries = {
  ensureUv: db.prepare(
    `INSERT OR IGNORE INTO site_stats (date, pv, uv) VALUES (?, 0, 0)`
  ),
  bumpPv: db.prepare(
    `UPDATE site_stats SET pv = pv + 1 WHERE date = ?`
  ),
  bumpUv: db.prepare(
    `UPDATE site_stats SET uv = uv + 1 WHERE date = ?`
  ),
  last30: db.prepare(
    `SELECT date, pv, uv FROM site_stats
     WHERE date >= date('now', '-30 days')
     ORDER BY date ASC`
  ),
  today: db.prepare(
    `SELECT date, pv, uv FROM site_stats WHERE date = date('now')`
  ),
};

// ---- 每日访客去重查询 ----
export const visitorQueries = {
  recordUv: db.prepare(
    `INSERT OR IGNORE INTO daily_visitors (date, ip_hash) VALUES (?, ?)`
  ),
};

// ---- Session 相关查询 ----
export const sessionQueries = {
  create: db.prepare(
    'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
  ),
  findByToken: db.prepare(
    'SELECT s.*, u.username, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?'
  ),
  deleteByToken: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
};

// 清理过期 session
sessionQueries.deleteExpired.run(Date.now());

export type User = {
  id: number;
  username: string;
  email: string;
  password: string;
  role: string;
  avatar: string | null;
  bio: string | null;
  created_at: number;
};

export type Post = {
  id: number;
  author_id: number;
  slug: string;
  title: string;
  description: string | null;
  content: string;
  status: string;
  created_at: number;
  updated_at: number;
  pinned_at: number | null;
  author_name?: string;
};

export type Message = {
  id: number;
  sender_id: number;
  receiver_id: number;
  content: string;
  is_read: number;
  created_at: number;
};
