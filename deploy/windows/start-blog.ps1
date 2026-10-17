# 启动博客 + Cloudflare 隧道（Windows / 免费方案）
#
# 用法：右键「使用 PowerShell 运行」，或在终端里：
#   powershell -ExecutionPolicy Bypass -File .\start-blog.ps1
#
# 逻辑：
#   1. 从仓库根的 .env 读取 ADMIN_PASSWORD（不设会被 db.ts 覆写成 admin123456）
#   2. 后台起 node server.mjs，等 /healthz 就绪
#   3. 前台跑 cloudflared：有具名隧道配置就用它（地址固定），否则开临时隧道（地址每次变）
#   4. Ctrl+C 退出时把 node 一起收掉

$ErrorActionPreference = 'Stop'

# deploy\windows -> 仓库根
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Port = if ($env:PORT) { $env:PORT } else { '4321' }

function Say($msg) { Write-Host "[blog] $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }

# ---------- 1. 读取 .env ----------
$envFile = Join-Path $Root '.env'
if (Test-Path $envFile) {
  Get-Content $envFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
    Set-Item -Path "env:$k" -Value $v
  }
  Say "已从 .env 载入环境变量"
}

if (-not $env:ADMIN_PASSWORD) {
  Warn "没有 ADMIN_PASSWORD！db.ts 会把库里的管理员密码覆写成 admin123456。"
  Warn "请先在仓库根创建 .env，内容一行：ADMIN_PASSWORD=你的密码"
  Warn "按 Ctrl+C 中止，或回车继续（不推荐）"
  Read-Host | Out-Null
}

$env:PORT = $Port
if (-not $env:NODE_ENV) { $env:NODE_ENV = 'production' }

# ---------- 2. 起 node ----------
$cloudflared = Join-Path $Root 'cloudflared.exe'
if (-not (Test-Path $cloudflared)) {
  throw "找不到 cloudflared.exe。放到 $Root 下，或改这里的路径。"
}

Say "启动服务（端口 $Port）…"
$node = Start-Process -FilePath 'node' -ArgumentList 'server.mjs' `
  -WorkingDirectory $Root -PassThru -NoNewWindow

try {
  # 等就绪
  $ready = $false
  for ($i = 1; $i -le 30; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 3 -UseBasicParsing
      if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 2 }
  }
  if (-not $ready) { Warn "两分钟内没等到 /healthz，继续开隧道试试" }
  else { Say "服务已就绪：http://127.0.0.1:$Port" }

  # ---------- 3. 起隧道 ----------
  $namedConfig = Join-Path $env:USERPROFILE '.cloudflared\config.yml'
  if (Test-Path $namedConfig) {
    Say "检测到具名隧道配置，使用固定地址（Ctrl+C 停止）"
    & $cloudflared tunnel --no-autoupdate run
  } else {
    Warn "没有具名隧道配置，使用临时地址（每次重启都会变）"
    Warn "要固定地址：cloudflared tunnel login → tunnel create → tunnel route dns"
    & $cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$Port"
  }
}
finally {
  if ($node -and -not $node.HasExited) {
    Say "停止服务进程"
    Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue
  }
}
