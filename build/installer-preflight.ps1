# installer-preflight.ps1 - the Windows setup wizard's System check (build/installer.nsh).
#
# Run hidden by the installer (nsExec, never a window), before anything is installed. It reads this PC
# and writes one key=value per line to the file it is given; the wizard shows the findings and says
# what setup will install. Read-only: it changes nothing. Windows PowerShell 5.1, no modules.
#   installer-preflight.ps1 <out file>
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'SilentlyContinue'
$found = [ordered]@{}

$os = Get-CimInstance Win32_OperatingSystem
$found.os = "$($os.Caption) ($($os.OSArchitecture), build $($os.BuildNumber))"
$found.osBuild = [int]$os.BuildNumber

$found.ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)

# The graphics card with the most memory. nvidia-smi reads it exactly; otherwise the display driver's
# registry entry (64-bit, unlike WMI's AdapterRAM, which stops at 4 GB).
$gpuName = ''; $gpuGB = 0
$smi = Get-Command nvidia-smi.exe
if ($smi) {
  foreach ($line in (& $smi.Source --query-gpu=name,memory.total --format=csv,noheader,nounits)) {
    $parts = $line -split ','
    $gb = [math]::Round([double]$parts[1].Trim() / 1024)
    if ($gb -gt $gpuGB) { $gpuGB = $gb; $gpuName = $parts[0].Trim() }
  }
}
if (-not $gpuName) {
  $class = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
  foreach ($key in Get-ChildItem $class) {
    $p = Get-ItemProperty $key.PSPath
    $bytes = $p.'HardwareInformation.qwMemorySize'
    if (-not $bytes) { $bytes = $p.'HardwareInformation.MemorySize' }
    if ($bytes -is [byte[]]) { $bytes = [BitConverter]::ToUInt32($bytes, 0) }
    $gb = [math]::Round([double]$bytes / 1GB)
    if ($p.DriverDesc -and $gb -ge $gpuGB) { $gpuGB = $gb; $gpuName = $p.DriverDesc }
  }
}
$found.gpu = $gpuName
$found.gpuGB = $gpuGB

# A model server already on this PC: Ollama (installed, or answering on its port) or LM Studio.
function Answers($url) {
  try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $url; return $true } catch { return $false }
}
$ollama = Get-Command ollama.exe
if (-not $ollama) {
  $guess = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (Test-Path $guess) { $ollama = Get-Item $guess }
}
$found.ollama = ''
if ($ollama) {
  $path = if ($ollama.Source) { $ollama.Source } else { $ollama.FullName }
  $v = (& $path --version 2>&1 | Out-String) -replace '(?s).*?(\d+\.\d+\.\d+).*', '$1'
  $found.ollama = $v.Trim()
}
$found.ollamaRunning = [int](Answers 'http://127.0.0.1:11434/api/version')
$found.lmstudio = [int]((Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\LM Studio')) -or (Test-Path (Join-Path $env:USERPROFILE '.lmstudio')))
$found.lmstudioRunning = [int](Answers 'http://127.0.0.1:1234/v1/models')

# The model download needs the internet; the server and the models come from these two.
$found.online = [int]((Answers 'https://ollama.com') -or (Answers 'https://huggingface.co'))

($found.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) | Set-Content -Encoding Default -Path $Out  # the ANSI page NSIS FileRead expects
