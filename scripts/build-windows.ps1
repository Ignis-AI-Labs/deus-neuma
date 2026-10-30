# build-windows.ps1 - build the Deus Neuma Windows installer on a Windows PC, the proven road.
#
# Run in PowerShell (the winget installs below ask Windows for permission):
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1 [-Ref origin/dev] [-Dir $HOME\deus-neuma-build] [-Install]
# This is what BUILDS the installer. A person who only RUNS Deus Neuma needs none of it: not Git, not Node,
# not Python, not Visual Studio (the app carries its own Node; the installer's System check lists what a PC needs).
#
# What it does, and why each step exists (docs: BUILDING.md, the release runbook):
#   1. preflight: 64-bit Windows, disk space, Git and Node 22+ (installed with winget if missing), the npm registry
#   2. clones or updates the public repository and checks out -Ref, in -Dir (never your own checkout);
#      with -Here it builds the checkout the script lives in instead, uncommitted work and all
#   3. npm ci, then better-sqlite3 for Electron: the OFFICIAL prebuild when one exists for this Electron, else
#      compiled here (Python 3 and the Visual Studio C++ Build Tools, installed with winget if missing). A module
#      built for plain Node fails silently in the app (the platform database turns into a no-op)
#   4. seeds electron-builder's winCodeSign cache by hand: its archive holds two macOS symlinks that
#      Windows refuses to create without admin or Developer Mode, which stops the NSIS step
#   5. builds the frontend and the NSIS installer (no publish, no native rebuild)
#   6. refuses the package unless every native binary in it is a real Windows (PE) binary
#   7. prints the installer, latest.yml and their SHA-256; -Install also installs it silently;
#      -CopyTo <folder> copies the installer, its .blockmap and latest.yml there (a USB stick, a share)
# -Repo may be a git bundle file instead of the GitHub URL (an offline copy, no sign-in needed).
# The installer is UNSIGNED unless the machine holds the signing identity (release runbook 4b).

param(
  [string]$Ref = 'origin/dev',
  [string]$Dir = (Join-Path $HOME 'deus-neuma-build'),
  [string]$Repo = 'https://github.com/Ignis-AI-Labs/deus-neuma.git',
  [string]$CopyTo = '',
  [switch]$Install,
  [switch]$Here
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 may default to TLS 1.0, which GitHub and npm refuse
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
function Step($n, $s) { Write-Host "`n-- $n. $s" -ForegroundColor Cyan }
function Fail($s) { Write-Host "`nX build stopped: $s" -ForegroundColor Red; exit 1 }
function Run($exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { Fail "$exe $($argv -join ' ') exited $LASTEXITCODE" }
}

Step 1 'preflight: what this build needs, installed for you where it can be'
# The PATH a fresh install wrote, without opening a new window
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Node-Major { if (Get-Command node -ErrorAction SilentlyContinue) { [int]((node -p 'process.versions.node').Split('.')[0]) } else { 0 } }
# Windows ships a `python` alias that only opens the Microsoft Store: it answers to the name and is no Python
function Python-Ok { try { [bool]((& python --version 2>&1 | Out-String) -match '^Python 3\.') } catch { $false } }
function Cpp-Tools-Ok {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  (Test-Path $vswhere) -and [bool](& $vswhere -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
}
function Ensure($what, $id, [scriptblock]$ok, $why, [string[]]$extra = @()) {
  if (& $ok) { return }
  Write-Host "   $what is needed ($why)." -ForegroundColor Yellow
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "$what is missing and winget is not available to install it. Install 'App Installer' from the Microsoft Store (it provides winget), then run this again."
  }
  Write-Host "   Installing $what with winget. If Windows asks for permission, click Yes."
  & winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements @extra
  Refresh-Path
  # winget can hand back control while the installer (Visual Studio's above all) is still finishing in the background
  for ($waited = 0; -not (& $ok) -and $waited -lt 1200; $waited += 10) { Start-Sleep 10; Refresh-Path }
  if (-not (& $ok)) { Fail "$what still is not available after installing. Open a new PowerShell window and run this again." }
  Write-Host "   $what installed."
}
if (-not [Environment]::Is64BitOperatingSystem) { Fail 'Deus Neuma builds for 64-bit Windows; this Windows is 32-bit.' }
$free = [math]::Round((Get-PSDrive -Name (Split-Path -Qualifier $HOME).TrimEnd(':')).Free / 1GB, 1)
if ($free -lt 12) { Fail "the build needs about 12 GB free on $(Split-Path -Qualifier $HOME); there are $free GB. Free some space and run this again." }
Ensure 'Git' 'Git.Git' { [bool](Get-Command git -ErrorAction SilentlyContinue) } 'to unpack the source'
Ensure 'Node.js 22 or newer' 'OpenJS.NodeJS.LTS' { (Node-Major) -ge 22 } 'to build the app'
try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 'https://registry.npmjs.org/-/ping' | Out-Null }
catch { Fail 'the build downloads its packages from registry.npmjs.org, which cannot be reached. Check the internet connection and run this again.' }
Write-Host "   64-bit Windows - $free GB free - git $((git --version) -replace 'git version ','') - node $(node -p 'process.versions.node') - npm registry reachable"

if ($Here) {
  # -Here builds this checkout as it stands (uncommitted work included): nothing is cloned, checked out or cleaned
  Step 2 'source: this checkout, as it stands'
  Set-Location (Split-Path $PSScriptRoot -Parent)
} else {
  Step 2 "source: $Ref of $Repo"
  if (-not (Test-Path (Join-Path $Dir '.git'))) { Run git @('clone', $Repo, $Dir) }
  Set-Location $Dir
  Run git @('remote', 'set-url', 'origin', $Repo)
  Run git @('fetch', '--quiet', 'origin')
  Run git @('checkout', '--quiet', '--detach', $Ref)
  Run git @('clean', '-fdxq', '-e', 'node_modules')
}
$version = node -p "require('./package.json').version"
Write-Host "   $(git log -1 --format='%h %s') - version $version"

Step 3 'dependencies, with better-sqlite3 built for Electron'
Run npm @('ci', '--no-audit', '--no-fund')
$electron = node -p "require('./node_modules/electron/package.json').version"
Push-Location node_modules\better-sqlite3
# the locked prebuild-install (package-lock.json), run by path: npx could fetch the newest from the registry
& node ..\prebuild-install\bin.js --runtime=electron "--target=$electron" --arch=x64 --platform=win32
$prebuilt = ($LASTEXITCODE -eq 0)
Pop-Location
if ($prebuilt) {
  Write-Host "   better-sqlite3 for Electron $electron (the official prebuild)"
} else {
  # A module built for plain Node fails silently in the app (the platform database turns into a no-op),
  # so with no prebuild for this Electron it is compiled here, with the repo's pinned @electron/rebuild.
  Write-Host "   no official better-sqlite3 prebuild for Electron ${electron}: compiling it" -ForegroundColor Yellow
  Ensure 'Python 3' 'Python.Python.3.12' { Python-Ok } 'node-gyp, which compiles better-sqlite3, runs on it'
  Ensure 'Visual Studio 2022 C++ Build Tools' 'Microsoft.VisualStudio.2022.BuildTools' { Cpp-Tools-Ok } 'the C++ compiler that builds better-sqlite3 for Electron' @('--override', '--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive')
  Run (Join-Path $PWD 'node_modules\.bin\electron-rebuild.cmd') @('-f', '--only', 'better-sqlite3', '-v', $electron, '--arch', 'x64')
  # --only: node-pty ships its own Windows prebuild, and compiling it needs a helper script the package lacks
  Write-Host "   better-sqlite3 compiled for Electron $electron"
}
# the marker scripts\ensure-native-abi.mjs reads: the exact runtime, never the bare family
Set-Content -NoNewline -Path node_modules\.native-abi -Value "electron@$electron"

Step 4 'electron-builder winCodeSign cache'
$cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign\winCodeSign-2.6.0'
if (-not (Test-Path (Join-Path $cache 'windows-10'))) {
  $archive = Join-Path $env:TEMP 'winCodeSign-2.6.0.7z'
  Invoke-WebRequest -UseBasicParsing -OutFile $archive 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z'
  # Pinned: the archive whose sha512 electron-builder itself names for winCodeSign-2.6.0. Anything
  # else stops the build before a byte of it is unpacked into the cache the signer runs from.
  $pinned = 'cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4'
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  if ($got -ne $pinned) {
    Remove-Item -Force -LiteralPath $archive
    Fail "winCodeSign-2.6.0.7z is not the pinned archive (sha256 $got, expected $pinned)"
  }
  New-Item -ItemType Directory -Force -Path $cache | Out-Null
  & .\node_modules\7zip-bin\win\x64\7za.exe x -y "-o$cache" $archive | Out-Null
  # exit 2 is exactly the two macOS symlinks it cannot create; everything Windows needs lands
  if ($LASTEXITCODE -gt 2) { Fail "7za could not extract winCodeSign (exit $LASTEXITCODE)" }
}
Write-Host "   $cache"

Step 5 'build the frontend and the NSIS installer'
Remove-Item -Recurse -Force release -ErrorAction SilentlyContinue
# electron-builder's installer template crashes on some fresh installs (scripts\nsis-template-patch.mjs says why); never make an installer from it unpatched
Run node @('scripts/patch-nsis-template.mjs', '--check')
Run npm @('run', 'build')
Run (Join-Path $PWD 'node_modules\.bin\electron-builder.cmd') @('--win', '--publish', 'never', '-c.npmRebuild=false')

Step 6 'every native binary in the package is a real Windows binary'
Run node @('scripts/verify-win-natives.mjs', 'release\win-unpacked')

Step 7 'the installer'
$exe = Get-ChildItem release -Filter "*$version*.exe" | Select-Object -First 1
if (-not $exe) { Fail 'no installer in release\' }
foreach ($f in @($exe.FullName, (Join-Path $PWD 'release\latest.yml'))) {
  $h = (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower()
  Write-Host ("   {0}  {1}  {2} B" -f $h, (Split-Path $f -Leaf), (Get-Item $f).Length)
}
$sig = Get-AuthenticodeSignature $exe.FullName
Write-Host "   signature: $($sig.Status)$(if ($sig.SignerCertificate) { ' - ' + $sig.SignerCertificate.Subject })"
if ($CopyTo) {
  New-Item -ItemType Directory -Force -Path $CopyTo | Out-Null
  foreach ($f in @($exe.FullName, "$($exe.FullName).blockmap", (Join-Path $PWD 'release\latest.yml'))) { Copy-Item -Force $f $CopyTo }
  Write-Host "   copied the installer, its .blockmap and latest.yml to $CopyTo"
}
if ($Install) {
  Step 8 'silent install'
  $p = Start-Process -FilePath $exe.FullName -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "the installer exited $($p.ExitCode)" }
  Write-Host "   installed: open Deus Neuma from the Start menu"
}
Write-Host "`nOK Deus Neuma $version for Windows: $($exe.FullName)" -ForegroundColor Green
Write-Host "   Bring release\$($exe.Name), its .blockmap and latest.yml to the release machine to sign the feed and publish."
