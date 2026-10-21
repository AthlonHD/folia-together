# scripts/build-local-installer.ps1
# 在本机一键打出 Windows 安装包(安装版 + 免安装版),步骤与 .github/workflows/together-installer.yml 一致。
# 用法(在仓库根目录的 PowerShell 里):
#   powershell -ExecutionPolicy Bypass -File scripts\build-local-installer.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\build-local-installer.ps1 -Proxy http://127.0.0.1:7890   # 下载依赖要走代理时
#   加 -ReinstallDeps 强制重新 npm ci;加 -SkipRust 跳过三个 Rust 组件(Spotify 代理播放、壁纸、直通播放不会更新)。
param(
    [string]$Proxy = '',
    [switch]$ReinstallDeps,
    [switch]$SkipRust
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step([string]$title, [scriptblock]$run) {
    Write-Host "`n=== $title ===" -ForegroundColor Cyan
    & $run
    if ($LASTEXITCODE -ne 0) { throw "失败: $title (退出码 $LASTEXITCODE)" }
}

if ($Proxy) {
    $env:HTTP_PROXY = $Proxy
    $env:HTTPS_PROXY = $Proxy
    Write-Host "下载依赖走代理: $Proxy"
}

foreach ($tool in 'node', 'npm', 'git') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "没找到 $tool,请先安装" }
}
if (-not $SkipRust -and -not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw '没找到 cargo(Rust)。先装 rustup 和 MSVC 生成工具,或加 -SkipRust 跳过 Rust 组件'
}

Write-Host "分支: $(git rev-parse --abbrev-ref HEAD)  提交: $(git rev-parse --short HEAD)"

if ($ReinstallDeps -or -not (Test-Path 'node_modules\.bin\tsc.cmd')) {
    Step 'npm ci' { npm ci }
}
if (-not (Test-Path 'node_modules\.bin\tsc.cmd')) { throw '依赖没有装好(node_modules 里没有 tsc),请看上面 npm ci 的报错' }

if (-not $SkipRust) {
    Step '编译带代理的 Spotify 播放组件' { npm run build:librespot-proxy }
    Step '编译壁纸 helper' { npm run build:wallpaper-helper }
    Step '编译直通播放 helper' { npm run build:audio-helper }
}

$env:ELECTRON = 'true'
Step '构建前端' { npm run build }

$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Step '打包 Electron(第一次要编译分析模型运行时,需要几分钟)' { npx electron-builder --win nsis portable --x64 --publish never }

Write-Host "`n完成。安装包在:" -ForegroundColor Green
Get-ChildItem release -Filter '*.exe' | ForEach-Object { Write-Host "  $($_.FullName)  ($([math]::Round($_.Length / 1MB)) MB)" }
