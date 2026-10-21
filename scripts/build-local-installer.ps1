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

# 分析模型的运行时(MNN)要用 CMake 3.24 以上从源码编译。没有就下载官方的免安装压缩包,解压到 build\.tools(不需要 winget、不需要管理员)
function Find-CMake {
    $tool = Join-Path (Get-Location) 'build\.tools\cmake\bin'
    if ((Test-Path "$tool\cmake.exe") -and ($env:Path -notlike "*$tool*")) { $env:Path = "$tool;$env:Path" }
    foreach ($dir in "$env:ProgramFiles\CMake\bin", "${env:ProgramFiles(x86)}\CMake\bin") {
        if ((Test-Path "$dir\cmake.exe") -and ($env:Path -notlike "*$dir*")) { $env:Path += ";$dir" }
    }
    return [bool](Get-Command cmake -ErrorAction SilentlyContinue)
}
if (-not (Find-CMake)) {
    $version = '3.31.6'
    $zip = Join-Path $env:TEMP "cmake-$version.zip"
    $tools = Join-Path (Get-Location) 'build\.tools'
    Write-Host "没找到 CMake,下载免安装版 $version (约 40 MB)..." -ForegroundColor Yellow
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    $params = @{ Uri = "https://github.com/Kitware/CMake/releases/download/v$version/cmake-$version-windows-x86_64.zip"; OutFile = $zip; UseBasicParsing = $true }
    if ($Proxy) { $params.Proxy = $Proxy }
    Invoke-WebRequest @params
    New-Item -ItemType Directory -Force $tools | Out-Null
    Remove-Item -Recurse -Force "$tools\cmake" -ErrorAction SilentlyContinue
    Expand-Archive -Path $zip -DestinationPath $tools -Force
    Rename-Item "$tools\cmake-$version-windows-x86_64" 'cmake'
    Remove-Item $zip -Force
    if (-not (Find-CMake)) { throw 'CMake 下载解压后仍找不到。请手动到 https://cmake.org/download/ 下载 Windows x64 zip,解压到 build\.tools\cmake(里面要有 bin\cmake.exe)后重跑' }
}
Write-Host "CMake: $(cmake --version | Select-Object -First 1)"

Write-Host "分支: $(git rev-parse --abbrev-ref HEAD)  提交: $(git rev-parse --short HEAD)"

if ($ReinstallDeps -or -not (Test-Path 'node_modules\.bin\tsc.cmd')) {
    # 上一次中断的 node / electron 进程会占着 node_modules 里的 .node 文件,npm 删不掉(EPERM)
    Stop-Process -Name node, electron, esbuild -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Write-Host "`n=== npm ci ===" -ForegroundColor Cyan
    npm ci
    if ($LASTEXITCODE -ne 0) {
        Write-Host '第一次 npm ci 失败,清掉 node_modules 后重试一次(装了一半的目录常常导致 EPERM)' -ForegroundColor Yellow
        Stop-Process -Name node, electron, esbuild -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        if (Test-Path 'node_modules') { Remove-Item -Recurse -Force 'node_modules' -ErrorAction SilentlyContinue }
        if (Test-Path 'node_modules') {
            throw 'node_modules 删不掉,还有程序在占用它。请把项目目录加进 Windows Defender 排除项,关掉打开该目录的窗口,或重启电脑后重跑'
        }
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci 重试仍失败,请看上面的报错(下载 GitHub 上的依赖不通时加 -Proxy)' }
    }
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
