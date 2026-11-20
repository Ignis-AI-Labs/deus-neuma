# installer-model-home.ps1 - judge and remove only the model payload setup owns.
# DN_MODEL_HOME carries the path so registry text is never parsed as PowerShell.
# Windows PowerShell 5.1, no modules.
param([switch]$StopKnownServer, [int]$RemoveKnownChildren = 0)
$ErrorActionPreference = 'Stop'

function Assert-NoReparsePoint([string]$LiteralPath) {
  $item = Get-Item -LiteralPath $LiteralPath -Force
  while ($null -ne $item) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Model home crosses a reparse point: $($item.FullName)"
    }
    $item = $item.Parent
  }
}

try {
  if ([string]::IsNullOrWhiteSpace($env:DN_MODEL_HOME)) { throw 'No model home was supplied.' }
  Assert-NoReparsePoint $env:DN_MODEL_HOME
  foreach ($name in 'ollama', 'models') {
    $child = Join-Path $env:DN_MODEL_HOME $name
    if (Test-Path -LiteralPath $child) { Assert-NoReparsePoint $child }
  }
  if ($StopKnownServer) {
    Get-CimInstance Win32_Process -Filter "Name='ollama.exe'" | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:DN_MODEL_HOME, 'OrdinalIgnoreCase')
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  }
  if ($RemoveKnownChildren -eq 1) {
    foreach ($name in 'ollama', 'models') {
      $child = Join-Path $env:DN_MODEL_HOME $name
      if (Test-Path -LiteralPath $child) { Remove-Item -LiteralPath $child -Recurse -Force }
    }
    foreach ($name in 'ollama.log', '.deus-neuma-model-home') {
      $child = Join-Path $env:DN_MODEL_HOME $name
      if (Test-Path -LiteralPath $child) { Remove-Item -LiteralPath $child -Force }
    }
    if ($null -eq (Get-ChildItem -LiteralPath $env:DN_MODEL_HOME -Force | Select-Object -First 1)) {
      Remove-Item -LiteralPath $env:DN_MODEL_HOME -Force
    }
  }
  exit 0
} catch {
  Write-Output $_.Exception.Message
  exit 1
}
