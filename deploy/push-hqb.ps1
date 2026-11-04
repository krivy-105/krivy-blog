# 一键发布后勤指南站点到乌班图
# 用法：
#   .\deploy\push-hqb.ps1                      用桌面源码目录的 index.html
#   .\deploy\push-hqb.ps1 -Source <文件路径>    指定别的文件
#
# 做的事：上传 index.html + 图片 → 调用服务器上的 hqb-publish（会校验/重载 nginx/自检）

param(
    [string]$Source = 'D:\OneDrive\桌面\后勤指南站点源码\index.html',
    [string]$ImageSource = 'D:\OneDrive\桌面\后勤指南站点源码\数据\高明医务室实景图.jpg',
    [string]$SshHost = 'ubuntu'
)

$ErrorActionPreference = 'Stop'
$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host "===============================================" -ForegroundColor DarkCyan
Write-Host " 发布后勤指南 → hqb.krivy.cyou" -ForegroundColor DarkCyan
Write-Host "===============================================" -ForegroundColor DarkCyan

if (-not (Test-Path $Source)) { Write-Host "找不到源文件: $Source" -ForegroundColor Red; exit 1 }
$kb = [math]::Round((Get-Item $Source).Length / 1KB, 1)
Write-Host ""
Write-Host "[1/3] 上传 index.html（$kb KB）" -ForegroundColor Cyan
& scp -q -i "$env:USERPROFILE\.ssh\id_ed25519" -o BatchMode=yes $Source "${SshHost}:/tmp/hqb-index.html"
if ($LASTEXITCODE -ne 0) { Write-Host "    上传失败" -ForegroundColor Red; exit 1 }
Write-Host "    ✓ 已上传" -ForegroundColor Green

$hasImage = Test-Path $ImageSource
if ($hasImage) {
    Write-Host "[2/3] 上传配图" -ForegroundColor Cyan
    & scp -q -i "$env:USERPROFILE\.ssh\id_ed25519" -o BatchMode=yes $ImageSource "${SshHost}:/tmp/medical-room.jpg"
    if ($LASTEXITCODE -eq 0) { Write-Host "    ✓ 已上传" -ForegroundColor Green }
} else {
    Write-Host "[2/3] 跳过配图（源文件不存在）" -ForegroundColor DarkGray
}

Write-Host "[3/3] 发布并自检" -ForegroundColor Cyan
$cmd = 'sudo hqb-publish /tmp/hqb-index.html'
if ($hasImage) {
    $cmd += ' && sudo cp /tmp/medical-room.jpg /opt/hqb-site/medical-room.jpg && sudo chown www-data:www-data /opt/hqb-site/medical-room.jpg'
}
$cmd += ' && rm -f /tmp/hqb-index.html /tmp/medical-room.jpg'

# sudo 密码不入库：
#   ① 设了环境变量 KRIVY_SUDO_PASS → 从 stdin 管道喂给 sudo -S，全程非交互
#   ② 没设 → 让 ssh 分配终端（-t），sudo 在本机终端提示输入，密码不落盘
$sudoPass = $env:KRIVY_SUDO_PASS
if ($sudoPass) {
    $remote = "echo '$sudoPass' | $cmd"
    $result = & ssh -i "$env:USERPROFILE\.ssh\id_ed25519" -o BatchMode=yes $SshHost $remote 2>&1
} else {
    $result = & ssh -t -i "$env:USERPROFILE\.ssh\id_ed25519" $SshHost $cmd 2>&1
}
$result | Where-Object { $_ -notmatch 'password for' } | ForEach-Object { Write-Host "    $_" }

$r = & curl.exe -sS -o NUL -m 40 -w "%{http_code}|%{time_total}s" 'https://hqb.krivy.cyou/' 2>$null
Write-Host ""
Write-Host "    线上: $r" -ForegroundColor $(if ($r -match '^200') { 'Green' } else { 'Yellow' })

$sw.Stop()
Write-Host ""
Write-Host " 完成，用时 $([math]::Round($sw.Elapsed.TotalSeconds,1)) 秒" -ForegroundColor Green
Write-Host " 提示：CF 缓存 10 分钟自动刷新，要立刻生效就去后台 Purge。" -ForegroundColor DarkGray
