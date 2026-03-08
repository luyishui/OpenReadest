param(
  [string]$CloudflaredPath = $env:CLOUDFLARED_BIN,
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

if (-not $CloudflaredPath) {
  $CloudflaredPath = 'cloudflared'
}

function Test-CommandExists {
  param([string]$CommandName)

  try {
    Get-Command $CommandName | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-CommandExists $CloudflaredPath) -and -not (Test-Path $CloudflaredPath)) {
  Write-Error "cloudflared 未找到。请先把它加入 PATH，或设置环境变量 CLOUDFLARED_BIN 指向 cloudflared.exe。"
}

$workspaceRoot = Resolve-Path (Join-Path $PSScriptRoot '..\\..')
$appDir = Resolve-Path (Join-Path $PSScriptRoot '..')

Write-Host "[OpenReadest] 启动本地 Web 调试服务 http://127.0.0.1:$Port"
$devCommand = "Set-Location '$appDir'; pnpm dev-web-public"
$devServer = Start-Process -FilePath powershell -ArgumentList '-NoExit', '-Command', $devCommand -WorkingDirectory $workspaceRoot -PassThru

Start-Sleep -Seconds 6

Write-Host "[OpenReadest] 启动 cloudflared 隧道"
$tunnelCommand = "Set-Location '$workspaceRoot'; & '$CloudflaredPath' tunnel --url http://127.0.0.1:$Port"
Start-Process -FilePath powershell -ArgumentList '-NoExit', '-Command', $tunnelCommand -WorkingDirectory $workspaceRoot | Out-Null

Write-Host "[OpenReadest] 本地服务 PID: $($devServer.Id)"
Write-Host '[OpenReadest] cloudflared 窗口会输出 trycloudflare 地址，手机可直接打开测试。'