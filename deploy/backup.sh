#!/usr/bin/env bash
# 每日离机备份：把应用自带的数据库快照 + 上传图打包留档
#
# 为什么不直接 tar 正在运行的 blog.db：
#   SQLite 在写入过程中被直接复制可能拿到撕裂的文件（下次打开报 malformed）。
#   应用自己用 better-sqlite3 的在线备份 API 每天产出 blog-YYYY-MM-DD.db，
#   那是事务一致的快照，直接拿它打包才是安全的。
#
# 用法：
#   ./deploy/backup.sh                       # 本地留档
#   RCLONE_REMOTE=oci:krivy-backup ./deploy/backup.sh    # 同时同步到对象存储

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/krivy-blog}"
DATA_DIR="$APP_DIR/data"
DEST="${DEST:-$APP_DIR/backups}"
KEEP="${KEEP:-7}"
STAMP="$(date +%F)"
ARCHIVE="$DEST/snapshot-$STAMP.tar.gz"

mkdir -p "$DEST"

# 找最新的数据库快照（由应用每天生成）
LATEST_DB="$(ls -1t "$DATA_DIR"/backups/blog-*.db 2>/dev/null | head -n 1 || true)"

if [ -z "$LATEST_DB" ]; then
  echo "[backup] 找不到 $DATA_DIR/backups/blog-*.db —— 应用可能还没跑起来，跳过"
  exit 0
fi

echo "[backup] 使用数据库快照: $LATEST_DB"

# 打包：数据库快照 + 上传图 + 头像（不含日志与旧备份，避免越滚越大）
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/db"
cp "$LATEST_DB" "$TMP_DIR/db/blog.db"

for sub in uploads avatars; do
  if [ -d "$DATA_DIR/$sub" ]; then
    cp -a "$DATA_DIR/$sub" "$TMP_DIR/" 2>/dev/null || true
  fi
done

tar -czf "$ARCHIVE" -C "$TMP_DIR" .
chmod 600 "$ARCHIVE"

echo "[backup] 已生成 $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# 只保留最近 KEEP 份
# 注意结尾的 || true：首次运行时目录里还没有旧档，ls 会返回非零，
# 配合 set -o pipefail 会让脚本中断，后面的 rclone 同步就被跳过了。
ls -1t "$DEST"/snapshot-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old"
  echo "[backup] 清理旧档: $old"
done || true

# 可选：同步到对象存储（Oracle 免费 20GB 够用很久）
if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  if rclone copy "$ARCHIVE" "$RCLONE_REMOTE"; then
    echo "[backup] 已同步到 $RCLONE_REMOTE"
  else
    echo "[backup][警告] 同步到 $RCLONE_REMOTE 失败（本地存档仍在）" >&2
  fi
fi
