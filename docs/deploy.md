# 部署与迁移手册

这个站是「一个 Docker 镜像 + 一个持久卷」的结构，所以换平台本质上就是：
**把镜像跑起来，再把一个卷挂到 `/data`。**

- 应用只从环境变量读 `PORT` 与 `DB_PATH`
- 数据库、上传图、自动备份全在 `dirname(DB_PATH)` 下，也就是卷里的 `/data`
- 私信走 WebSocket，因此**不能**用会自动休眠的方案（如 Render 免费实例、Cloudflare Workers）

---

## 第 0 步：先备份数据（任何迁移之前）

数据库在部署平台的持久卷里，**不在 Git 里**。迁平台前必须先把它拿到手：

1. 登录站点 → 右上角头像 → **管理后台**
2. 点「💾 下载备份」，得到一份 `blog-YYYY-MM-DD.db`
3. 另存到本地和网盘各一份

> 服务本身每天也会自动备份到 `data/backups/`（卷内保留最近 7 份），但那只在同一台机器上，
> 机器没了备份也就没了——所以这一步不能省。

---

## 方案 A：Fly.io（改动最小，最接近 Railway）

区域建议选东京 `nrt` / 新加坡 `sin` / 香港 `hkg`。

```bash
# 1. 安装并登录
curl -L https://fly.io/install.sh | sh
fly auth login

# 2. 创建应用（仓库里已有 fly.toml，会用它的配置）
fly launch --no-deploy

# 3. 建持久卷（区域要和 primary_region 一致）
fly volumes create blog_data --size 1 --region nrt

# 4. 设置环境变量
fly secrets set ADMIN_PASSWORD='你的强密码' ADMIN_USERNAME=admin

# 5. 部署
fly deploy

# 6. 看状态与日志
fly status
fly logs
```

**绑定域名**：`fly certs add krivy.cyou`，然后按它给的 DNS 记录去 Cloudflare 改。

---

## 方案 B：任意 Linux 服务器（国内访问最快）

香港/日本/新加坡的轻量服务器，国内 RTT 常在 30–60ms，比绕 Cloudflare 稳。

```bash
# 1. 装 Docker
curl -fsSL https://get.docker.com | sh

# 2. 拉代码
git clone https://github.com/krivy-105/krivy-blog.git && cd krivy-blog

# 3. 配置环境变量
cp .env.example .env
vim .env          # 必须改 ADMIN_PASSWORD

# 4. 起服务
docker compose up -d --build
docker compose logs -f    # 看到「博客服务器运行在」即可
```

**前面挂反向代理做 HTTPS**（二选一）

Caddy（自动申请证书，最省事）：

```
krivy.cyou {
    reverse_proxy 127.0.0.1:4321
}
```

Nginx（记得自己配证书）：

```nginx
server {
    listen 443 ssl http2;
    server_name krivy.cyou;

    ssl_certificate     /etc/letsencrypt/live/krivy.cyou/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/krivy.cyou/privkey.pem;

    client_max_body_size 20m;   # 上传图片

    location / {
        proxy_pass http://127.0.0.1:4321;
        proxy_http_version 1.1;
        # WebSocket 私信必须转发 Upgrade 头，否则长连接建立不起来
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 第 3 步：把备份放回去

数据库文件要落到卷里的 `/data/blog.db`。

**Fly.io**

```bash
# 把本地备份传到机器上（应用名与备份文件名按实际改）
fly ssh console -C "mkdir -p /data"
fly sftp shell
# 在 sftp 里执行： put "本地路径/blog-2026-10-17.db" /data/blog.db
```

**VPS + docker compose**

```bash
mkdir -p data
cp /path/to/blog-2026-10-17.db data/blog.db
docker compose restart
```

传完确认一下：

```bash
docker compose exec blog ls -lh /data    # 应能看到 blog.db、uploads/、avatars/
```

---

## 第 4 步：切 DNS

1. 先在**临时域名**上把站点跑通（Fly 的 `xxx.fly.dev`，或直接用服务器 IP + hosts）
2. 验完再改 Cloudflare 的解析记录指向新地址
3. 观察 24 小时没问题，再关掉旧平台

> 旧平台先别急着删——它上面的卷里有最新的 `blog.db`，是最后一道保险。

---

## 上线检查清单

逐条点一遍，任何一条不对都别切流量：

- [ ] `/` 首页 200，样式正常
- [ ] `/blog` 文章列表有内容，点进文章正文正常
- [ ] `/about` 更新日志能显示
- [ ] `/rss.xml`、`/sitemap-articles.xml` 返回 200
- [ ] `/healthz` 返回 ok
- [ ] 管理员能登录，后台「下载备份」能拿到新的 db
- [ ] 上传一张头像或一张说说配图，**重启容器后还在**（验证卷挂对了）
- [ ] 私信发一条，能实时收到（验证 WebSocket 与反代 Upgrade 头）

---

## 常见坑

| 现象 | 原因 |
|---|---|
| 重启后文章全没了 | 卷没挂到 `/data`，SQLite 落在容器临时层 |
| 管理员密码变回 admin123456 | 没设 `ADMIN_PASSWORD`，启动时会按默认值同步覆盖 |
| 文章日期差一天 | 没设 `TZ=Asia/Shanghai`，容器默认 UTC |
| 私信发不出去 | 反向代理没转发 `Upgrade` / `Connection` 头 |
| 上传图片失败 | 反向代理 `client_max_body_size` 太小 |
| 部署后 502 | 构建阶段的 `better-sqlite3` 没编译成功，看构建日志里的 python3/make/g++ |
