# build-windows.ps1 - build the Deus Neuma Windows installer on a Windows PC, the proven road.
#
# Run in PowerShell (no admin, no Visual Studio needed):
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1 [-Ref origin/dev] [-Dir $HOME\deus-neuma-build] [-Install]
#
# What it does, and why each step exists (docs: BUILDING.md, the release runbook):
#   1. preflight: 64-bit Windows, disk space, Git and Node 22+ (installed with winget if missing), the npm registry
#   2. clones or updates the public repository and checks out -Ref, in -Dir (never your own checkout)
#   3. npm ci, then the OFFICIAL Electron prebuild of better-sqlite3: node-gyp would need Visual Studio,
#      and a module built for plain Node fails silently in the app (the platform database turns into a no-op)
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
  [switch]$Install
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
function Ensure($what, $id, [scriptblock]$ok, $why) {
  if (& $ok) { return }
  Write-Host "   $what is needed ($why)." -ForegroundColor Yellow
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "$what is missing and winget is not available to install it. Install 'App Installer' from the Microsoft Store (it provides winget), then run this again."
  }
  Write-Host "   Installing $what with winget. If Windows asks for permission, click Yes."
  & winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
  Refresh-Path
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

Step 2 "source: $Ref of $Repo"
if (-not (Test-Path (Join-Path $Dir '.git'))) { Run git @('clone', $Repo, $Dir) }
Set-Location $Dir
Run git @('remote', 'set-url', 'origin', $Repo)
Run git @('fetch', '--quiet', 'origin')
Run git @('checkout', '--quiet', '--detach', $Ref)
Run git @('clean', '-fdxq', '-e', 'node_modules')
$version = node -p "require('./package.json').version"
Write-Host "   $(git log -1 --format='%h %s') - version $version"

Step 3 'dependencies, with the Electron prebuild of better-sqlite3'
Run npm @('ci', '--no-audit', '--no-fund')
$electron = node -p "require('./node_modules/electron/package.json').version"
Push-Location node_modules\better-sqlite3
Run npx @('--yes', 'prebuild-install', '--runtime=electron', "--target=$electron", '--arch=x64', '--platform=win32')
Pop-Location
Set-Content -NoNewline -Path node_modules\.native-abi -Value 'electron'
Write-Host "   better-sqlite3 for Electron $electron"

Step 4 'electron-builder winCodeSign cache'
$cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign\winCodeSign-2.6.0'
if (-not (Test-Path (Join-Path $cache 'windows-10'))) {
  $archive = Join-Path $env:TEMP 'winCodeSign-2.6.0.7z'
  Invoke-WebRequest -UseBasicParsing -OutFile $archive 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z'
  New-Item -ItemType Directory -Force -Path $cache | Out-Null
  & .\node_modules\7zip-bin\win\x64\7za.exe x -y "-o$cache" $archive | Out-Null
  # exit 2 is exactly the two macOS symlinks it cannot create; everything Windows needs lands
  if ($LASTEXITCODE -gt 2) { Fail "7za could not extract winCodeSign (exit $LASTEXITCODE)" }
}
Write-Host "   $cache"

Step 5 'build the frontend and the NSIS installer'
Remove-Item -Recurse -Force release -ErrorAction SilentlyContinue
Run npm @('run', 'build')
Run npx @('--yes', 'electron-builder', '--win', '--publish', 'never', '-c.npmRebuild=false')

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
