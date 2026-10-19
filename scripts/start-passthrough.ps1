# scripts/start-passthrough.ps1
# One-click for pass-through mode (Windows desktop app). Works from nothing: it installs what is missing and fetches the code itself.
#   Git, Node.js 24+, Rust, Visual Studio Build Tools  ->  clone/update the repo  ->  npm deps  ->  Electron  ->  WASAPI helper  ->  device list  ->  app
#
# On a machine without the repository, paste this into PowerShell or cmd (nothing else is needed):
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/AthlonHD/folia-together/stage-remote/scripts/start-passthrough.ps1 | iex"
# Inside a clone it can also be run as scripts\start-passthrough.cmd [-BuildOnly] [-NoStart].
#   -BuildOnly  install tools, build the helper and list devices; no npm install, no app start
#   -NoStart    do everything except starting the app
param(
    [switch]$BuildOnly,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$repoUrl = 'https://github.com/AthlonHD/folia-together.git'
$branch = 'stage-remote'
$cloneDir = Join-Path $env:USERPROFILE 'folia-together'
$temp = Join-Path $env:TEMP 'folia-passthrough-setup'
New-Item -ItemType Directory -Force $temp | Out-Null

function Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }

# A tool installed a moment ago is not on this session's PATH yet: rebuild PATH from the registry.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $cargo = Join-Path $env:USERPROFILE '.cargo\bin'
    $env:Path = "$machine;$user;$cargo"
}

function Test-Command($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Get-NodeMajor {
    if (-not (Test-Command 'node')) { return 0 }
    return [int]((node --version).TrimStart('v').Split('.')[0])
}

# Downloads a file and refuses it unless Windows says it is signed by the expected publisher.
function Get-SignedInstaller($url, $fileName, $publisher) {
    $path = Join-Path $temp $fileName
    Write-Host "   downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing
    $signature = Get-AuthenticodeSignature $path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike "*$publisher*") {
        throw "$fileName is not signed by $publisher (status: $($signature.Status)); refusing to run it."
    }
    return $path
}

# rustup-init.exe carries no Authenticode signature; its integrity is checked against the SHA-256 that rust-lang.org publishes beside it.
function Get-HashedInstaller($url, $fileName) {
    $path = Join-Path $temp $fileName
    Write-Host "   downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing
    $body = (Invoke-WebRequest -Uri "$url.sha256" -UseBasicParsing).Content
    if ($body -is [byte[]]) { $body = [Text.Encoding]::ASCII.GetString($body) }
    $published = ($body -split '\s+')[0].Trim().ToLower()
    $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
    if ($published -ne $actual) { throw "$fileName does not match the SHA-256 published by rust-lang.org; refusing to run it." }
    return $path
}

function Install-Git {
    Step 'Installing Git'
    if (Test-Command 'winget') {
        winget install --id Git.Git --silent --accept-package-agreements --accept-source-agreements
    } else {
        $release = Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'folia-passthrough-setup' }
        $asset = $release.assets | Where-Object { $_.name -match '^Git-.*-64-bit\.exe$' } | Select-Object -First 1
        if (-not $asset) { throw 'Could not find the Git for Windows installer.' }
        $exe = Get-SignedInstaller $asset.browser_download_url 'git-installer.exe' 'Johannes Schindelin'
        Start-Process -FilePath $exe -ArgumentList '/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-' -Verb RunAs -Wait
    }
    Update-SessionPath
    $gitCmd = Join-Path $env:ProgramFiles 'Git\cmd'
    if (-not (Test-Command 'git') -and (Test-Path $gitCmd)) { $env:Path = "$env:Path;$gitCmd" }
    if (-not (Test-Command 'git')) { throw 'Git is still not available after the install. Open a new terminal and run this script again.' }
}

function Install-Node {
    Step 'Installing Node.js 24 (LTS line)'
    if (Test-Command 'winget') {
        winget install --id OpenJS.NodeJS --silent --accept-package-agreements --accept-source-agreements
    } else {
        $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
        $release = $index | Where-Object { $_.version -like 'v24.*' } | Select-Object -First 1
        if (-not $release) { throw 'Could not find a Node.js 24 release on nodejs.org.' }
        $msi = Get-SignedInstaller "https://nodejs.org/dist/$($release.version)/node-$($release.version)-x64.msi" 'node.msi' 'OpenJS Foundation'
        Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Verb RunAs -Wait
    }
    Update-SessionPath
    if ((Get-NodeMajor) -lt 24) { throw 'Node.js 24 or newer is still not available after the install. Open a new terminal and run this script again.' }
}

function Install-Rust {
    Step 'Installing Rust (rustup, stable, MSVC toolchain)'
    $exe = Get-HashedInstaller 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' 'rustup-init.exe'
    & $exe -y --default-toolchain stable --profile minimal
    if ($LASTEXITCODE -ne 0) { throw "rustup-init failed (exit $LASTEXITCODE)." }
    Update-SessionPath
}

function Find-Msvc {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { return $null }
    $found = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($found) { return $found } else { return $null }
}

function Install-Msvc {
    Step 'Installing Visual Studio Build Tools (C++ tools + Windows SDK, several GB; a UAC prompt will appear)'
    $exe = Get-SignedInstaller 'https://aka.ms/vs/17/release/vs_BuildTools.exe' 'vs_BuildTools.exe' 'Microsoft Corporation'
    $installerArgs = @('--quiet', '--wait', '--norestart', '--nocache',
        '--add', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '--add', 'Microsoft.VisualStudio.Component.Windows11SDK.22621')
    $process = Start-Process -FilePath $exe -ArgumentList $installerArgs -Verb RunAs -Wait -PassThru
    # 3010 = installed, restart suggested; the tools work without one.
    if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) { throw "Build Tools installer failed (exit $($process.ExitCode))." }
    if (-not (Find-Msvc)) { throw 'The MSVC tools are still missing after the install. Restart Windows and run this script again.' }
}

# Where the repository is: the clone this script sits in, otherwise the default clone directory (fetched below).
function Find-RepoRoot {
    if ($PSScriptRoot) {
        $candidate = Split-Path -Parent $PSScriptRoot
        if (Test-Path (Join-Path $candidate 'packaging\windows\build-audio-helper.mjs')) { return $candidate }
    }
    return $cloneDir
}

try {
    Step '[1/5] Checking and installing tools'
    Update-SessionPath
    if (-not (Test-Command 'git')) { Install-Git } else { Write-Host "   $(git --version) ok" }
    if ((Get-NodeMajor) -lt 24) { Install-Node } else { Write-Host "   node $(node --version) ok" }
    if (-not (Test-Command 'cargo')) { Install-Rust } else { Write-Host "   $(cargo --version) ok" }
    if (-not (Find-Msvc)) { Install-Msvc } else { Write-Host '   MSVC build tools ok' }

    Step 'Getting the code'
    $root = Find-RepoRoot
    if (Test-Path (Join-Path $root '.git')) {
        Write-Host "   using $root"
        # Updating is best effort: local edits or a detached head must not stop a build.
        git -C $root fetch origin $branch
        git -C $root merge --ff-only FETCH_HEAD
    } else {
        Write-Host "   cloning $repoUrl ($branch) into $root"
        git clone --branch $branch $repoUrl $root
        if ($LASTEXITCODE -ne 0) { throw 'git clone failed.' }
    }
    Set-Location $root

    if (-not $BuildOnly) {
        Step '[2/5] Installing npm dependencies'
        if (Test-Path 'node_modules\.bin\vite.cmd') {
            Write-Host '   node_modules exists, skipping'
        } else {
            npm ci --ignore-scripts
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        }
        Step '[3/5] Electron'
        if (Test-Path 'node_modules\electron\dist\electron.exe') {
            Write-Host '   already downloaded, skipping'
        } else {
            node node_modules\electron\install.js
            if ($LASTEXITCODE -ne 0) { throw 'Downloading Electron failed.' }
        }
    }

    Step '[4/5] Building the pass-through helper (the first build takes a few minutes)'
    node packaging\windows\build-audio-helper.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Building the helper failed.' }
    if (-not (Test-Path 'build\folia-audio-helper.exe')) { throw 'build\folia-audio-helper.exe was not produced.' }

    Step 'Output devices'
    $devicesFile = Join-Path $root 'passthrough-devices.txt'
    & 'build\folia-audio-helper.exe' devices | Tee-Object -FilePath $devicesFile
    Write-Host ""
    Write-Host "Saved to $devicesFile. To see which formats a device accepts in exclusive mode:"
    Write-Host '    build\folia-audio-helper.exe probe "DEVICE_ID"'

    if (-not $BuildOnly -and -not $NoStart) {
        Step '[5/5] Starting the desktop app (needs port 3000 free - stop any other service on it first)'
        Write-Host '   Then open: Settings > Playback > Pass-through mode'
        npm run dev:electron
    }
} catch {
    Write-Host ""
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
