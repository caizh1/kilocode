[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Cli,
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [ValidateRange(1, 100)]
  [int]$Runs = 10,
  [ValidateRange(5, 120)]
  [int]$TimeoutSeconds = 30,
  [switch]$ReuseStorage
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Stop-ProcessTree {
  param([int]$ProcessId)

  Start-Process -FilePath taskkill.exe -ArgumentList @("/PID", $ProcessId, "/T") -Wait -WindowStyle Hidden | Out-Null
  Start-Sleep -Milliseconds 500
  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
    return
  }
  Start-Process -FilePath taskkill.exe -ArgumentList @("/PID", $ProcessId, "/T", "/F") -Wait -WindowStyle Hidden | Out-Null
}

function Exit-Hex {
  param([int]$Code)
  return "0x{0:X8}" -f ([uint32](([int64]$Code) -band 0xFFFFFFFFL))
}

function Clean-Text {
  param($Value)
  if ($null -eq $Value) {
    return ""
  }
  return ([string]$Value).Trim()
}

$resolved = (Resolve-Path -LiteralPath $Cli).Path
New-Item -ItemType Directory -Path $Root -Force | Out-Null
$results = @()

for ($index = 1; $index -le $Runs; $index++) {
  $run = Join-Path $Root ("run-{0:D3}" -f $index)
  $storage = if ($ReuseStorage) { Join-Path $Root "storage" } else { Join-Path $run "storage" }
  New-Item -ItemType Directory -Path $run,$storage -Force | Out-Null
  $stdout = Join-Path $run "stdout.log"
  $stderr = Join-Path $run "stderr.log"
  Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue

  $env:KILO_DISABLE_CHANNEL_DB = "true"
  $env:KILO_PRODUCT_PROFILE = "chipmate-v2"
  $env:KILO_STORAGE_ROOT = $storage
  $env:KILO_VSCODE_GLOBAL_STORAGE = $storage
  $env:KILO_SERVER_PASSWORD = "windows-qa"
  $env:KILO_PARENT_PID = [string]$PID
  $env:KILO_CLIENT = "vscode"
  $env:KILO_APP_NAME = "chipmate"
  $env:KILO_DISABLE_MODELS_FETCH = "1"
  $env:KILO_TELEMETRY_LEVEL = "off"
  $env:MIMALLOC_PURGE_DELAY = "0"

  $started = Get-Date
  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $env:ComSpec
  $info.Arguments = '/d /s /c ""{0}" serve --port 0 1>"{1}" 2>"{2}""' -f $resolved,$stdout,$stderr
  $info.WorkingDirectory = $run
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) {
    throw "Failed to start CLI process."
  }
  $cliPid = $null
  $ready = $false
  $port = $null
  $deadline = $started.AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) {
      break
    }
    if ($null -eq $cliPid) {
      $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($null -ne $child) {
        $cliPid = [int]$child.ProcessId
      }
    }
    $text = if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue } else { "" }
    $match = [regex]::Match((Clean-Text -Value $text), "listening on http://[\w.]+:(\d+)")
    if ($match.Success) {
      $ready = $true
      $port = [int]$match.Groups[1].Value
      break
    }
    Start-Sleep -Milliseconds 100
  }

  $process.Refresh()
  $exited = $process.HasExited
  if ($exited) {
    $process.WaitForExit()
  }
  $code = if ($exited) { $process.ExitCode } else { $null }
  if (-not $exited) {
    Stop-ProcessTree -ProcessId $process.Id
    $process.WaitForExit(5000) | Out-Null
    $process.WaitForExit()
  }
  $out = if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout -Raw } else { "" }
  $err = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { "" }
  $results += [ordered]@{
    run = $index
    pid = $cliPid
    launcherPid = $process.Id
    ready = $ready
    port = $port
    exited = $exited
    exitCode = $code
    exitHex = if ($null -ne $code) { Exit-Hex -Code $code } else { $null }
    accessViolation = $null -ne $code -and (Exit-Hex -Code $code) -eq "0xC0000005"
    durationMs = [int]((Get-Date) - $started).TotalMilliseconds
    stdout = Clean-Text -Value $out
    stderr = Clean-Text -Value $err
  }
}

$summary = [ordered]@{
  cli = $resolved
  sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
  runs = $Runs
  ready = @($results | Where-Object { $_.ready }).Count
  accessViolations = @($results | Where-Object { $_.accessViolation }).Count
  results = $results
}
$json = $summary | ConvertTo-Json -Depth 6
$json | Set-Content -LiteralPath (Join-Path $Root "matrix.json") -Encoding UTF8
$json
if ($summary.ready -ne $Runs -or $summary.accessViolations -ne 0) {
  exit 1
}
