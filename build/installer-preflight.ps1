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
$gpuName = ''; $gpuGB = 0; $gpuDriver = ''
$smi = Get-Command nvidia-smi.exe
if ($smi) {
  foreach ($line in (& $smi.Source --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits)) {
    $parts = $line -split ','
    $gb = [math]::Round([double]$parts[1].Trim() / 1024)
    if ($gb -gt $gpuGB) { $gpuGB = $gb; $gpuName = $parts[0].Trim(); $gpuDriver = $parts[2].Trim() }
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
    if ($p.DriverDesc -and $gb -ge $gpuGB) {
      $gpuGB = $gb; $gpuName = $p.DriverDesc
      # Windows writes 32.0.16.1742 for NVIDIA 617.42: the last five digits of the last two parts
      $v = $p.DriverVersion -split '\.'
      $gpuDriver = if ($p.DriverDesc -match 'NVIDIA' -and $v.Count -eq 4) { $d = ($v[2] + $v[3].PadLeft(4, '0')); $d = $d.Substring($d.Length - 5); "$($d.Substring(0, 3)).$($d.Substring(3))" } else { '' }
    }
  }
}
$found.gpu = $gpuName
$found.gpuGB = $gpuGB

# The NVIDIA driver, against the floor the app's own guard holds a card to (backend/services/gpu-driver-guard.js;
# test/unit/installer-preflight.test.js pins these three to it). Below it the app keeps the model off the card.
$floors = @(
  @{ floor = 580; test = '\bRTX\s*50[1-9]0\b|Blackwell|\bGB10\b' },
  @{ floor = 570; test = '\bGTX\s*(9\d0|10\d0)\b|\bTITAN\s*Xp?\b|\b(Quadro|Tesla)\s*[MP]\d' },
  @{ floor = 550; test = '' }
)
$driverFloor = 0; $driverOld = 0
if ($gpuName -match 'NVIDIA|GeForce|RTX|GTX|Quadro|Tesla|TITAN' -and $gpuDriver -match '^\d{3}\.\d{1,2}$') {
  $driverFloor = ($floors | Where-Object { -not $_.test -or $gpuName -match $_.test } | Select-Object -First 1).floor
  $driverOld = [int]([double]$gpuDriver -lt $driverFloor)
}
$found.gpuDriver = $gpuDriver
$found.driverFloor = $driverFloor
$found.driverOld = $driverOld

# The Microsoft Visual C++ runtime (2015-2022, x64) the model server's libraries load
$vcKey = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64'
$sys = Join-Path $env:SystemRoot 'System32'
$found.vcRuntime = [int](($vcKey.Installed -eq 1) -and (Test-Path (Join-Path $sys 'vcruntime140.dll')) -and (Test-Path (Join-Path $sys 'msvcp140.dll')))

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
