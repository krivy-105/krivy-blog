# 在自己电脑上跑（免费方案）

适合：不想付托管费，且能接受「电脑关机站就下线」。
配合那台 FTP 虚拟主机放静态镜像，就是一套零成本的完整方案。

## 目录里有什么

| 文件 | 作用 |
|---|---|
| `start-blog.ps1` | 起 node 服务 + Cloudflare 隧道（Ctrl+C 一起停） |
| `setup-autostart.ps1` | 注册开机自启（免管理员），`-Remove` 卸载 |
| 仓库根的 `cloudflared.exe` | 隧道客户端 |

## 第一次配置（一次性，约 10 分钟）

### 1. 准备 .env

在仓库根建 `.env`（已被 .gitignore 忽略）：

```
ADMIN_PASSWORD=你现在的管理员密码
```

> 不设这个，`db.ts` 启动时会把库里的管理员密码**覆写成 admin123456**。

### 2. 建具名隧道（让地址固定下来）

临时隧道的地址每次重启都变，绑自己的域名就不行了。具名隧道免费，且地址永久固定：

```powershell
cd C:\Users\Airfa\my-blog
.\cloudflared.exe tunnel login
```

浏览器会弹出 Cloudflare 登录页，选你的 `krivy.cyou` 授权。

```powershell
# 创建隧道，记下输出的 Tunnel ID
.\cloudflared.exe tunnel create krivy-blog

# 把域名指到这个隧道（会创建一条 CNAME，替换掉原来指向 Railway 的 A 记录）
.\cloudflared.exe tunnel route dns krivy-blog krivy.cyou
```

### 3. 写隧道配置

创建 `C:\Users\Airfa\.cloudflared\config.yml`（`<TUNNEL_ID>` 换成上一步的 ID）：

```yaml
tunnel: <TUNNEL_ID>
credentials-file: C:\Users\Airfa\.cloudflared\<TUNNEL_ID>.json

ingress:
  - hostname: krivy.cyou
    service: http://127.0.0.1:4321
  - service: http_status:404
```

### 4. 启动 + 设自启

```powershell
# 先手动跑一次，确认 https://krivy.cyou 能打开
powershell -ExecutionPolicy Bypass -File .\deploy\windows\start-blog.ps1

# 确认没问题后注册自启
powershell -ExecutionPolicy Bypass -File .\deploy\windows\setup-autostart.ps1
```

### 5. 关掉休眠（重要）

电脑睡眠 = 站下线：

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

## 日常维护

| 操作 | 命令 |
|---|---|
| 查看是否在跑 | 任务管理器里看 `node.exe` 和 `cloudflared.exe` |
| 手动重启 | 跑 `start-blog.ps1` |
| 取消自启 | `setup-autostart.ps1 -Remove` |
| 隧道日志 | cloudflared 窗口里的输出（或 `~\.cloudflared\*.log`） |

## 已知限制

| 限制 | 影响 | 缓解 |
|---|---|---|
| 关机/睡眠 = 站下线 | 访客 502 | FTP 虚拟主机放静态镜像做备胎 |
| 家庭宽带上行有限 | 图片多时慢 | 博客以文字为主，影响不大 |
| 登录后才自启 | 重启后没登录 = 站没起 | 别重启机器；或改成计划任务（要管理员） |
| 电脑 IP 变化 | 无影响 | 隧道是主动外连，不依赖家用 IP |

## 顺带说一句

这台机器同时也是**唯一一份活数据库**的所在地。`data\blog.db` 请定期拷到别处
（移动硬盘、网盘、U 盘都行）。这台电脑坏了，文章和用户就全没了——

后台每天会自动备份到 `data\backups\`（保留 7 份），但那只在同一块盘上。
