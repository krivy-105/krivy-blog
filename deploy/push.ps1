# 一键部署博客到乌班图服务器
# 用法：
#   .\deploy\push.ps1              构建 + 上传 + 重启（日常用这个）
#   .\deploy\push.ps1 -SkipBuild   只上传现有 dist（改完后端数据/样式不想重编时用）
#
# 前提：本机 ~/.ssh/config 里有 `Host ubuntu`，且已配免密密钥。

param(
    [switch]$SkipBuild,
    [string]$SshHost = 'ubuntu',
    [string]$RemoteDir = '/opt/krivy-blog'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$distDir = Join-Path $repo 'dist'
$tarball = Join-Path $env:TEMP 'krivy-dist.tar.gz'
$sw = [System.Diagnostics.Stopwatch]::StartNew()

function Step($n, $msg) {
    Write-Host ""
    Write-Host "[$n] $msg" -ForegroundColor Cyan
}
function Ok($msg) { Write-Host "    ✓ $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "    ✗ $msg" -ForegroundColor Red; exit 1 }

Write-Host "===============================================" -ForegroundColor DarkCyan
Write-Host " 部署博客 → $SshHost" -ForegroundColor DarkCyan
Write-Host "===============================================" -ForegroundColor DarkCyan

# ---------- 1. 构建 ----------
if ($SkipBuild) {
    Step '1/5' '跳过构建（-SkipBuild）'
    if (-not (Test-Path $distDir)) { Fail "dist 目录不存在，先去掉 -SkipBuild 跑一次完整构建" }
} else {
    Step '1/5' '构建'
    Push-Location $repo
    try {
        $out = npm run build 2>&1
        $out | Select-String -Pattern 'error|Error|Complete' | Select-Object -First 5 | ForEach-Object { Write-Host "    $($_.Line)" }
        if ($LASTEXITCODE -ne 0) { Fail '构建失败，看上面报错' }
    } finally { Pop-Location }
    Ok '构建完成'
}

# ---------- 2. 打包 ----------
Step '2/5' '打包 dist'
if (Test-Path $tarball) { Remove-Item $tarball -Force }
& tar -czf $tarball -C $distDir .
if ($LASTEXITCODE -ne 0) { Fail '打包失败' }
$mb = [math]::Round((Get-Item $tarball).Length / 1MB, 2)
Ok "打包完成 ${mb} MB"

# ---------- 3. 上传 ----------
Step '3/5' "上传到 $SshHost"
& scp -q -i "$env:USERPROFILE\.ssh\id_ed25519" -o BatchMode=yes $tarball "${SshHost}:/tmp/krivy-dist.tar.gz"
if ($LASTEXITCODE -ne 0) { Fail "上传失败（检查 ssh $SshHost 能不能连）" }
Ok '上传完成'

# ---------- 4. 切换并重启 ----------
Step '4/5' '切换目录并重启容器'
$remoteScript = @'
set -e
cd REMOTE_DIR
rm -rf dist.new && mkdir -p dist.new
tar -xzf /tmp/krivy-dist.tar.gz -C dist.new
rm -rf dist && mv dist.new dist
# 不吞输出：重启失败必须当场暴露（曾经因为 >/dev/null + 外层 rm 掩盖 exit code，
# .env 权限坏了导致 restart 没执行，部署脚本却显示成功）
docker compose restart
for i in $(seq 1 40); do
  if curl -fsS -m 3 http://127.0.0.1:4321/healthz >/dev/null 2>&1; then
    echo "READY"
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:4321/healthz || { echo "HEALTH_FAIL"; exit 1; }
rm -f /tmp/krivy-dist.tar.gz
'@ -replace 'REMOTE_DIR', $RemoteDir

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))
# 注意：bash 的 exit code 必须透传出来——用 rc 接住再 exit，
# 不能写成 `bash ...; rm ...`（rm 的 0 会把 bash 的失败盖掉）。
# ssh 命令用单引号拼，避免 PowerShell 双引号把远端要用的 $?/$rc 吃掉。
$sshCmd = 'echo ' + $b64 + ' | base64 -d > /tmp/_deploy.sh; bash /tmp/_deploy.sh; rc=$?; rm -f /tmp/_deploy.sh; exit $rc'
$result = & ssh -i "$env:USERPROFILE\.ssh\id_ed25519" -o BatchMode=yes $SshHost $sshCmd 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or -not ($result -match 'ok')) { Write-Host "    $result" -ForegroundColor Red; Fail '远端部署失败' }
Ok '容器已重启并健康'

# ---------- 5. 线上验证 ----------
Step '5/5' '线上验证'
$checks = @(
    @('博客首页', 'https://krivy.cyou/'),
    @('友链', 'https://krivy.cyou/links'),
    @('课表', 'https://krivy.cyou/schedule')
)
$allOk = $true
foreach ($c in $checks) {
    $r = & curl.exe -sS -o NUL -m 40 -w "%{http_code}|%{time_total}s" $c[1] 2>$null
    $code = ($r -split '\|')[0]
    if ($code -eq '200') { Write-Host ("    {0,-8} {1}" -f $c[0], $r) -ForegroundColor Green }
    else { Write-Host ("    {0,-8} {1}" -f $c[0], $r) -ForegroundColor Yellow; $allOk = $false }
}

$sw.Stop()
Write-Host ""
if ($allOk) {
    Write-Host " 完成，用时 $([math]::Round($sw.Elapsed.TotalSeconds,1)) 秒" -ForegroundColor Green
} else {
    Write-Host " 部署完成但线上检查有异常，看上面" -ForegroundColor Yellow
}
Write-Host ""
Write-Host " 提示：CF 边缘缓存 10 分钟后自动刷新；要立刻看到改动就后台 Purge 一次。" -ForegroundColor DarkGray
