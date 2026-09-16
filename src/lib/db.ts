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

  CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
  CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, is_read);
`);

// 确保管理员账号存在
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';

const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUsername);
if (!existingAdmin) {
  const hash = bcrypt.hashSync(adminPassword, 10);
  db.prepare(
    'INSERT INTO users (username, email, password, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(adminUsername, `${adminUsername}@blog.local`, hash, 'admin', Date.now());
  console.log(`[db] 管理员账号已创建: ${adminUsername}`);
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
};

// ---- 文章相关查询 ----
export const postQueries = {
  findApproved: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.status = 'approved'
     ORDER BY p.created_at DESC`
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
     ORDER BY p.created_at DESC`
  ),
  findByAuthor: db.prepare('SELECT * FROM posts WHERE author_id = ? ORDER BY created_at DESC'),
  create: db.prepare(
    'INSERT INTO posts (author_id, slug, title, description, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateStatus: db.prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?'),
  all: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
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
