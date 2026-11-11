# 交接说明 · my-blog

> 给新会话用。读完这份就知道项目在哪、怎么改、怎么发、别踩什么坑。
> 最后更新：2026-11-05

---

## 一句话说明

这是个自建的博客站 + 两个附带站点，跑在佛山家里的一台乌班图机器上，靠 Cloudflare 隧道对外提供服务（因为校园网没有公网 IP）。

## 代码在哪

```
D:\my-blog                 ← 仓库（2026-11-05 从 C 盘迁过来的）
```

千万别再去 `C:\Users\Airfa\my-blog`，**那个目录已经删了**。

## 线上有哪些站

| 域名 | 是什么 | 后台 |
|---|---|---|
| `krivy.cyou` | 主站（博客） | `/admin` |
| `qd.krivy.cyou` | 签到台（Trae / WorkBuddy / Qoder） | `/login` |
| `hqb.krivy.cyou` | 学校后勤服务指南 | 静态页，无后台 |

`more.krivy.cyou` **已于 2026-11-05 彻底下线**（服务、DNS、隧道、cron 全删，备份在服务器 `/root/more-teardown-20261105-092936/`）。

## 服务器

```
连接      ssh ubuntu            （密钥免密，Tailscale 内网 100.97.175.15）
用户      krivy（sudo + docker 组）
sudo 密码  见本机 D:\my-blog\.local-credentials.md（不入库；仓库里不再写明文）
目录      /opt/krivy-blog       （容器 krivy-blog → 127.0.0.1:4321）
凭据      D:\my-blog\.local-credentials.md（不进仓库）
```

## 怎么发布

**没有 CI，没有 GitHub Actions**（校园网连不上）。全靠本地构建 + 传 dist：

```powershell
cd D:\my-blog
.\deploy\push.ps1          # 构建 → 打包 → scp → 换 dist → 重启容器 → 自检
```

全流程约 25 秒，结束会打印三个页面状态码。

后勤站是另一个脚本：

```powershell
.\deploy\push-hqb.ps1      # 需要 sudo 密码（交互输入，或设 $env:KRIVY_SUDO_PASS）
```

### 关键：改完 dist 必须重启容器

```bash
docker compose restart     # SSR 代码是进程启动时加载的
```

只换 dist 不重启 → 页面还是旧的。

### 绝对不要做的事

```
✗ docker compose up --build      没有 Docker Hub，拉不到基础镜像
✗ 用 sudo 跑 docker               krivy 在 docker 组里，不需要
✗ 把密码 / .env / 凭据文件提交到 git
✗ push 到公开仓库时把 scripts 里的一次性脚本带上（历史上栽过）
```

## 数据在哪

```
线上库    /opt/krivy-blog/data/blog.db     （SQLite，容器内挂载为 /data/blog.db）
本地副本  D:\my-blog\data\blog.db
每日备份  服务器 04:17 自动打包，保留 7 份
```

改数据库的稳妥方式：**用容器里的 node + better-sqlite3**，不要直接 `sqlite3` 写文本（历史上踩过 BLOB 类型坑，插入中文会变成二进制）。

```bash
docker cp 脚本.cjs krivy-blog:/tmp/x.cjs
docker exec krivy-blog node /tmp/x.cjs
```

## 缓存怎么生效

```
静态资源      max-age=604800, s-maxage=2592000, immutable
HTML         max-age=300, s-maxage=600, stale-while-revalidate=86400
```

CF 边缘缓存 **10 分钟**。改完看不到效果，要么等 10 分钟，要么后台 Purge。

## 最近的变更（2026-11-04 ~ 11-05）

```
仓库        C:\Users\Airfa\my-blog → D:\my-blog
more 站     彻底下线
qd 签到     每天 08:10 → 10:00（crontab，服务器上）
服务器密码  见 .local-credentials.md（不入库；本文件不再写明文）
后勤站      上线，数据按学校官网核对过（原资料 20 多个电话是假的）
主站        手机排版修好、图标统一、动效层、更新日志精简到 12 条
```

## 已知遗留

```
桌面工作区的会话列表   记录 38 个，磁盘上只有 6 个
                      下次 DSH 重启会自动按磁盘重建（不用手改）
会话库                 ~/.dsh/sessions，共 8 个会话，17.6 MB
```

## 出问题先看哪里

```bash
ssh ubuntu
docker ps                                  # 容器活着没
docker logs --tail 50 krivy-blog           # 应用日志
systemctl status cloudflared-krivy         # 隧道通不通
journalctl -u cloudflared-krivy -n 30      # 隧道日志
systemctl status nginx                     # 后勤站的 nginx
```

外网打不开但容器正常 → 大概率是隧道或 DNS：

```bash
sudo cloudflared tunnel --config /etc/cloudflared-krivy/config.yml ingress validate
```

## 服务器上几个关键文件

```
/opt/krivy-blog/.env                        管理员账号密码（启动时覆写数据库）
/etc/cloudflared-krivy/config.yml           隧道 ingress（域名 → 本地端口）
/etc/cloudflared-krivy/                     证书
/www/server/panel/vhost/nginx/*.conf        宝塔的 nginx 站点配置
/usr/local/bin/hqb-publish                  后勤站发布脚本（带校验和 reload）
/usr/local/bin/krivy-backup                 备份脚本
```

## 隧道端口对照

```
krivy.cyou / www / test  →  127.0.0.1:4321   博客
qd.krivy.cyou            →  127.0.0.1:8788   签到（signin-all）
hqb.krivy.cyou           →  127.0.0.1:8088   后勤站 nginx
其余                      →  404
```

---

## 给 agent 的提醒

1. **改内容用数据库，改样式用构建** —— 文章/评论/友链在 `blog.db`，模板样式在 `src/`
2. **写文章标题不要带技术术语** —— 这个站的读者是学生，更新日志要"说人话"
3. **用户喜欢直接动手，不喜欢先问一堆** —— 但破坏性操作（删数据、改密码、下线服务）先备份
4. **测完要验证线上** —— `curl -I` 看状态码，别只看本地构建成功
5. **发布后 CF 有 10 分钟缓存**，别反复重发以为没生效
