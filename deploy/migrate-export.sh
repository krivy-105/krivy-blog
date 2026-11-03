#!/usr/bin/env bash
# 在【旧服务器】上执行：把站点完整打包，供新服务器一键恢复
#
# 关键：不能直接拷 data/blog.db —— 它旁边有数 MB 的 blog.db-wal，
# 说明还有大量事务只在 WAL 里。直接拷主库会丢这些数据。
# 正确做法是用 SQLite 的在线备份 API 生成一致快照。
set -euo pipefail

APP=/opt/krivy-blog
STAMP=$(date +%Y%m%d_%H%M%S)
OUT="/root/krivy-migrate-$STAMP.tar.gz"
WORK="/tmp/krivy-migrate-$STAMP"

echo "== 1. 生成数据库一致快照 =="
cd "$APP"
docker compose exec -T blog node -e "const D=require('better-sqlite3');const db=new D('/data/blog.db',{readonly:true});db.backup('/data/_migrate_tmp.db').then(()=>{db.close();console.log('  SNAPSHOT_OK')}).catch(e=>{console.error(e);process.exit(1)})"

echo "== 2. 校验快照（不能省，校验不过就别搬）=="
docker compose exec -T blog node -e "
const D=require('better-sqlite3');
const db=new D('/data/_migrate_tmp.db',{readonly:true});
console.log('  完整性: '+JSON.stringify(db.prepare('PRAGMA integrity_check').get()));
const q=s=>db.prepare(s).get().c;
console.log('  用户='+q('select count(*) c from users')
  +' 文章='+q('select count(*) c from posts')
  +' 评论='+q('select count(*) c from comments')
  +' 标签='+q('select count(*) c from tags')
  +' 课表='+q('select count(*) c from schedule_courses'));
db.close();"

echo "== 3. 准备打包目录 =="
rm -rf "$WORK"; mkdir -p "$WORK/data"
mv -f "$APP/data/_migrate_tmp.db" "$WORK/blog.db"
ls -lh "$WORK/blog.db" | sed 's/^/   /'

echo "== 4. 收集文件 =="
for d in uploads avatars jwc; do
  if [ -d "$APP/data/$d" ]; then
    cp -a "$APP/data/$d" "$WORK/data/"
    echo "   data/$d ($(du -sh "$APP/data/$d" | cut -f1))"
  fi
done

echo "== 5. 收集配置（含密钥，注意保密）=="
cp -a "$APP/.env" "$WORK/env.backup"; echo "   .env"
[ -f /etc/caddy/Caddyfile ] && cp -a /etc/caddy/Caddyfile "$WORK/Caddyfile" && echo "   Caddyfile"
[ -f /etc/cron.d/krivy-backup ] && cp -a /etc/cron.d/krivy-backup "$WORK/cron-backup" && echo "   备份 cron"
crontab -l > "$WORK/crontab.txt" 2>/dev/null || echo "" > "$WORK/crontab.txt"

echo "== 6. 记录版本信息 =="
{
  echo "打包时间: $(date '+%F %T %Z')"
  echo "git HEAD: $(cd "$APP" && git log --oneline -1)"
  echo "docker:   $(docker --version)"
  echo "compose:  $(docker compose version | head -1)"
  echo "宿主:     $(. /etc/os-release && echo "$PRETTY_NAME") $(uname -m)"
} > "$WORK/MANIFEST.txt"
sed 's/^/   /' "$WORK/MANIFEST.txt"

echo "== 7. 打包 =="
tar -czf "$OUT" -C "$WORK" .
chmod 600 "$OUT"
rm -rf "$WORK"
ls -lh "$OUT" | sed 's/^/   /'
echo "   内含："
tar -tzf "$OUT" | sed 's/^/     /'

echo ""
echo "======================================================"
echo " 完成：$OUT"
echo ""
echo " 下一步（在你电脑上，下载下来）："
echo "   pscp -pw <密码> root@<旧IP>:$OUT ./"
echo "======================================================"
