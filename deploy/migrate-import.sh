#!/usr/bin/env bash
# 在【新服务器】上执行：从迁移包恢复整个站点
#
# 用法：
#   DOMAIN=krivy.cyou EMAIL=你的邮箱 ./migrate-import.sh /root/krivy-migrate-xxxx.tar.gz
#
# 做哪些事：
#   1. 2G swap（1-2G 内存的机器构建 better-sqlite3 会 OOM）
#   2. 装 Docker + compose 插件
#   3. 解包，拉代码
#   4. 还原数据库/上传图/头像/课表脚本/密钥
#   5. 构建并启动，轮询 /healthz
#   6. 装 Caddy，申请证书
#   7. 装备份 cron 与课表同步 cron
#   8. 全项自检并打印清单
set -euo pipefail

TARBALL="${1:-}"
if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then
  echo "用法: DOMAIN=krivy.cyou EMAIL=you@example.com $0 /root/krivy-migrate-xxxx.tar.gz"
  exit 1
fi

DOMAIN="${DOMAIN:-krivy.cyou}"
EMAIL="${EMAIL:-admin@${DOMAIN}}"
APP=/opt/krivy-blog
REPO="${REPO:-https://github.com/krivy-105/krivy-blog.git}"
WORK=/root/_migrate_work

log() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
ok()  { printf '   \033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '   \033[1;33m!\033[0m %s\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "请用 root 执行"; exit 1; }

log "0. 环境检查"
. /etc/os-release
ok "系统 $PRETTY_NAME $(uname -m)"
MEM_MB=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo)
ok "内存 ${MEM_MB}MB"
df -h / | tail -1 | awk '{print "   磁盘 已用"$3" 可用"$4" ("$5")"}'

# ---------- 1. swap ----------
log "1. 交换分区（防构建 OOM）"
if [ "$MEM_MB" -lt 3000 ] && [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "已建 2G swap"
else
  ok "跳过（内存够或已有 swap）"
fi

# ---------- 2. docker ----------
log "2. Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
  ok "Docker 已安装"
else
  ok "Docker 已存在：$(docker --version)"
fi
docker compose version >/dev/null 2>&1 && ok "compose 可用：$(docker compose version | head -1)"

# 放行 80/443（OCI 等镜像默认 iptables 末尾 REJECT）
if command -v iptables >/dev/null 2>&1; then
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 80 -j ACCEPT
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true
  ok "本机 80/443 已放行"
fi

# ---------- 3. 解包 ----------
log "3. 解包迁移包"
rm -rf "$WORK"; mkdir -p "$WORK"
tar -xzf "$TARBALL" -C "$WORK"
ok "已解包到 $WORK"
[ -f "$WORK/MANIFEST.txt" ] && sed 's/^/     /' "$WORK/MANIFEST.txt"

# ---------- 4. 代码 ----------
log "4. 拉取代码"
if [ -d "$APP/.git" ]; then
  cd "$APP" && git fetch --depth 1 origin main && git reset --hard FETCH_HEAD
  ok "已更新到 $(git log --oneline -1)"
else
  mkdir -p "$(dirname "$APP")"
  git clone --depth 1 "$REPO" "$APP"
  cd "$APP" && ok "已克隆 $(git log --oneline -1)"
fi

# ---------- 5. 还原数据 ----------
log "5. 还原数据"
mkdir -p "$APP/data"
# 关键：先清掉可能存在的 WAL/SHM，否则旧 WAL 会回放覆盖刚放进去的库
rm -f "$APP/data/blog.db-wal" "$APP/data/blog.db-shm"
cp -f "$WORK/blog.db" "$APP/data/blog.db"
ok "数据库 blog.db ($(du -h "$APP/data/blog.db" | cut -f1))"

for d in uploads avatars jwc; do
  if [ -d "$WORK/data/$d" ]; then
    rm -rf "$APP/data/$d"
    cp -a "$WORK/data/$d" "$APP/data/"
    ok "data/$d"
  fi
done

# .env（含 ADMIN_PASSWORD / SESSION_COOKIE / SCHEDULE_TOKEN）
if [ -f "$WORK/env.backup" ]; then
  cp -f "$WORK/env.backup" "$APP/.env"
  chmod 600 "$APP/.env"
  ok ".env 已还原（密钥沿用旧的）"
else
  warn "迁移包里没有 .env，将使用默认值，需要手动设置密码"
fi
[ -f "$APP/data/jwc/.jwc-session.json" ] && chmod 600 "$APP/data/jwc/.jwc-session.json"

# ---------- 6. 构建启动 ----------
log "6. 构建并启动"
cd "$APP"
docker compose up -d --build 2>&1 | tail -4
printf '   等待就绪'
for i in $(seq 1 60); do
  if curl -fsS -m 3 http://127.0.0.1:4321/healthz >/dev/null 2>&1; then
    printf '\n'; ok "服务已就绪"; break
  fi
  printf '.'; sleep 2
done
curl -fsS http://127.0.0.1:4321/healthz && echo

# ---------- 7. Caddy ----------
log "7. 反向代理与证书"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  ok "Caddy 已安装：$(caddy version)"
fi

# 用仓库里的模板渲染（迁移包里的 Caddyfile 是旧的，域名可能不同）
if [ -f "$APP/deploy/Caddyfile" ]; then
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__EMAIL__|$EMAIL|g" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
  ok "已按模板生成 /etc/caddy/Caddyfile（$DOMAIN / $EMAIL）"
elif [ -f "$WORK/Caddyfile" ]; then
  cp -f "$WORK/Caddyfile" /etc/caddy/Caddyfile
  warn "用迁移包里的 Caddyfile（域名若变了需手动改）"
fi

if [ -f /etc/caddy/Caddyfile ]; then
  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && ok "Caddyfile 语法通过" || warn "Caddyfile 校验失败，看 caddy validate 输出"
  mkdir -p /var/log/caddy
  touch /var/log/caddy/access.log
  chown -R caddy:caddy /var/log/caddy
  chmod 640 /var/log/caddy/access.log
  systemctl enable caddy >/dev/null 2>&1 || true
  systemctl restart caddy
  sleep 4
  systemctl is-active caddy >/dev/null && ok "caddy 运行中" || warn "caddy 起不来，journalctl -u caddy -n 50"
fi

# ---------- 8. cron ----------
log "8. 定时任务"
if [ -f "$WORK/cron-backup" ]; then
  cp -f "$WORK/cron-backup" /etc/cron.d/krivy-backup
  chmod 644 /etc/cron.d/krivy-backup
  ok "每日备份 cron"
fi
if grep -q 'data/jwc/sync.sh' "$WORK/crontab.txt" 2>/dev/null; then
  ( crontab -l 2>/dev/null | grep -v 'data/jwc/sync.sh'; grep 'data/jwc/sync.sh' "$WORK/crontab.txt" ) | crontab -
  ok "课表同步 cron（每 20 分钟）"
fi
[ -x "$APP/data/jwc/sync.sh" ] && chmod +x "$APP/data/jwc/sync.sh"

# ---------- 9. 自检 ----------
log "9. 自检"
echo "   容器："
docker ps --format '     {{.Names}} | {{.Status}}' --filter name=krivy-blog
echo "   数据："
docker compose exec -T blog node -e "
const D=require('better-sqlite3');
const db=new D('/data/blog.db',{readonly:true});
console.log('     完整性 '+JSON.stringify(db.prepare('PRAGMA integrity_check').get()));
const q=s=>db.prepare(s).get().c;
console.log('     用户='+q('select count(*) c from users')+' 文章='+q('select count(*) c from posts')+' 课表='+q('select count(*) c from schedule_courses'));
db.close();" 2>/dev/null || warn "数据库自检失败"
echo "   本机 HTTP：$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:4321/ || echo 失败)"

echo ""
echo "======================================================"
echo " 恢复完成。剩下必须由人做的一步：切 DNS"
echo ""
echo "   Cloudflare → krivy.cyou → DNS → 把 A 记录改成新服务器 IP"
echo "   小云朵保持灰色（DNS only），否则证书签不下来"
echo ""
echo " 切完验证："
echo "   curl -I https://$DOMAIN/                     # 200"
echo "   curl -s https://$DOMAIN/healthz               # ok"
echo "   curl -s https://$DOMAIN/api/schedule | head -c 200"
echo ""
echo " 证书自检（绕开 DNS 直接连本机，避免旧站应答造成假阳性）："
echo "   curl -sS --resolve $DOMAIN:443:127.0.0.1 https://$DOMAIN/healthz"
echo "======================================================"
