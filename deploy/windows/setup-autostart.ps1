# 注册开机自启（免管理员权限）
#
# 用法：powershell -ExecutionPolicy Bypass -File .\setup-autostart.ps1
# 卸载：powershell -ExecutionPolicy Bypass -File .\setup-autostart.ps1 -Remove
#
# 原理：写 HKCU 的 Run 键，用户登录时以隐藏窗口启动 start-blog.ps1。
# 不需要管理员，也不装服务。

param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$startScript = Join-Path $PSScriptRoot 'start-blog.ps1'
$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$regName = 'KrivyBlog'

if ($Remove) {
  if (Get-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $regPath -Name $regName
    Write-Host "已移除开机自启：$regName" -ForegroundColor Green
  } else {
    Write-Host "没有找到自启项：$regName" -ForegroundColor Yellow
  }
  return
}

if (-not (Test-Path $startScript)) { throw "找不到启动脚本：$startScript" }

$cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`""
New-ItemProperty -Path $regPath -Name $regName -Value $cmd -PropertyType String -Force | Out-Null

Write-Host "已注册开机自启：$regName" -ForegroundColor Green
Write-Host "  启动命令: $cmd"
Write-Host ""
Write-Host "注意几点：" -ForegroundColor Yellow
Write-Host "  1. 只在你「登录 Windows 后」才启动，不是开机就起（免管理员方案的限制）"
Write-Host "  2. 建议把休眠关掉，否则电脑睡着站就断："
Write-Host "       powercfg /change standby-timeout-ac 0"
Write-Host "       powercfg /change hibernate-timeout-ac 0"
Write-Host "  3. 现在想立刻启动一次：在仓库根执行 start-blog.ps1，或重启后自动起"
