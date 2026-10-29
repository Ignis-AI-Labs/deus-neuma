# installer-runtime.ps1 - the Microsoft Visual C++ runtime, for the Windows setup wizard (build/installer.nsh).
#
# The model server (Ollama) loads Microsoft's Visual C++ runtime. Most PCs have it; a fresh one may not.
# The wizard runs this only when its System check found it missing and the person chose the model: it
# fetches Microsoft's own installer, refuses it unless Windows says Microsoft signed it, and runs it
# (Windows asks the person for permission once). Every line it prints lands in the install log.
# Windows PowerShell 5.1, no modules.
#   installer-runtime.ps1 [-CheckOnly]     -CheckOnly: fetch and verify, do not run it
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
$file = Join-Path $env:TEMP 'deus-neuma-vc_redist.x64.exe'
$later = 'Deus Neuma will still install; install it from aka.ms/vs/17/release/vc_redist.x64.exe before the model server can run.'
try {
  Write-Output 'Fetching the Microsoft Visual C++ runtime (about 18 MB). The model server is built with it, like many Windows programs.'
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Uri $url -OutFile $file
  $sig = Get-AuthenticodeSignature $file
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    Remove-Item $file -Force
    Write-Output "Not installed: the download is not signed by Microsoft ($($sig.Status)), so it was thrown away. $later"
    exit 1
  }
  Write-Output 'Checked: signed by Microsoft Corporation.'
  if ($CheckOnly) { Remove-Item $file -Force; exit 0 }
  Write-Output 'Installing it. Windows will ask permission once: click Yes.'
  $p = Start-Process -FilePath $file -ArgumentList '/install', '/quiet', '/norestart' -Verb RunAs -Wait -PassThru
  Remove-Item $file -Force -ErrorAction SilentlyContinue
  # 3010: installed, a restart is wanted but not needed for this
  if ($p.ExitCode -in 0, 1638, 3010) { Write-Output 'The Visual C++ runtime is installed.'; exit 0 }
  Write-Output "Not installed (the installer answered $($p.ExitCode)). $later"
  exit 1
} catch {
  Write-Output "Not installed ($($_.Exception.Message)). $later"
  exit 1
}
