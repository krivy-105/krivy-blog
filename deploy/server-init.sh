#!/usr/bin/env bash
# ============================================================
# Oracle Cloud（或任意 Ubuntu/Debian 服务器）一键初始化
#
# 用法：
#   curl -fsSLO https://raw.githubusercontent.com/krivy-105/krivy-blog/main/deploy/server-init.sh
#   chmod +x server-init.sh
#   DOMAIN=krivy.cyou EMAIL=you@example.com sudo -E ./server-init.sh
#
# 可选环境变量：
#   APP_DIR=/opt/krivy-blog     代码与数据目录
#   ADMIN_PASSWORD=xxx          不传则自动生成一个强密码并打印一次
#   REPO_URL=...                默认用官方仓库地址
#   SKIP_CADDY=1                只装应用、不配 HTTPS（自己已有反代时用）
#
# 脚本可重复执行：已装的不会重装，已有的 .env 不会被覆盖。
# ============================================================

set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
APP_DIR="${APP_DIR:-/opt/krivy-blog}"
REPO_URL="${REPO_URL:-https://github.com/krivy-105/krivy-blog.git}"
SKIP_CADDY="${SKIP_CADDY:-0}"

log()  { printf '\033[1;36m[init]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[err ]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 前置检查 ----------
[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo -E ./server-init.sh"
[ -n "$DOMAIN" ] || die "必须指定域名，例如：DOMAIN=krivy.cyou sudo -E ./server-init.sh"
[ -n "$EMAIL" ] || EMAIL="admin@$DOMAIN"

command -v apt-get >/dev/null || die "此脚本针对 Debian/Ubuntu（apt）。其他发行版请手动装 Docker + Caddy。"

export DEBIAN_FRONTEND=noninteractive

# ---------- 1. 基础依赖 ----------
log "更新软件源并安装基础依赖"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg tar openssl ufw >/dev/null

# ---------- 1.5 交换分区 ----------
# AMD micro 实例只有 1GB 内存，而构建阶段要跑 Astro 打包 + g++ 编译
# better-sqlite3，峰值经常超过 1GB。没有 swap 的话 npm run build 会被
# OOM killer 直接杀掉（表现为构建莫名退出，很难看出原因）。
if [ -f /swapfile ]; then
  log "swap 已存在，跳过"
elif [ "$(swapon --show=NAME --noheadings 2>/dev/null | wc -l)" -gt 0 ]; then
  log "已有交换分区，跳过"
else
  log "创建 2G 交换分区（防止构建期 OOM）"
  if ! fallocate -l 2G /swapfile 2>/dev/null; then
    dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  fi
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "交换分区已启用：$(free -h | awk '/Swap/{print $2}')"
fi

# ---------- 2. Docker ----------
if command -v docker >/dev/null 2>&1; then
  log "Docker 已安装：$(docker --version)"
else
  log "安装 Docker（官方脚本）"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

if docker compose version >/dev/null 2>&1; then
  log "compose 插件就绪"
elif command -v docker-compose >/dev/null 2>&1; then
  warn "只有旧版 docker-compose，下面统一用 docker-compose"
  alias_dc="docker-compose"
else
  die "没有 compose 插件，请先安装 docker-compose-plugin"
fi
DC="${alias_dc:-docker compose}"

# ---------- 3. 防火墙放行 80/443 ----------
# 这一条最容易踩坑：OCI 的 Ubuntu 镜像自带 iptables 规则，末尾一条 REJECT ALL，
# 只放行了 22。云控制台的安全列表放行了也没用，本机 iptables 照样拦。
log "放行 80 / 443"

open_port() {
  local port="$1"
  # ufw
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "${port}/tcp" >/dev/null 2>&1 || true
    return
  fi
  # firewalld（Oracle Linux / CentOS 系）
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -q running; then
    firewall-cmd --permanent --add-port="${port}/tcp" >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    return
  fi
  # 纯 iptables：插到 INPUT 最前面，压过末尾的 REJECT
  if command -v iptables >/dev/null 2>&1; then
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
    if command -v ip6tables >/dev/null 2>&1; then
      ip6tables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
        || ip6tables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT 2>/dev/null || true
    fi
  fi
}

open_port 80
open_port 443

if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save >/dev/null 2>&1 || true
  log "iptables 规则已持久化"
else
  warn "没有 netfilter-persistent，重启后 iptables 规则可能丢失（可装 iptables-persistent）"
fi

# ---------- 4. 拉代码 ----------
if [ -d "$APP_DIR/.git" ]; then
  log "更新已有仓库：$APP_DIR"
  # 用 FETCH_HEAD 而不是 origin/main：浅克隆 + fetch 指定分支时，
  # remote-tracking ref 是否更新取决于 refspec 配置，FETCH_HEAD 一定是对的。
  git -C "$APP_DIR" fetch --depth 1 origin main
  git -C "$APP_DIR" reset --hard FETCH_HEAD
else
  log "克隆仓库到 $APP_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ---------- 5. 环境变量 ----------
if [ -f .env ]; then
  log ".env 已存在，保留不动（如需改密码请编辑 $APP_DIR/.env 后重启容器）"
else
  ADMIN_PASS="${ADMIN_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)}"
  cat > .env <<EOF
# 由 deploy/server-init.sh 生成于 $(date '+%F %T')
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=${ADMIN_PASS}
SESSION_COOKIE=blog_session
EOF
  chmod 600 .env
  log "已生成 .env"
  printf '\n\033[1;32m  管理员账号: %s\033[0m\n' "${ADMIN_USERNAME:-admin}"
  printf '\033[1;32m  管理员密码: %s\033[0m\n' "$ADMIN_PASS"
  printf '\033[1;33m  （请立刻保存到密码管理器，此密码只显示这一次）\033[0m\n\n'
fi

# compose 里 ADMIN_PASSWORD 用的是必填语法 ${ADMIN_PASSWORD:?...}，
# 缺了会报一句很难懂的 "required variable is missing"。这里提前拦下来。
if ! grep -Eq '^ADMIN_PASSWORD=.+' .env; then
  die "$APP_DIR/.env 里没有有效的 ADMIN_PASSWORD，请编辑该文件补上后重新运行本脚本"
fi

# ---------- 6. 构建并启动 ----------
log "构建镜像并启动容器（首次约 3–6 分钟，better-sqlite3 要编译）"
$DC up -d --build

log "等待应用就绪"
READY=0
for _ in $(seq 1 60); do
  if curl -fsS -m 3 http://127.0.0.1:4321/healthz >/dev/null 2>&1; then READY=1; break; fi
  sleep 3
done
if [ "$READY" -eq 1 ]; then
  log "应用已就绪：http://127.0.0.1:4321"
else
  warn "等了两分钟仍没起来，用这个看日志：cd $APP_DIR && $DC logs --tail=80"
fi

# ---------- 7. Caddy 自动 HTTPS ----------
if [ "$SKIP_CADDY" = "1" ]; then
  log "SKIP_CADDY=1，跳过 Caddy 配置"
else
  if command -v caddy >/dev/null 2>&1; then
    log "Caddy 已安装"
  else
    log "安装 Caddy（官方源）"
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
  fi

  log "写入 Caddyfile（域名 $DOMAIN）"
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__EMAIL__|$EMAIL|g" \
    "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile

  mkdir -p /var/log/caddy
  chown -R caddy:caddy /var/log/caddy 2>/dev/null || true

  # 先校验再重启：Caddyfile 语法错的话 systemctl restart 会失败，
  # 而 set -e 会让整个脚本在装配份那步之前就退出。
  if caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    systemctl enable caddy >/dev/null 2>&1 || true
    systemctl restart caddy
    log "Caddy 已重启，正在等待证书（约 10–60 秒）"

    # 证书是首个请求时才申请的，这里探一下能否走通 HTTPS
    CERT_OK=0
    for _ in $(seq 1 20); do
      if curl -fsS -m 5 "https://$DOMAIN/healthz" >/dev/null 2>&1; then CERT_OK=1; break; fi
      sleep 3
    done
    if [ "$CERT_OK" -eq 1 ]; then
      log "HTTPS 已可用：https://$DOMAIN"
    else
      warn "HTTPS 还没通。常见原因：域名未解析到本机、DNS 仍开着云朵（要灰云）、云端安全列表没放行 443"
      warn "排查：systemctl status caddy --no-pager；journalctl -u caddy -n 50"
    fi
  else
    warn "Caddyfile 校验失败，已跳过 Caddy 重启。手动看错误：caddy validate --config /etc/caddy/Caddyfile"
  fi
fi

# ---------- 8. 每日离机备份 ----------
log "安装每日备份（04:17 执行，保留 7 份）"
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/krivy-backup
cat > /etc/cron.d/krivy-backup <<EOF
# 由 deploy/server-init.sh 安装
17 4 * * * root APP_DIR=$APP_DIR /usr/local/bin/krivy-backup >> /var/log/krivy-backup.log 2>&1
EOF

# ---------- 9. 收尾提示 ----------
cat <<EOF

============================================================
 初始化完成
============================================================

应用目录      $APP_DIR
数据目录      $APP_DIR/data      （数据库 / 上传图 / 自动备份都在这）
管理员密码    $APP_DIR/.env
容器日志      cd $APP_DIR && $DC logs -f
备份日志      /var/log/krivy-backup.log

还能做的三件事（请按顺序）：

1) 【控制台】放行云防火墙
   Oracle 控制台 → 实例 → 主 VCN → 安全列表 → 添加入站规则
   源 0.0.0.0/0，协议 TCP，端口 80 和 443
   （本机 iptables 已放行，但云端安全列表是另一层，两层都要开）

2) 【DNS】先把域名解析到本机公网 IP，并且
   ⚠️ 云朵图标关掉（DNS only / 灰云）
   否则 Let's Encrypt 的 HTTP-01 校验会被 Cloudflare 拦截，证书申请失败。
   拿到证书后再打开小云朵也不影响。

3) 【数据】把旧平台的 blog.db 灌进来
   ⚠️ 必须先停容器再覆盖，运行中的 SQLite 被 cp 覆盖会拿到损坏的库
   cd $APP_DIR
   $DC stop
   mkdir -p data
   cp /path/to/blog-YYYY-MM-DD.db data/blog.db
   $DC start

验证清单（任何一条不对就别切流量）：
   curl -I https://$DOMAIN/            返回 200
   curl -s https://$DOMAIN/healthz     返回 {"status":"ok","uptime":...}
   登录后台「下载备份」能拿到新库
   上传一张说说配图 → $DC restart → 图还在（证明卷挂对了）
   发一条私信能实时收到（证明 WebSocket 通了）

EOF
