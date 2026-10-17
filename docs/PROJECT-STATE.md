# 项目状态交接（给未来的自己 / 新对话）

> 这份文档的目的：**新开一个对话时，第一句发「读 docs/PROJECT-STATE.md」，就能接上全部上下文。**
> 不含任何密码 —— 本仓库是公开的，凭据见文末 §9。

---

## 1. 这是什么

一个跑在自有 VPS 上的全栈个人博客，**不用任何托管平台**。

| | |
|---|---|
| 框架 | Astro 7 SSR（`output: 'server'`，`@astrojs/node` adapter，middleware 模式） |
| 运行时 | 自写 `server.mjs`（Node HTTP + `ws` WebSocket），非 serverless |
| 数据 | SQLite（`better-sqlite3`）+ FTS5 全文索引，**单文件** `/data/blog.db` |
| 鉴权 | bcrypt + session cookie（httpOnly / sameSite=lax） |
| 图片 | sharp（头像 256×256 WebP + 说说配图）+ 动态 OG 分享卡 |
| 部署 | Docker 多阶段构建 + docker compose，Caddy 反代自动 HTTPS |
| CI/CD | GitHub Actions，push 到 main 即自动 SSH 部署 |

**关键设计**：文章/评论/用户全在 SQLite 里（不是 Markdown 文件），所以标签、搜索、点赞、私信都是动态计算的。

---

## 2. 线上部署

```
域名        https://krivy.cyou
服务器      洛杉矶 VPS（Ubuntu 22.04 / 2 核 2G / KVM / 20G 盘）
部署目录    /opt/krivy-blog
数据目录    /opt/krivy-blog/data      ← bind mount 到容器 /data
  包括      blog.db（库）、uploads/（配图）、avatars/（头像）、backups/（每日快照）
反代        Caddy，配置 /etc/caddy/Caddyfile，证书 Let's Encrypt 自动续
容器名      krivy-blog（docker compose service: blog）
```

**注意**：DNS 在 Cloudflare，但**小云朵必须保持灰色（DNS only）**。
开着橙色云朵会导致 Let's Encrypt 的 HTTP-01 校验被 CF 接走，证书签不下来
（日志报 `Cannot negotiate ALPN protocol "acme-tls/1"`）。

---

## 3. 常用命令

```bash
# 登录服务器（用部署密钥，密码也在 §9）
ssh -i <你的私钥> root@<服务器 IP>

# 服务管理
cd /opt/krivy-blog
docker compose ps                      # 状态
docker compose logs -f                 # 日志
docker compose up -d --build           # 重建（改代码后）
docker compose up -d --force-recreate  # 改了 .env 后用这个，不是 restart
systemctl restart caddy                # 改 Caddyfile 后

# 数据核对（应与你旧站一致）
docker compose exec blog node -e "const D=require('better-sqlite3');const db=new D('/data/blog.db',{readonly:true});const q=s=>db.prepare(s).get().c;console.log('用户='+q('select count(*) c from users')+' 文章='+q('select count(*) c from posts'));db.close()"

# 备份
docker compose exec blog ls -lh /data/backups    # 应用每日自动备份，留 7 份
# 后台「💾 下载备份」可随时拉一份到本地
```

---

## 4. 代码结构要点

```
src/
├── lib/
│   ├── db.ts            1300+ 行：27 张表建模、全部 SQL、幂等迁移、一次性数据清理
│   ├── auth.ts          bcrypt、session、cookie
│   ├── markdown.ts      marked + sanitize-html（唯一的 Markdown 渲染入口）
│   ├── rate-limit.ts    登录/注册 IP 限流
│   └── preview-token.ts 草稿免登录预览（HMAC 签名）
├── middleware.ts        鉴权、CSP 等安全头、缓存策略、PV/UV 统计
├── pages/               29 个页面路由 + 42 个 API 端点
├── components/          15 个组件（Header/Footer/Avatar/Toast/命令面板…）
└── styles/global.css    设计系统（色彩变量、明暗双主题、组件基础样式）
server.mjs               HTTP + WebSocket 入口（/healthz、/ws、静态资源）
deploy/                  部署脚本（server-init.sh / Caddyfile / backup.sh / windows/）
docs/deploy.md           部署与迁移手册（含 11 条实战踩坑）
```

**注意 `src/lib/db.ts` 的两条硬规则**：
1. 启动时会用 `ADMIN_PASSWORD` 环境变量**覆写**库里的管理员密码（不一致就覆盖）
2. 文件里有一批 `runOnce('flag_v1', ...)` 一次性数据清理，用 `meta` 表打标记，只跑一次

---

## 5. 部署与自动部署

**首次部署**（换新机器时）：
```bash
curl -fsSLO https://raw.githubusercontent.com/krivy-105/krivy-blog/main/deploy/server-init.sh
chmod +x server-init.sh
DOMAIN=krivy.cyou EMAIL=你的邮箱 ./server-init.sh
```
脚本会：建 2G swap（防构建 OOM）→ 装 Docker → 放行 80/443 → 拉代码 →
生成 `.env` 随机强密码（只打印一次）→ 构建启动 → 装 Caddy 并申请证书 →
装每日备份 cron。

**日常部署**：`git push` 即可。`.github/workflows/deploy.yml` 会 SSH 进去
`git fetch` + `reset --hard` + `docker compose up -d --build` + 轮询 `/healthz`。

依赖三个 repo secret：`SSH_HOST` / `SSH_USER` / `SSH_PRIVATE_KEY`（已配好）。

---

## 6. 已知陷阱（都踩过，已写进 docs/deploy.md）

| 坑 | 一句话 |
|---|---|
| 复制新库后数据不对 | 旧库残留的 `blog.db-wal` 会被回放覆盖新数据 → 先 `rm -f data/blog.db-wal data/blog.db-shm` |
| 改 `.env` 密码不生效 | `docker compose restart` 不重读 .env → 必须 `up -d --force-recreate` |
| Caddy 起不来 | `access.log: permission denied`，光 chown 目录不够，要 `touch` 文件本身 |
| 证书签不下来 | DNS 云朵必须灰；且校验脚本要用 `--resolve` 强制连本机，否则会被旧站应答造成假阳性 |
| 密钥登录被拒 | 部分镜像写死 `PubkeyAuthentication no`，改 sshd_config 后 `systemctl reload ssh` |
| 构建莫名退出 | 1G 内存机器 OOM，脚本会自动加 2G swap |
| 灌库时容器在跑 | 必须 stop → 删 WAL → cp → start |

---

## 7. 待办

- [ ] **头像**：`/avatars/1`、`/avatars/3` 现在 404（文件在旧 Railway 卷里，没随 db 过来），登录后台重新上传即可
- [ ] **凭据分离**：服务器 root 密码与网站管理员密码相同，可考虑拆开并关掉 SSH 密码登录（密钥已验证可用）
- [ ] **本机 known_hosts**：清掉旧指纹 `ssh-keygen -R 156.238.248.210`
- [ ] 可选优化：文章详情页阅读体验（TOC 样式、代码块行号/复制按钮）
- [ ] 可选优化：写作/编辑表单控件统一

**已完成（勿重做）**：
- Railway → VPS 全量迁移，数据无损
- 学习计划栏目 `/plan` 与网安栏目 `/security` 已下线，相关标签已清理（一次性迁移已打标记）
- 全站 UI 一轮打磨：标签体系统一（默认/inline/lg）、14 个公开页卡片玻璃化、正文排版（斑马表格、锚点避让、标题平衡断行）
- 部署脚本三个坑已修（Caddy 日志权限、证书假阳性、WAL 覆盖）

---

## 8. 常用验证

```bash
curl -I https://krivy.cyou/                    # 200
curl -s https://krivy.cyou/healthz             # {"status":"ok","uptime":N}
curl -s https://krivy.cyou/rss.xml | head -5   # RSS 正常
```

页面自检清单位于 `docs/deploy.md` 末尾。

---

## 9. 凭据（不在本仓库）

本仓库是**公开的**，所以密码一律不写在这里。存放位置：

| 内容 | 在哪 |
|---|---|
| 网站管理员账号密码 | 服务器 `/opt/krivy-blog/.env`（`ADMIN_USERNAME` / `ADMIN_PASSWORD`） |
| 服务器 root 密码 | 你自己的密码管理器 |
| SSH 部署私钥 | GitHub repo secret `SSH_PRIVATE_KEY`；本机备份见密码管理器 |
| Cloudflare 账号 | 你自己的密码管理器 |

**注意**：`.env` 里的 `ADMIN_PASSWORD` 是权威值——服务每次启动都会用它覆写数据库里的密码。
所以改密码要改 `.env` 再 `up -d --force-recreate`，直接在后台改会被下次启动覆盖回去。
