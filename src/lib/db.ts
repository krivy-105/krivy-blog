import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { join, dirname } from 'node:path';
import { mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';

// 数据库路径：优先使用 DB_PATH 环境变量（Railway 等部署环境的持久卷挂载点），
// 否则以进程工作目录为基准，指向项目根目录的 data/
const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'blog.db');
export const DATA_DIR = dirname(DB_PATH);
// 用户上传头像的存放目录：与数据库放在同一个持久卷，容器重启/重新部署后文件不丢失
export const AVATAR_DIR = join(DATA_DIR, 'avatars');
// 正文插图与说说图片
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(AVATAR_DIR, { recursive: true });
mkdirSync(join(UPLOAD_DIR, 'images'), { recursive: true });
mkdirSync(join(UPLOAD_DIR, 'moments'), { recursive: true });
// 数据库每日备份目录（同一持久卷内）
const BACKUP_DIR = join(DATA_DIR, 'backups');
const BACKUP_KEEP = 7;
mkdirSync(BACKUP_DIR, { recursive: true });

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
  -- 仅在标题/描述/正文变化时同步索引；软删除/状态/置顶等 UPDATE 不应触发
  -- （否则对缺失的 FTS 行执行 delete 会抛 SQLITE_CORRUPT_VTAB 导致删除失败）
  CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE OF title, description, content ON posts BEGIN
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
// 头像审核：avatar 为当前生效头像，avatar_pending 为待审核头像，
// avatar_status: approved（生效/无待审）| pending（审核中）| rejected（上次被拒）
if (!userColumns.some((c) => c.name === 'avatar_pending')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar_pending TEXT');
}
if (!userColumns.some((c) => c.name === 'avatar_status')) {
  db.exec(`ALTER TABLE users ADD COLUMN avatar_status TEXT NOT NULL DEFAULT 'approved'`);
}
if (!userColumns.some((c) => c.name === 'avatar_pending_at')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar_pending_at INTEGER');
}

// posts 表幂等迁移：新增 pinned_at 列（NULL = 未置顶，时间戳 = 置顶时间）
const postColumns = db.prepare('PRAGMA table_info(posts)').all() as { name: string }[];
if (!postColumns.some((c) => c.name === 'pinned_at')) {
  db.exec('ALTER TABLE posts ADD COLUMN pinned_at INTEGER');
}
if (!postColumns.some((c) => c.name === 'deleted_at')) {
  db.exec('ALTER TABLE posts ADD COLUMN deleted_at INTEGER');
}
// 定时发布：status='scheduled' 时在此时间戳自动转 approved
if (!postColumns.some((c) => c.name === 'publish_at')) {
  db.exec('ALTER TABLE posts ADD COLUMN publish_at INTEGER');
}

// FTS UPDATE 触发器升级：旧版 AFTER UPDATE 在软删除/改状态/置顶等任意列
// 更新时都重建索引，对缺失的 FTS 行执行 delete 会抛 SQLITE_CORRUPT_VTAB
// （表现为删除文章接口 500「删除失败，请重试」）。
// 替换为仅监听 title/description/content，并 rebuild 修复历史索引不同步。
const ftsAuTrigger = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'posts_fts_au'")
  .get() as { sql: string } | undefined;
if (ftsAuTrigger && !/UPDATE\s+OF\s+title/i.test(ftsAuTrigger.sql)) {
  db.exec(`
    DROP TRIGGER IF EXISTS posts_fts_au;
    INSERT INTO post_fts(post_fts) VALUES('rebuild');
    CREATE TRIGGER posts_fts_au AFTER UPDATE OF title, description, content ON posts BEGIN
      INSERT INTO post_fts(post_fts, rowid, title, description, content)
      VALUES ('delete', old.id, old.title, old.description, old.content);
      INSERT INTO post_fts(rowid, title, description, content)
      VALUES (new.id, new.title, new.description, new.content);
    END;
  `);
}

// comments 表幂等迁移：楼中楼、软删除、治理
const commentColumns = db.prepare('PRAGMA table_info(comments)').all() as { name: string }[];
if (!commentColumns.some((c) => c.name === 'parent_id')) {
  db.exec('ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE');
}
if (!commentColumns.some((c) => c.name === 'reply_to_user_id')) {
  db.exec('ALTER TABLE comments ADD COLUMN reply_to_user_id INTEGER REFERENCES users(id)');
}
if (!commentColumns.some((c) => c.name === 'hidden_at')) {
  db.exec('ALTER TABLE comments ADD COLUMN hidden_at INTEGER');
}
if (!commentColumns.some((c) => c.name === 'deleted_at')) {
  db.exec('ALTER TABLE comments ADD COLUMN deleted_at INTEGER');
}

// comment_likes 表：评论点赞
db.exec(`
  CREATE TABLE IF NOT EXISTS comment_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    comment_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, comment_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id);
`);

// 连载系列
db.exec(`
  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    author_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (author_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS post_series (
    post_id INTEGER PRIMARY KEY,
    series_id INTEGER NOT NULL,
    order_in_series INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_post_series_series ON post_series(series_id, order_in_series);
`);

// 文章收藏（书签）
db.exec(`
  CREATE TABLE IF NOT EXISTS post_bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON post_bookmarks(user_id);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_post ON post_bookmarks(post_id);
`);

// 用户关注关系
db.exec(`
  CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
  CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
`);

// 系统通知
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    actor_id INTEGER,
    type TEXT NOT NULL,
    post_id INTEGER,
    comment_id INTEGER,
    content TEXT,
    read_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
`);

// 评论举报
db.exec(`
  CREATE TABLE IF NOT EXISTS comment_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    reporter_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    handler_id INTEGER,
    handled_at INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE(comment_id, reporter_id),
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (handler_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reports_status ON comment_reports(status);
`);

// 留言板（不针对具体文章的访客留言）
db.exec(`
  CREATE TABLE IF NOT EXISTS guestbook_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_guestbook_created ON guestbook_entries(created_at);
`);

// 说说 / 动态（短文，可带一张图）
db.exec(`
  CREATE TABLE IF NOT EXISTS moments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    image TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_moments_created ON moments(created_at);
`);


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
  updateAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),
  // 头像审核流转
  setAvatarPending: db.prepare(
    `UPDATE users SET avatar_pending = ?, avatar_status = 'pending', avatar_pending_at = ? WHERE id = ?`
  ),
  approveAvatar: db.prepare(
    `UPDATE users
     SET avatar = ?, avatar_pending = NULL, avatar_status = 'approved', avatar_pending_at = NULL
     WHERE id = ?`
  ),
  rejectAvatar: db.prepare(
    `UPDATE users
     SET avatar_pending = NULL, avatar_status = 'rejected', avatar_pending_at = NULL
     WHERE id = ?`
  ),
  findPendingAvatars: db.prepare(
    `SELECT id, username, avatar, avatar_pending, avatar_pending_at
     FROM users WHERE avatar_status = 'pending' AND avatar_pending IS NOT NULL
     ORDER BY avatar_pending_at ASC`
  ),
  countPendingAvatars: db.prepare(
    `SELECT COUNT(*) AS count FROM users WHERE avatar_status = 'pending' AND avatar_pending IS NOT NULL`
  ),
  // 事务式删除用户：FK 默认 RESTRICT，必须按依赖顺序显式清理
  deleteWithData: db.transaction((userId: number) => {
    // 1) 其名下文章及其从属数据（post_tags/post_bookmarks/post_series/notifications 走 CASCADE，
    //    FTS 由 posts_fts_ad 触发器自动清理）
    const postIds = (db.prepare('SELECT id FROM posts WHERE author_id = ?').all(userId) as { id: number }[]).map(
      (p) => p.id
    );
    if (postIds.length > 0) {
      const inClause = postIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM post_views WHERE post_id IN (${inClause})`).run(...postIds);
      // 删评论会级联删除 comment_likes/comment_reports/notifications，嵌套回复经 parent_id 级联
      db.prepare(`DELETE FROM comments WHERE post_id IN (${inClause})`).run(...postIds);
      db.prepare(`DELETE FROM post_shares WHERE post_id IN (${inClause})`).run(...postIds);
      db.prepare(`DELETE FROM post_likes WHERE post_id IN (${inClause})`).run(...postIds);
      db.prepare('DELETE FROM posts WHERE author_id = ?').run(userId);
    }
    // 2) 该用户在他人文章下的点赞与评论（子回复随 parent_id 级联）
    db.prepare('DELETE FROM comment_likes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM comments WHERE user_id = ?').run(userId);
    // 3) 解除剩余表对该用户的 RESTRICT/悬空引用
    db.prepare('UPDATE comments SET reply_to_user_id = NULL WHERE reply_to_user_id = ?').run(userId);
    db.prepare('UPDATE post_shares SET user_id = NULL WHERE user_id = ?').run(userId);
    // 4) 其创建的系列、点赞、收藏、私信、登录会话
    //    注意：post_bookmarks.user_id 建表时未声明 ON DELETE（NO ACTION），必须显式删
    db.prepare('DELETE FROM series WHERE author_id = ?').run(userId);
    db.prepare('DELETE FROM post_likes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM post_bookmarks WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(userId, userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    // 5) follows / notifications(user_id) / comment_reports(reporter_id) 走 CASCADE，
    //    notifications.actor_id / comment_reports.handler_id 走 SET NULL，最后删主行
    const info = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return info.changes;
  }),
};

// ---- 文章相关查询 ----
export const postQueries = {
  findApproved: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.status = 'approved' AND p.deleted_at IS NULL
     ORDER BY (p.pinned_at IS NULL), p.pinned_at DESC, p.created_at DESC`
  ),
  // 首页最近文章：SQL 层 LIMIT，避免全量加载后内存截断
  findApprovedRecent: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.status = 'approved' AND p.deleted_at IS NULL
     ORDER BY (p.pinned_at IS NULL), p.pinned_at DESC, p.created_at DESC
     LIMIT ?`
  ),
  // 列表页分页
  findApprovedPaged: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.status = 'approved' AND p.deleted_at IS NULL
     ORDER BY (p.pinned_at IS NULL), p.pinned_at DESC, p.created_at DESC
     LIMIT ? OFFSET ?`
  ),
  countApproved: db.prepare(
    `SELECT COUNT(*) AS count FROM posts WHERE status = 'approved' AND deleted_at IS NULL`
  ),
  findBySlug: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.slug = ? AND p.deleted_at IS NULL`
  ),
  findById: db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL'),
  findByStatus: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.status = ? AND p.deleted_at IS NULL
     ORDER BY (p.pinned_at IS NULL), p.pinned_at DESC, p.created_at DESC`
  ),
  findByAuthor: db.prepare('SELECT * FROM posts WHERE author_id = ? AND deleted_at IS NULL ORDER BY (pinned_at IS NULL), pinned_at DESC, created_at DESC'),
  findApprovedByAuthor: db.prepare(
    `SELECT * FROM posts WHERE author_id = ? AND status = 'approved' AND deleted_at IS NULL ORDER BY (pinned_at IS NULL), pinned_at DESC, created_at DESC`
  ),
  create: db.prepare(
    'INSERT INTO posts (author_id, slug, title, description, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  // 定时发布：status='scheduled' + publish_at，由后台调度器到点转 approved
  createScheduled: db.prepare(
    'INSERT INTO posts (author_id, slug, title, description, content, status, created_at, updated_at, publish_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  // 文章页上一篇 / 下一篇（按发布时间，仅已发布）
  prevNeighbor: db.prepare(
    `SELECT slug, title FROM posts
     WHERE status = 'approved' AND deleted_at IS NULL AND created_at < ?
     ORDER BY created_at DESC LIMIT 1`
  ),
  nextNeighbor: db.prepare(
    `SELECT slug, title FROM posts
     WHERE status = 'approved' AND deleted_at IS NULL AND created_at > ?
     ORDER BY created_at ASC LIMIT 1`
  ),
  // 调度器：取出到点的定时文章
  listDueScheduled: db.prepare(
    `SELECT id FROM posts WHERE status = 'scheduled' AND deleted_at IS NULL AND publish_at IS NOT NULL AND publish_at <= ?`
  ),
  // 编辑时设定定时发布
  updateScheduled: db.prepare(
    "UPDATE posts SET title = ?, description = ?, content = ?, status = 'scheduled', publish_at = ?, updated_at = ? WHERE id = ? AND author_id = ? AND deleted_at IS NULL"
  ),
  updateStatus: db.prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?'),
  updatePinned: db.prepare('UPDATE posts SET pinned_at = ?, updated_at = ? WHERE id = ?'),
  countByStatus: db.prepare('SELECT COUNT(*) AS count FROM posts WHERE status = ? AND deleted_at IS NULL'),
  all: db.prepare(
    `SELECT p.*, u.username AS author_name FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.deleted_at IS NULL
     ORDER BY (p.pinned_at IS NULL), p.pinned_at DESC, p.created_at DESC`
  ),
  findRelated: db.prepare(
    `SELECT DISTINCT p.id, p.slug, p.title, p.description, p.created_at,
            u.username AS author_name
     FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.status = 'approved' AND p.deleted_at IS NULL AND p.id <> ?
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
     WHERE p.status = 'approved' AND p.deleted_at IS NULL
     ORDER BY p.created_at DESC`
  ),
  topHot: db.prepare(
    `SELECT p.*, u.username AS author_name,
            IFNULL(v.cnt, 0) * 3 +
            IFNULL(l.cnt, 0) * 7 +
            IFNULL(c.cnt, 0) * 10 AS score
     FROM posts p
     JOIN users u ON p.author_id = u.id
     LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM post_views GROUP BY post_id) v ON v.post_id = p.id
     LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM post_likes GROUP BY post_id) l ON l.post_id = p.id
     LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM comments GROUP BY post_id) c ON c.post_id = p.id
     WHERE p.status = 'approved' AND p.deleted_at IS NULL
     ORDER BY score DESC, p.created_at DESC
     LIMIT 5`
  ),
  update: db.prepare(
    "UPDATE posts SET title = ?, description = ?, content = ?, status = 'pending', updated_at = ? WHERE id = ? AND author_id = ? AND deleted_at IS NULL"
  ),
  softDelete: db.prepare(
    'UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ? AND author_id = ? AND deleted_at IS NULL'
  ),
  // 管理员下架：不限作者
  adminSoftDelete: db.prepare(
    'UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
  ),
};

// ---- 留言板 ----
export const guestbookQueries = {
  list: db.prepare(
    `SELECT g.id, g.content, g.created_at, g.user_id, u.username, u.avatar, u.role
     FROM guestbook_entries g
     JOIN users u ON g.user_id = u.id
     WHERE g.deleted_at IS NULL
     ORDER BY g.created_at DESC
     LIMIT 100`
  ),
  create: db.prepare(
    'INSERT INTO guestbook_entries (user_id, content, created_at) VALUES (?, ?, ?)'
  ),
  softDelete: db.prepare(
    'UPDATE guestbook_entries SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
  ),
  findById: db.prepare('SELECT user_id FROM guestbook_entries WHERE id = ? AND deleted_at IS NULL'),
};

// ---- 说说 / 动态 ----
export const momentQueries = {
  list: db.prepare(
    `SELECT m.*, u.username, u.avatar, u.role
     FROM moments m
     JOIN users u ON m.user_id = u.id
     WHERE m.deleted_at IS NULL
     ORDER BY m.created_at DESC
     LIMIT ? OFFSET ?`
  ),
  count: db.prepare('SELECT COUNT(*) AS count FROM moments WHERE deleted_at IS NULL'),
  create: db.prepare(
    'INSERT INTO moments (user_id, content, image, created_at) VALUES (?, ?, ?, ?)'
  ),
  softDelete: db.prepare(
    'UPDATE moments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
  ),
  findById: db.prepare('SELECT user_id FROM moments WHERE id = ? AND deleted_at IS NULL'),
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
  countForPostList: db.prepare(
    'SELECT post_id, COUNT(*) AS count FROM post_likes GROUP BY post_id'
  ),
  // 某用户名下所有已发布文章收获的点赞总数
  totalReceivedByAuthor: db.prepare(
    `SELECT COUNT(*) AS count FROM post_likes l
     JOIN posts p ON l.post_id = p.id
     WHERE p.author_id = ? AND p.status = 'approved'`
  ),
};

// ---- 收藏相关查询 ----
export const bookmarkQueries = {
  find: db.prepare('SELECT id FROM post_bookmarks WHERE user_id = ? AND post_id = ?'),
  add: db.prepare('INSERT INTO post_bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)'),
  remove: db.prepare('DELETE FROM post_bookmarks WHERE user_id = ? AND post_id = ?'),
  countForPost: db.prepare('SELECT COUNT(*) AS count FROM post_bookmarks WHERE post_id = ?'),
  countForPostList: db.prepare(
    'SELECT post_id, COUNT(*) AS count FROM post_bookmarks GROUP BY post_id'
  ),
  totalReceivedByAuthor: db.prepare(
    `SELECT COUNT(*) AS count FROM post_bookmarks b
     JOIN posts p ON b.post_id = p.id
     WHERE p.author_id = ? AND p.status = 'approved'`
  ),
  // 某用户收藏的全部文章（用于个人主页「我的收藏」Tab）
  listByUser: db.prepare(
    `SELECT p.id, p.slug, p.title, p.description, p.created_at,
            u.username AS author_name, b.created_at AS bookmarked_at
     FROM post_bookmarks b
     JOIN posts p ON p.id = b.post_id
     JOIN users u ON p.author_id = u.id
     WHERE b.user_id = ? AND p.deleted_at IS NULL AND p.status = 'approved'
     ORDER BY b.created_at DESC`
  ),
};

// ---- 关注相关查询 ----
export const followQueries = {
  find: db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?'),
  add: db.prepare('INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)'),
  remove: db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?'),
  countFollowers: db.prepare('SELECT COUNT(*) AS count FROM follows WHERE following_id = ?'),
  countFollowing: db.prepare('SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?'),
  // 我关注的人最近发布的文章（动态流）
  feed: db.prepare(
    `SELECT p.id, p.slug, p.title, p.description, p.created_at, p.pinned_at,
            u.username AS author_name
     FROM follows f
     JOIN posts p ON p.author_id = f.following_id
     JOIN users u ON u.id = f.following_id
     WHERE f.follower_id = ? AND p.status = 'approved' AND p.deleted_at IS NULL
     ORDER BY (p.pinned_at IS NULL), p.pinned_at DESC, p.created_at DESC
     LIMIT 60`
  ),
};

// ---- 通知相关查询 ----
export type NotificationType =
  | 'comment'
  | 'comment_like'
  | 'post_like'
  | 'new_follow'
  | 'avatar_approved'
  | 'avatar_rejected';

export const notificationQueries = {
  // 内部 helper：检查是否已有未读的同类型通知（避免"反复点赞再取消"造成刷屏）
  _hasUnread: db.prepare(
    `SELECT id FROM notifications
     WHERE user_id = ? AND actor_id = ? AND type = ?
       AND ((? IS NULL AND post_id IS NULL) OR post_id = ?)
       AND ((? IS NULL AND comment_id IS NULL) OR comment_id = ?)
       AND read_at IS NULL
     LIMIT 1`
  ),
  _add: db.prepare(
    `INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, content, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
  ),
  // 对外封装：自动去重 + 自己不通知自己
  create: (opts: {
    userId: number;
    actorId: number;
    type: NotificationType;
    postId?: number | null;
    commentId?: number | null;
    content?: string | null;
  }) => {
    if (!opts.userId || !opts.actorId) return;
    if (opts.userId === opts.actorId) return; // 不通知自己
    const pid = opts.postId ?? null;
    const cid = opts.commentId ?? null;
    const exist = notificationQueries._hasUnread.get(
      opts.userId, opts.actorId, opts.type, pid, pid, cid, cid
    ) as { id: number } | undefined;
    if (exist) return;
    notificationQueries._add.run(
      opts.userId, opts.actorId, opts.type, pid, cid, opts.content ?? null, Date.now()
    );
  },
  listByUser: db.prepare(
    `SELECT n.*, u.username AS actor_name, p.slug AS post_slug, p.title AS post_title
     FROM notifications n
     LEFT JOIN users u ON u.id = n.actor_id
     LEFT JOIN posts p ON p.id = n.post_id
     WHERE n.user_id = ?
     ORDER BY (n.read_at IS NULL) DESC, n.created_at DESC
     LIMIT 100`
  ),
  unreadCount: db.prepare(
    'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL'
  ),
  markAllRead: db.prepare(
    'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL'
  ),
  markRead: db.prepare(
    'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL'
  ),
};

// ---- 评论举报相关查询 ----
export const reportQueries = {
  // 同一用户对同一评论只能举报一次（UNIQUE 约束 + INSERT OR IGNORE）
  add: db.prepare(
    `INSERT OR IGNORE INTO comment_reports (comment_id, reporter_id, reason, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)`
  ),
  find: db.prepare(
    'SELECT id FROM comment_reports WHERE comment_id = ? AND reporter_id = ?'
  ),
  remove: db.prepare(
    'DELETE FROM comment_reports WHERE comment_id = ? AND reporter_id = ? AND status = ?'
  ),
  pendingList: db.prepare(
    `SELECT r.id, r.reason, r.created_at, r.status,
            r.comment_id, c.content AS comment_content, c.post_id, c.user_id AS comment_user_id,
            cu.username AS comment_author,
            r.reporter_id, ru.username AS reporter_name,
            p.slug AS post_slug, p.title AS post_title
     FROM comment_reports r
     JOIN comments c ON c.id = r.comment_id
     JOIN users cu ON cu.id = c.user_id
     JOIN users ru ON ru.id = r.reporter_id
     LEFT JOIN posts p ON p.id = c.post_id
     WHERE r.status = 'pending'
     ORDER BY r.created_at ASC`
  ),
  findById: db.prepare('SELECT * FROM comment_reports WHERE id = ?'),
  resolve: db.prepare(
    `UPDATE comment_reports SET status = ?, handler_id = ?, handled_at = ? WHERE id = ? AND status = 'pending'`
  ),
  pendingCount: db.prepare(
    'SELECT COUNT(*) AS count FROM comment_reports WHERE status = ?'
  ),
  // 当前用户对该评论列表中哪些 comment 举报过（避免重复举报按钮）
  reportedByUser: (userId: number, ids: number[]) => {
    if (!ids.length) return [] as { comment_id: number }[];
    const qs = ids.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT comment_id FROM comment_reports WHERE reporter_id = ? AND comment_id IN (${qs})`
      )
      .all(userId, ...ids) as { comment_id: number }[];
  },
};

// ---- 评论相关查询 ----
export const commentQueries = {
  create: db.prepare(
    'INSERT INTO comments (post_id, user_id, content, created_at, parent_id, reply_to_user_id) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  findByPost: db.prepare(
    `SELECT c.id, c.content, c.created_at, c.user_id, u.username, u.avatar, c.parent_id, c.reply_to_user_id,
            (SELECT username FROM users WHERE id = c.reply_to_user_id) AS reply_to_username,
            IFNULL(rc.cnt, 0) AS reply_count,
            IFNULL(cl.cnt, 0) AS like_count
     FROM comments c
     JOIN users u ON c.user_id = u.id
     LEFT JOIN (SELECT parent_id, COUNT(*) AS cnt FROM comments WHERE deleted_at IS NULL AND hidden_at IS NULL GROUP BY parent_id) rc ON rc.parent_id = c.id
     LEFT JOIN (SELECT comment_id, COUNT(*) AS cnt FROM comment_likes GROUP BY comment_id) cl ON cl.comment_id = c.id
     WHERE c.post_id = ? AND c.deleted_at IS NULL AND c.hidden_at IS NULL
     ORDER BY c.created_at DESC`
  ),
  findThreadedByPost: (postId: number, sort: 'hot' | 'new' = 'hot') => {
    const top = db.prepare(
      `SELECT c.id, c.content, c.created_at, c.user_id, u.username, u.avatar, c.parent_id, c.reply_to_user_id,
              (SELECT username FROM users WHERE id = c.reply_to_user_id) AS reply_to_username,
              IFNULL(cl.cnt, 0) AS like_count
       FROM comments c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN (SELECT comment_id, COUNT(*) AS cnt FROM comment_likes GROUP BY comment_id) cl ON cl.comment_id = c.id
       WHERE c.post_id = ? AND c.parent_id IS NULL AND c.deleted_at IS NULL AND c.hidden_at IS NULL
       ORDER BY ${sort === 'hot' ? 'like_count DESC, c.created_at DESC' : 'c.created_at DESC'}`
    ).all(postId) as any[];
    const replies = db.prepare(
      `SELECT c.id, c.content, c.created_at, c.user_id, u.username, u.avatar, c.parent_id, c.reply_to_user_id,
              (SELECT username FROM users WHERE id = c.reply_to_user_id) AS reply_to_username,
              IFNULL(cl.cnt, 0) AS like_count
       FROM comments c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN (SELECT comment_id, COUNT(*) AS cnt FROM comment_likes GROUP BY comment_id) cl ON cl.comment_id = c.id
       WHERE c.post_id = ? AND c.parent_id IS NOT NULL AND c.deleted_at IS NULL AND c.hidden_at IS NULL
       ORDER BY c.created_at ASC`
    ).all(postId) as any[];
    const byParent = new Map<number, any[]>();
    for (const r of replies) {
      if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []);
      byParent.get(r.parent_id)!.push(r);
    }
    for (const t of top) t.replies = byParent.get(t.id) || [];
    return top;
  },
  findById: db.prepare(
    `SELECT c.*, u.username FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?`
  ),
  countForPost: db.prepare('SELECT COUNT(*) AS count FROM comments WHERE post_id = ? AND deleted_at IS NULL AND hidden_at IS NULL'),
  countForPostList: db.prepare(
    'SELECT post_id, COUNT(*) AS count FROM comments WHERE deleted_at IS NULL AND hidden_at IS NULL GROUP BY post_id'
  ),
  totalReceivedByAuthor: db.prepare(
    `SELECT COUNT(*) AS count FROM comments c
     JOIN posts p ON c.post_id = p.id
     WHERE p.author_id = ? AND p.status = 'approved' AND c.deleted_at IS NULL AND c.hidden_at IS NULL`
  ),
  likeFind: db.prepare('SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?'),
  likeAdd: db.prepare('INSERT INTO comment_likes (user_id, comment_id, created_at) VALUES (?, ?, ?)'),
  likeRemove: db.prepare('DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?'),
  likeCountForList: db.prepare(
    'SELECT comment_id, COUNT(*) AS count FROM comment_likes GROUP BY comment_id'
  ),
  // 某用户点过赞的评论 id 集合（列表渲染时高亮用，避免逐条查询）
  likedByUser: (userId: number, ids: number[]) => {
    if (!ids.length) return [] as { comment_id: number }[];
    const qs = ids.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT comment_id FROM comment_likes WHERE user_id = ? AND comment_id IN (${qs})`
      )
      .all(userId, ...ids) as { comment_id: number }[];
  },
  softDelete: db.prepare('UPDATE comments SET deleted_at = ? WHERE id = ? AND user_id = ?'),
  hide: db.prepare('UPDATE comments SET hidden_at = ? WHERE id = ?'),
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
  // UPSERT 自建行：省去先 ensureUv 的额外语句
  bumpPv: db.prepare(
    `INSERT INTO site_stats (date, pv, uv) VALUES (?, 1, 0)
     ON CONFLICT(date) DO UPDATE SET pv = pv + 1`
  ),
  bumpUv: db.prepare(
    `INSERT INTO site_stats (date, pv, uv) VALUES (?, 1, 1)
     ON CONFLICT(date) DO UPDATE SET uv = uv + 1`
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

// ---- 系列相关查询 ----
function seriesSlugify(title: string, authorId: number): string {
  const base = title
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40) || 'series';
  return `${base}-${authorId}-${Date.now().toString(36)}`;
}

export const seriesQueries = {
  listAll: db.prepare(
    `SELECT s.*, u.username AS author_name,
            (SELECT COUNT(*) FROM post_series ps
             JOIN posts p ON p.id = ps.post_id
             WHERE ps.series_id = s.id AND p.status = 'approved' AND p.deleted_at IS NULL) AS post_count
     FROM series s
     JOIN users u ON s.author_id = u.id
     ORDER BY s.updated_at DESC`
  ),
  listByAuthor: db.prepare(
    `SELECT s.*, u.username AS author_name,
            (SELECT COUNT(*) FROM post_series ps
             JOIN posts p ON p.id = ps.post_id
             WHERE ps.series_id = s.id AND p.status = 'approved' AND p.deleted_at IS NULL) AS post_count
     FROM series s
     JOIN users u ON s.author_id = u.id
     WHERE s.author_id = ?
     ORDER BY s.updated_at DESC`
  ),
  findBySlug: db.prepare(
    `SELECT s.*, u.username AS author_name FROM series s
     JOIN users u ON s.author_id = u.id
     WHERE s.slug = ?`
  ),
  findById: db.prepare('SELECT * FROM series WHERE id = ?'),
  create: db.prepare(
    'INSERT INTO series (slug, title, description, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  update: db.prepare(
    'UPDATE series SET title = ?, description = ?, updated_at = ? WHERE id = ? AND author_id = ?'
  ),
  postsOfSeries: db.prepare(
    `SELECT p.id, p.slug, p.title, p.description, p.created_at, p.status,
            ps.order_in_series, u.username AS author_name
     FROM post_series ps
     JOIN posts p ON p.id = ps.post_id
     JOIN users u ON p.author_id = u.id
     WHERE ps.series_id = ? AND p.deleted_at IS NULL
     ORDER BY ps.order_in_series ASC, p.created_at ASC`
  ),
  approvedPostsOfSeries: db.prepare(
    `SELECT p.id, p.slug, p.title, p.description, p.created_at,
            ps.order_in_series, u.username AS author_name
     FROM post_series ps
     JOIN posts p ON p.id = ps.post_id
     JOIN users u ON p.author_id = u.id
     WHERE ps.series_id = ? AND p.status = 'approved' AND p.deleted_at IS NULL
     ORDER BY ps.order_in_series ASC, p.created_at ASC`
  ),
  forPost: db.prepare(
    `SELECT s.*, ps.order_in_series,
            (SELECT COUNT(*) FROM post_series ps2
             JOIN posts p2 ON p2.id = ps2.post_id
             WHERE ps2.series_id = s.id AND p2.status = 'approved' AND p2.deleted_at IS NULL) AS total
     FROM post_series ps
     JOIN series s ON s.id = ps.series_id
     WHERE ps.post_id = ?`
  ),
  neighbors: (seriesId: number, orderInSeries: number) => {
    const prev = db.prepare(
      `SELECT p.id, p.slug, p.title, p.status, ps.order_in_series
       FROM post_series ps
       JOIN posts p ON p.id = ps.post_id
       WHERE ps.series_id = ? AND ps.order_in_series < ? AND p.deleted_at IS NULL
         AND p.status = 'approved'
       ORDER BY ps.order_in_series DESC LIMIT 1`
    ).get(seriesId, orderInSeries) as any;
    const next = db.prepare(
      `SELECT p.id, p.slug, p.title, p.status, ps.order_in_series
       FROM post_series ps
       JOIN posts p ON p.id = ps.post_id
       WHERE ps.series_id = ? AND ps.order_in_series > ? AND p.deleted_at IS NULL
         AND p.status = 'approved'
       ORDER BY ps.order_in_series ASC LIMIT 1`
    ).get(seriesId, orderInSeries) as any;
    return { prev, next };
  },
  setForPost: (postId: number, seriesId: number | null | undefined, order: number | null | undefined) => {
    const del = db.prepare('DELETE FROM post_series WHERE post_id = ?');
    const upsert = db.prepare(
      'INSERT OR REPLACE INTO post_series (post_id, series_id, order_in_series) VALUES (?, ?, ?)'
    );
    if (!seriesId) {
      del.run(postId);
      return;
    }
    const s = seriesQueries.findById.get(seriesId) as any;
    if (!s) {
      del.run(postId);
      return;
    }
    let finalOrder = Number.isFinite(order as number) ? Number(order) : null;
    if (finalOrder == null || finalOrder <= 0) {
      const row = db.prepare(
        `SELECT COALESCE(MAX(order_in_series), 0) + 1 AS next_order
         FROM post_series WHERE series_id = ?`
      ).get(seriesId) as { next_order: number };
      finalOrder = row.next_order;
    }
    upsert.run(postId, seriesId, finalOrder);
  },
  ensureByAuthor: (
    authorId: number,
    opts: { id?: number | null; newTitle?: string; newDesc?: string }
  ): { id: number | null; error?: string } => {
    const { id, newTitle, newDesc } = opts;
    if (id && id > 0) {
      const existing = seriesQueries.findById.get(id) as any;
      if (!existing) return { id: null, error: '系列不存在' };
      if (existing.author_id !== authorId) return { id: null, error: '无权限使用该系列' };
      return { id: existing.id };
    }
    const title = (newTitle || '').trim();
    if (!title) return { id: null };
    const now = Date.now();
    const slug = seriesSlugify(title, authorId);
    const r = seriesQueries.create.run(slug, title, (newDesc || '').trim() || null, authorId, now, now);
    return { id: Number(r.lastInsertRowid) };
  },
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
  avatar_pending?: string | null;
  avatar_status?: 'approved' | 'pending' | 'rejected';
  avatar_pending_at?: number | null;
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

// ---- 每日自动备份 ----
// 使用 SQLite online backup（db.backup），WAL 模式下可安全在线执行；
// 文件按日期命名，保留最近 BACKUP_KEEP 份。可用 DISABLE_DB_BACKUP=1 关闭。
async function runDailyBackup(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const target = join(BACKUP_DIR, `blog-${stamp}.db`);
  try {
    if (existsSync(target)) return; // 当天已备份
    await db.backup(target);
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => /^blog-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort();
    while (files.length > BACKUP_KEEP) {
      const oldest = files.shift();
      if (oldest) {
        try {
          unlinkSync(join(BACKUP_DIR, oldest));
        } catch {}
      }
    }
    console.log(`[db-backup] 已备份: ${target}`);
  } catch (err) {
    console.error('[db-backup] 备份失败:', err);
  }
}

if (process.env.DISABLE_DB_BACKUP !== '1') {
  void runDailyBackup();
  // 每 6 小时检查一次：新的一天 + 服务长时间不重启时也能按天滚动
  setInterval(() => void runDailyBackup(), 6 * 60 * 60 * 1000).unref();
}

// ---- 定时发布调度器：每 60s 把到点的 scheduled 文章转 approved ----
function publishDuePosts(): void {
  try {
    const now = Date.now();
    const due = postQueries.listDueScheduled.all(now) as { id: number }[];
    for (const row of due) {
      postQueries.updateStatus.run('approved', now, row.id);
      console.log(`[scheduler] 定时文章已发布: #${row.id}`);
    }
  } catch (err) {
    console.error('[scheduler] 定时发布检查失败:', err);
  }
}
publishDuePosts();
setInterval(publishDuePosts, 60 * 1000).unref();

export type Message = {
  id: number;
  sender_id: number;
  receiver_id: number;
  content: string;
  is_read: number;
  created_at: number;
};
