[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Vsix,
  [string] $CodePath,
  [string] $PreviousVsix,
  [string] $KiloVsix,
  [string] $FixtureRoot,
  [string] $Output,
  [ValidateSet("full", "core", "smoke", "agent-console", "package")] [string] $Lane = "smoke",
  [Parameter(Mandatory = $true)] [ValidateSet("arm64-vm", "native-x64")] [string] $Gate,
  [ValidateSet("default", "disabled")] [string] $Gpu = "default",
  [switch] $NoGui,
  [switch] $SkipStress
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ExpectedVersion = "1.0.9"

$QaRoot = $PSScriptRoot
. (Join-Path $QaRoot "ui-automation.ps1")
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $QaRoot "..\..\..\.."))
$Matrix = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $QaRoot "cases.json") | ConvertFrom-Json
$Atomic = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $QaRoot "atomic-cases.json") | ConvertFrom-Json
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ([string]::IsNullOrWhiteSpace($Output)) { $Output = Join-Path $env:TEMP "chipmate-windows-qa\$Stamp" }
$Output = [IO.Path]::GetFullPath($Output)
$Vsix = [IO.Path]::GetFullPath($Vsix)
if (-not (Test-Path -LiteralPath $Vsix -PathType Leaf)) { throw "VSIX not found: $Vsix" }
if ($Output -eq [IO.Path]::GetPathRoot($Output) -or $Output -eq [IO.Path]::GetFullPath($env:USERPROFILE)) {
  throw "Unsafe QA output root: $Output"
}

New-Item -ItemType Directory -Force -Path $Output | Out-Null
Set-Content -LiteralPath (Join-Path $Output ".chipmate-windows-qa-root") -Value $Stamp -Encoding ASCII
$Evidence = Join-Path $Output "evidence"
$Runtime = Join-Path $Output "runtime"
$Workspace = Join-Path $Runtime "fixture-中文 workspace"
New-Item -ItemType Directory -Force -Path $Evidence, $Runtime, $Workspace | Out-Null

$Results = New-Object System.Collections.ArrayList
$AtomicResults = New-Object System.Collections.ArrayList
$Mock = $null
$Code = $null
$CodeCli = $null
$Artifact = $null
$script:Completed = $false
$script:ExitCode = 1
$script:CdpPort = 0
$script:MockPort = 0
$script:MockOrigin = ""
$script:ReloadPass = $false
$script:HostPass = $false
$script:CdpTarget = ""
$script:CdpExcluded = New-Object Collections.Generic.List[string]
$ExtDir = Join-Path $Runtime "extensions"
$UserDir = Join-Path $Runtime "user"
New-Item -ItemType Directory -Force -Path $ExtDir, $UserDir | Out-Null

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [string] $Value
  )
  $full = [IO.Path]::GetFullPath($Path)
  $parent = Split-Path -Parent $full
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $temp = Join-Path $parent ".$(Split-Path -Leaf $full).$([Guid]::NewGuid().ToString('N')).tmp"
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($temp, $Value, $encoding)
  Move-Item -LiteralPath $temp -Destination $full -Force
}

function Get-SharedFileLines {
  param([Parameter(Mandatory = $true)] [string] $Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
  foreach ($attempt in 1..40) {
    try {
      $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      try {
        $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true)
        try {
          $text = $reader.ReadToEnd()
        } finally {
          $reader.Dispose()
        }
      } finally {
        $stream.Dispose()
      }
      return @($text -split "\r?\n" | Where-Object { $_ -ne "" })
    } catch [IO.IOException] {
      Start-Sleep -Milliseconds 25
    }
  }
  return @()
}

function Wait-ChipMateFile {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [int] $Seconds = 15
  )
  $limit = (Get-Date).AddSeconds($Seconds)
  do {
    if (Test-Path -LiteralPath $Path -PathType Leaf) { return $true }
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $limit)
  return $false
}

function Quote-ProcessArgument {
  param([Parameter(Mandatory = $true)] [string] $Value)
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-CodeCli {
  param(
    [Parameter(Mandatory = $true)] [string[]] $Arguments,
    [Parameter(Mandatory = $true)] [string] $Log
  )
  $preference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $CodeCli @Arguments *> $Log
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $preference
  }
}

function Get-FreeTcpPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    return ([Net.IPEndPoint] $listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Get-SubjectCliProcesses {
  $paths = @(Get-ChildItem -LiteralPath $ExtDir -Recurse -File -Filter "kilo*.exe" -ErrorAction SilentlyContinue |
    ForEach-Object { [IO.Path]::GetFullPath($_.FullName) })
  if (-not $paths.Count) { return @() }
  return @(Get-CimInstance Win32_Process -Filter "Name = 'kilo.exe' OR Name = 'kilo-arm64.exe' OR Name = 'kilo-indexer.exe' OR Name = 'kilo-indexer-arm64.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $path = $_.ExecutablePath
      ($path -and $paths -contains [IO.Path]::GetFullPath($path)) -or
        ($_.CommandLine -and $_.CommandLine.IndexOf($ExtDir, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    } |
    Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine)
}

function Invoke-CliLifecycleAudit {
  $limit = (Get-Date).AddSeconds(20)
  do {
    $processes = @(Get-SubjectCliProcesses)
    if (-not $processes.Count) { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $limit)
  $processes | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $Evidence "cli-processes-after-close.json") -Encoding UTF8
  $logs = Join-Path $UserDir "logs"
  $text = if (Test-Path -LiteralPath $logs -PathType Container) {
    Get-ChildItem -LiteralPath $logs -Recurse -File |
      ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName -ErrorAction SilentlyContinue } |
      Out-String
  } else { "" }
  $crash = $text -match "3221225477|0xC0000005|access violation"
  $events = @()
  if (Test-Path -LiteralPath $logs -PathType Container) {
    $files = @(Get-ChildItem -LiteralPath $logs -Recurse -File -Filter "*Memory Debug.log" -ErrorAction SilentlyContinue)
    foreach ($file in $files) {
      foreach ($line in (Get-SharedFileLines -Path $file.FullName)) {
        try {
          $entry = $line | ConvertFrom-Json
          if ($entry.PSObject.Properties.Name -contains "event") { $events += $entry }
        } catch {
          continue
        }
      }
    }
  }
  $spawned = @($events | Where-Object { $_.event -eq "cli.spawned" })
  $ready = @($events | Where-Object { $_.event -eq "cli.ready" })
  $spawnedRuns = @($spawned | ForEach-Object { $_.runId } | Sort-Object -Unique)
  $readyRuns = @($ready | ForEach-Object { $_.runId } | Sort-Object -Unique)
  $hashes = @($spawned | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.data.cliHash) }).Count
  $events |
    Select-Object at, event, runId, data |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (Join-Path $Evidence "cli-lifecycle-events.json") -Encoding UTF8
  $assertions = @(
    @{ id = "startup-matrix"; status = if ($script:ReloadPass -and $script:HostPass -and $spawnedRuns.Count -ge 3 -and $readyRuns.Count -ge 3 -and $hashes -ge 3) { "PASS" } else { "FAIL" }; detail = "reload=$script:ReloadPass extensionHost=$script:HostPass spawned=$($spawnedRuns.Count) ready=$($readyRuns.Count) hashes=$hashes" },
    @{ id = "no-access-violation"; status = if (-not $crash) { "PASS" } else { "FAIL" }; detail = "Access violation marker observed=$crash" },
    @{ id = "no-orphan-cli"; status = if (-not $processes.Count) { "PASS" } else { "FAIL" }; detail = "Bundled CLI processes after close=$($processes.Count)" }
  )
  $pass = @($assertions | Where-Object { $_.status -ne "PASS" }).Count -eq 0
  Add-Result -CaseId "WIN-CLI-LIFECYCLE" -Status $(if ($pass) { "PASS" } else { "FAIL" }) -Summary "Bundled CLI startup, Reload, Extension Host restart, access violation and orphan-process audit." -Assertions $assertions
}

function Initialize-MockProviderConfig {
  $storage = Join-Path $UserDir "User\globalStorage\chipmate.chipmate"
  $provider = [ordered]@{
    model = "qa-local/qa-chat-model"
    enabled_providers = @("qa-local")
    provider = [ordered]@{
      "qa-local" = [ordered]@{
        name = "ChipMate QA"
        npm = "@ai-sdk/openai-compatible"
        env = @()
        models = [ordered]@{
          "qa-chat-model" = [ordered]@{
            name = "QA Chat Model"
            tool_call = $true
            limit = @{ context = 32768; output = 4096 }
          }
        }
        options = @{ apiKey = "qa-local-key"; baseURL = "$script:MockOrigin/v1" }
      }
    }
  }
  $models = [ordered]@{
    model = @{ "agent-console" = @{ providerID = "qa-local"; modelID = "qa-chat-model" } }
    recent = @(@{ providerID = "qa-local"; modelID = "qa-chat-model" })
    favorite = @()
    variant = @{}
  }
  foreach ($root in @($storage, (Join-Path $storage "v2"))) {
    Write-Utf8NoBom -Path (Join-Path $root "config\kilo.jsonc") -Value ($provider | ConvertTo-Json -Depth 12)
    Write-Utf8NoBom -Path (Join-Path $root "state\model.json") -Value ($models | ConvertTo-Json -Depth 8)
  }
}

function Initialize-Fixture {
  if ($FixtureRoot) {
    $source = [IO.Path]::GetFullPath($FixtureRoot)
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Fixture root not found: $source" }
    if ($source.StartsWith($Output, [StringComparison]::OrdinalIgnoreCase)) { throw "Fixture source must not be inside the QA output root." }
    Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $Workspace -Recurse -Force
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Workspace "main.c"))) {
    @"
#include <stdint.h>
static int qa_leaf(int value) { return value + 1; }
int qa_entry(int value) { return qa_leaf(value); }
"@ | Set-Content -LiteralPath (Join-Path $Workspace "main.c") -Encoding UTF8
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Workspace "design.md"))) {
    "# QA Document`n`nThe deterministic limit is 42." | Set-Content -LiteralPath (Join-Path $Workspace "design.md") -Encoding UTF8
  }
  $settings = Join-Path $Workspace ".vscode\settings.json"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settings) | Out-Null
  $settingsJson = @{
    "editor.accessibilitySupport" = "on"
    "chipmate.v2.language" = "zh-cn"
    "chipmate.v2.indexing.provider" = "openai-compatible"
    "chipmate.v2.indexing.model" = "qa-embedding-model"
    "chipmate.v2.indexing.dimension" = 2048
  }
  Write-Utf8NoBom -Path $settings -Value ($settingsJson | ConvertTo-Json)
}

function Test-FrozenVsix {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Vsix).Hash.ToLowerInvariant()
  $zip = Join-Path $Runtime "subject.zip"
  $unpack = Join-Path $Runtime "vsix"
  Copy-Item -LiteralPath $Vsix -Destination $zip -Force
  if (Test-Path $unpack) { Remove-Item -LiteralPath $unpack -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
  $required = @(
    "extension\bin\kilo.exe",
    "extension\bin\rg.exe",
    "extension\bin\models-snapshot.json",
    "extension\bin\tree-sitter\tree-sitter.wasm",
    "extension\bin\lancedb\node_modules\@lancedb\lancedb\dist\index.js",
    "extension\bin\lancedb\node_modules\@lancedb\lancedb-win32-x64-msvc\lancedb.win32-x64-msvc.node",
    "extension\bin\poppler\pdftotext.exe",
    "extension\dist\extension.js",
    "extension\dist\webview.js",
    "extension\dist\agent-manager.js",
    "extension\dist\agent-console.js",
    "extension\dist\diff-viewer.js",
    "extension\dist\diff-virtual.js"
  )
  $missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $unpack $_)) })
  if ($missing.Count) { throw "VSIX missing required files: $($missing -join ', ')" }
  $forbidden = @(Get-ChildItem -LiteralPath $unpack -Recurse -File | Where-Object { $_.Name -eq "ffmpeg.exe" -or $_.Name.EndsWith(".map") })
  if ($forbidden.Count) { throw "VSIX contains forbidden files: $($forbidden.FullName -join ', ')" }
  $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $unpack "extension\package.json") | ConvertFrom-Json
  if ($manifest.publisher -ne "chipmate" -or $manifest.name -ne "chipmate") { throw "Unexpected extension identity in VSIX." }
  if ($manifest.version -ne $ExpectedVersion) { throw "Expected VSIX version $ExpectedVersion, got $($manifest.version)." }
  if ($manifest.chipmatePackageTarget -ne "win32-x64-baseline") { throw "Unexpected chipmatePackageTarget: $($manifest.chipmatePackageTarget)" }
  return @{ vsix = $Vsix; sha256 = $hash; version = $manifest.version; target = $manifest.chipmatePackageTarget }
}

function Invoke-Coverage {
  $ledger = Join-Path $Evidence "coverage-ledger.json"
  if (Test-Path -LiteralPath (Join-Path $RepoRoot ".changeset")) {
    Invoke-Node -Arguments @((Join-Path $QaRoot "coverage.mjs"), "--output", $ledger) |
      Set-Content -LiteralPath (Join-Path $Evidence "coverage.log") -Encoding UTF8
    if ($LASTEXITCODE -ne 0) { throw "Changeset/runtime coverage gate failed. See coverage.log." }
    return
  }
  $snapshot = Join-Path $QaRoot "coverage-snapshot.json"
  if (-not (Test-Path -LiteralPath $snapshot)) { throw "Standalone kit is missing coverage-snapshot.json." }
  $frozen = Get-Content -Raw -Encoding UTF8 -LiteralPath $snapshot | ConvertFrom-Json
  if ($frozen.status -ne "PASS" -or $frozen.matrix.mappedChangesets -ne $frozen.matrix.changesets) {
    throw "Frozen coverage snapshot is not complete."
  }
  Copy-Item -LiteralPath $snapshot -Destination $ledger -Force
  "Using frozen standalone coverage snapshot." | Set-Content -LiteralPath (Join-Path $Evidence "coverage.log") -Encoding UTF8
}

function Resolve-Code {
  if ($CodePath) {
    $resolved = [IO.Path]::GetFullPath($CodePath)
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Code.exe not found: $resolved" }
    return $resolved
  }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\Code.exe"),
    (Join-Path $env:ProgramFiles "Microsoft VS Code\Code.exe")
  )
  $match = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $match) { throw "Code.exe not found; pass -CodePath." }
  return $match
}

function Resolve-Node {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) {
    return @{ path = $command.Source; electron = $false }
  }
  $path = if ($Code) { $Code } else { Resolve-Code }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Neither node.exe nor the VS Code Electron Node runtime is available."
  }
  return @{ path = $path; electron = $true }
}

function Invoke-Node {
  param([Parameter(Mandatory = $true)] [string[]] $Arguments)
  $runtime = Resolve-Node
  if (-not $runtime.electron) {
    & $runtime.path @Arguments
    return
  }
  $id = [Guid]::NewGuid().ToString("N")
  $stdout = Join-Path ([IO.Path]::GetTempPath()) "chipmate-node-$id.stdout.log"
  $stderr = Join-Path ([IO.Path]::GetTempPath()) "chipmate-node-$id.stderr.log"
  $previous = [Environment]::GetEnvironmentVariable("ELECTRON_RUN_AS_NODE", "Process")
  try {
    $env:ELECTRON_RUN_AS_NODE = "1"
    $process = Start-Process `
      -FilePath $runtime.path `
      -ArgumentList ($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -WindowStyle Hidden `
      -Wait `
      -PassThru
    if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout }
    if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr }
    $global:LASTEXITCODE = $process.ExitCode
  } finally {
    if ($null -eq $previous) {
      Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    } else {
      $env:ELECTRON_RUN_AS_NODE = $previous
    }
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
  }
}

function Start-MockProvider {
  $runtime = Resolve-Node
  $stdout = Join-Path $Evidence "mock-provider.log"
  $stderr = Join-Path $Evidence "mock-provider-error.log"
  $previous = [Environment]::GetEnvironmentVariable("ELECTRON_RUN_AS_NODE", "Process")
  try {
    if ($runtime.electron) { $env:ELECTRON_RUN_AS_NODE = "1" }
    $process = Start-Process -FilePath $runtime.path -ArgumentList @((Join-Path $QaRoot "mock-provider.mjs"), "--port=$script:MockPort") -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
  } finally {
    if ($null -eq $previous) {
      Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    } else {
      $env:ELECTRON_RUN_AS_NODE = $previous
    }
  }
  $limit = (Get-Date).AddSeconds(20)
  do {
    try {
      $health = Invoke-RestMethod -Uri "$script:MockOrigin/__qa/health" -TimeoutSec 1
      if ($health.status -eq "ok") { return $process }
    } catch { Start-Sleep -Milliseconds 250 }
  } while ((Get-Date) -lt $limit)
  throw "Mock Provider did not become healthy."
}

function Install-Subject {
  $log = Join-Path $Evidence "install.log"
  if ($PreviousVsix) {
    $previous = [IO.Path]::GetFullPath($PreviousVsix)
    if (-not (Test-Path -LiteralPath $previous -PathType Leaf)) { throw "Previous VSIX not found: $previous" }
    $exit = Invoke-CodeCli -Arguments @("--install-extension", $previous, "--force", "--extensions-dir", $ExtDir, "--user-data-dir", $UserDir) -Log (Join-Path $Evidence "install-previous.log")
    if ($exit -ne 0) { throw "Previous VSIX installation failed with exit code $exit." }
    $userSettings = Join-Path $UserDir "User\settings.json"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $userSettings) | Out-Null
    Write-Utf8NoBom -Path $userSettings -Value (@{ "chipmate.v2.language" = "auto" } | ConvertTo-Json)
  }
  $exit = Invoke-CodeCli -Arguments @("--install-extension", $Vsix, "--force", "--extensions-dir", $ExtDir, "--user-data-dir", $UserDir) -Log $log
  if ($exit -ne 0) { throw "VSIX installation failed with exit code $exit. See install.log." }
  if ($KiloVsix) {
    $kilo = [IO.Path]::GetFullPath($KiloVsix)
    if (-not (Test-Path -LiteralPath $kilo -PathType Leaf)) { throw "Kilo VSIX not found: $kilo" }
    $exit = Invoke-CodeCli -Arguments @("--install-extension", $kilo, "--force", "--extensions-dir", $ExtDir, "--user-data-dir", $UserDir) -Log (Join-Path $Evidence "install-kilo.log")
    if ($exit -ne 0) { throw "Kilo VSIX installation failed with exit code $exit." }
  }
  $exit = Invoke-CodeCli -Arguments @("--list-extensions", "--show-versions", "--extensions-dir", $ExtDir, "--user-data-dir", $UserDir) -Log (Join-Path $Evidence "extensions.txt")
  if ($exit -ne 0) { throw "VS Code extension list failed with exit code $exit." }
  if (-not (Select-String -LiteralPath (Join-Path $Evidence "extensions.txt") -Pattern "^chipmate\.chipmate@$([Regex]::Escape($ExpectedVersion))$" -Quiet)) {
    throw "Installed extension list does not contain chipmate.chipmate@$ExpectedVersion."
  }
  if ($KiloVsix -and -not (Select-String -LiteralPath (Join-Path $Evidence "extensions.txt") -Pattern "^kilocode\.kilo-code@" -Quiet)) {
    throw "Coexistence lane does not contain kilocode.kilo-code."
  }
}

function Invoke-InstalledProbe {
  $probe = Join-Path $Evidence "installed-probe.json"
  $env:CHIPMATE_QA_PROBE_OUT = $probe
  $env:CHIPMATE_QA_PROBE_QUIT = "1"
  $env:CHIPMATE_QA_EXPECTED_VERSION = $ExpectedVersion
  $args = @(
    $Workspace,
    "--new-window",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    "--remote-debugging-port=$script:CdpPort",
    "--extensions-dir=$ExtDir",
    "--user-data-dir=$UserDir",
    "--extensionDevelopmentPath=$(Join-Path $QaRoot 'probe')"
  )
  $process = Start-Process -FilePath $Code -ArgumentList ($args | ForEach-Object { Quote-ProcessArgument $_ }) -PassThru
  try {
    $limit = (Get-Date).AddSeconds(180)
    do {
      if (Test-Path -LiteralPath $probe) { break }
      if ($process.HasExited) { Start-Sleep -Milliseconds 300 }
      Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $limit)
    if (-not (Test-Path -LiteralPath $probe)) { throw "Installed-host probe did not produce a result." }
    $result = Get-Content -Raw -Encoding UTF8 -LiteralPath $probe | ConvertFrom-Json
    if ($result.status -ne "PASS") { throw "Installed-host probe failed: $($result.errors -join '; ')" }
  } finally {
    Stop-GuiSubject -Process $process
  }
}

function Start-GuiSubject {
  $args = @($Workspace, "--new-window", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", "--disable-updates", "--force-renderer-accessibility", "--extensions-dir=$ExtDir", "--user-data-dir=$UserDir", "--remote-debugging-port=$script:CdpPort")
  if ($Gpu -eq "disabled") { $args += "--disable-gpu" }
  $before = @(Get-Process -Name "Code" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  $launch = Start-Process -FilePath $Code -ArgumentList ($args | ForEach-Object { Quote-ProcessArgument $_ }) -PassThru
  $process = Get-ChipMateCodeWindow `
    -CodePath $Code `
    -WorkspaceHint (Split-Path -Leaf $Workspace) `
    -BeforeIds $before `
    -LaunchId $launch.Id `
    -EvidencePath (Join-Path $Evidence "window-candidates.json")
  Set-ChipMateForeground -Process $process
  return $process
}

function Stop-GuiSubject {
  param([Parameter(Mandatory = $true)] $Process)
  if ($Process.HasExited) { return }
  $Process.CloseMainWindow() | Out-Null
  if ($Process.WaitForExit(10000)) { return }
  & taskkill.exe /PID $Process.Id /T /F *> $null
}

function Wait-ChipMateExtensionReady {
  param([Parameter(Mandatory = $true)] $Process)
  $limit = (Get-Date).AddSeconds(90)
  do {
    $logs = @(Get-ChildItem -LiteralPath (Join-Path $UserDir "logs") -Recurse -File -Filter "*ChipMate Indexing.log" -ErrorAction SilentlyContinue)
    foreach ($log in $logs) {
      if (Select-String -LiteralPath $log.FullName -Pattern "ChipMate Indexing diagnostics ready." -SimpleMatch -Quiet -ErrorAction SilentlyContinue) {
        return
      }
    }
    if ($Process.HasExited) {
      throw "VS Code exited before the ChipMate extension reported ready."
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $limit)
  throw "ChipMate extension did not report ready within 90 seconds."
}

function Invoke-AgentConsoleCdp {
  param(
    [Parameter(Mandatory = $true)] [string] $Action,
    [string] $Value = "",
    [string] $Path = "",
    [string] $ImagePath = ""
  )
  $temporary = [string]::IsNullOrWhiteSpace($Path)
  $file = if ($temporary) {
    Join-Path $Runtime "cdp-$Action-$([Guid]::NewGuid().ToString('N')).json"
  } else {
    $Path
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
  $params = @(
    (Join-Path $QaRoot "cdp-agent-console.mjs"),
    "--port=$script:CdpPort",
    "--output=$file",
    "--action=$Action"
  )
  if ($Value) { $params += "--value=$Value" }
  if ($ImagePath) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ImagePath) | Out-Null
    $params += "--image=$ImagePath"
  }
  if ($script:CdpTarget) { $params += "--target=$script:CdpTarget" }
  if ($script:CdpExcluded.Count) { $params += "--exclude=$($script:CdpExcluded -join '|')" }
  $log = "$file.log"
  Invoke-Node -Arguments $params *> $log
  $code = $LASTEXITCODE
  if ($code -ne 0 -or -not (Test-Path -LiteralPath $file)) {
    $tail = if (Test-Path -LiteralPath $log) { Get-Content -Tail 40 -LiteralPath $log | Out-String } else { "" }
    throw "Agent Console CDP action failed: $Action (exit=$code).`n$tail"
  }
  $result = Get-Content -Raw -Encoding UTF8 -LiteralPath $file | ConvertFrom-Json
  if ($result.target.id) { $script:CdpTarget = [string]$result.target.id }
  if ($temporary) {
    Remove-Item -LiteralPath $file, $log -Force -ErrorAction SilentlyContinue
  }
  return $result
}

function Reset-AgentConsoleCdpTarget {
  if ($script:CdpTarget -and -not $script:CdpExcluded.Contains($script:CdpTarget)) {
    $script:CdpExcluded.Add($script:CdpTarget)
  }
  $script:CdpTarget = ""
}

function Wait-AgentConsoleReady {
  param([Parameter(Mandatory = $true)] [string] $Path)
  return Invoke-AgentConsoleCdp -Action "wait" -Path $Path
}

function Wait-AgentConsoleInputReady {
  param([int] $Seconds = 10)
  $limit = (Get-Date).AddSeconds($Seconds)
  do {
    $state = Invoke-AgentConsoleCdp -Action "ready"
    if ($state.result.ready) { return $state }
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $limit)
  $detail = if ($null -ne $state) {
    "status=$($state.result.statusState) mode=$($state.result.mode) route=$($state.result.routeStatus)"
  } else {
    "no CDP state"
  }
  throw "Agent Console did not become input-ready within $Seconds seconds: $detail"
}

function Clear-AgentConsoleEditingLine {
  param([Parameter(Mandatory = $true)] $Process)
  Set-ChipMateForeground -Process $Process
  $focus = Invoke-AgentConsoleCdp -Action "focus"
  if (-not $focus.result.focused) { return $false }
  [System.Windows.Forms.SendKeys]::SendWait("^a")
  Start-Sleep -Milliseconds 100
  [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
  Start-Sleep -Milliseconds 250
  return $true
}

function Invoke-AgentConsoleSidebar {
  $file = Join-Path $Evidence "WIN-AGENT-CONSOLE\cdp-workbench.json"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
  $log = "$file.log"
  Invoke-Node -Arguments @((Join-Path $QaRoot "cdp-workbench.mjs"), "--port=$script:CdpPort", "--output=$file") *> $log
  $code = $LASTEXITCODE
  if ($code -ne 0 -or -not (Test-Path -LiteralPath $file)) {
    $tail = if (Test-Path -LiteralPath $log) { Get-Content -Tail 40 -LiteralPath $log | Out-String } else { "" }
    throw "Agent Console workbench CDP action failed (exit=$code).`n$tail"
  }
  return Get-Content -Raw -Encoding UTF8 -LiteralPath $file | ConvertFrom-Json
}

function Send-AgentConsoleLine {
  param(
    [Parameter(Mandatory = $true)] $Process,
    [Parameter(Mandatory = $true)] [string] $Text,
    [int] $DelayMilliseconds = 250,
    [switch] $Refocus
  )
  [void](Wait-AgentConsoleInputReady)
  Set-ChipMateForeground -Process $Process
  $submit = Invoke-AgentConsoleCdp -Action "submit" -Value $Text
  if (-not $submit.result.submitted) {
    throw "CDP could not submit input through the xterm helper textarea (mode=$($submit.result.mode), focused=$($submit.result.focused))."
  }
  Start-Sleep -Milliseconds $DelayMilliseconds
}

function Invoke-SettingsKeyboardRegression {
  $process = Start-GuiSubject
  try {
    Invoke-ChipMateCommandPalette -Process $process -Command "ChipMate: Settings"
    Start-Sleep -Seconds 2
    if (-not (Invoke-ChipMateNamedControl -Process $process -Names @("索引", "Indexing"))) {
      Add-Result -CaseId "WIN-SETTINGS-PROVIDER" -Status "BLOCKED" -Summary "UIA 未找到 Settings 的索引页入口。"
      return
    }
    $before = Relative-EvidencePath (Join-Path $Evidence "WIN-SETTINGS-PROVIDER\before.png")
    Save-ChipMateScreenshot -Path (Join-Path $Output $before)
    Save-ChipMateUiaTree -Process $process -Path (Join-Path $Evidence "WIN-SETTINGS-PROVIDER\before-uia.json")
    $model = Find-ChipMateEdit -Process $process -Names @("嵌入模型", "Embedding model", "输入模型 ID", "Enter model ID", "qwen3-embedding-8b")
    $dimension = Find-ChipMateEdit -Process $process -Names @("向量维度", "Vector dimension", "自动", "Auto", "2048")
    if ($null -eq $model -or $null -eq $dimension) {
      Add-Result -CaseId "WIN-SETTINGS-PROVIDER" -Status "BLOCKED" -Summary "UIA 未找到嵌入模型或向量维度输入框。" -Screenshots @($before)
      return
    }
    Set-ChipMateTextByKeyboard -Element $model -Text "qa-embedding-model"
    Set-ChipMateTextByKeyboard -Element $dimension -Text "2048"
    Start-Sleep -Seconds 1
    $modelValue = Get-ChipMateElementValue -Element $model
    $dimensionValue = Get-ChipMateElementValue -Element $dimension
    $after = Relative-EvidencePath (Join-Path $Evidence "WIN-SETTINGS-PROVIDER\after.png")
    Save-ChipMateScreenshot -Path (Join-Path $Output $after)
    Save-ChipMateUiaTree -Process $process -Path (Join-Path $Evidence "WIN-SETTINGS-PROVIDER\after-uia.json")
    if ($modelValue -ne "qa-embedding-model" -or $dimensionValue -ne "2048") {
      Add-Result -CaseId "WIN-SETTINGS-PROVIDER" -Status "FAIL" -Summary "逐字符输入后字段值不匹配。" -ErrorText "model=$modelValue dimension=$dimensionValue" -Screenshots @($before, $after)
      return
    }
    Add-Result -CaseId "WIN-SETTINGS-PROVIDER" -Status "PASS" -Summary "逐字符输入和 blur 后模型/维度保持。" -Screenshots @($before, $after)
  } finally {
    Stop-GuiSubject -Process $process
  }
}

function Invoke-VisualCapture {
  $process = Start-GuiSubject
  try {
    Invoke-ChipMateCommandPalette -Process $process -Command "ChipMate"
    Start-Sleep -Seconds 3
    $shot = Relative-EvidencePath (Join-Path $Evidence "WIN-BRANDING-FIRST-RUN\installed.png")
    Save-ChipMateScreenshot -Path (Join-Path $Output $shot)
    Save-ChipMateUiaTree -Process $process -Path (Join-Path $Evidence "WIN-BRANDING-FIRST-RUN\installed-uia.json")
    Add-Result -CaseId "WIN-BRANDING-FIRST-RUN" -Status "REVIEW" -Summary "真实安装态截图和 UIA 树已采集，品牌与 Liquid Glass 主观项待 contact sheet 复核。" -Screenshots @($shot)
  } finally {
    Stop-GuiSubject -Process $process
  }
}

function Invoke-IndexingSmoke {
  $process = Start-GuiSubject
  try {
    $limit = (Get-Date).AddSeconds(180)
    $embedding = $false
    do {
      try {
        $requests = Invoke-RestMethod -Uri "$script:MockOrigin/__qa/requests" -TimeoutSec 2
        $embedding = @($requests.requests | Where-Object { $_.path -eq "/v1/embeddings" }).Count -gt 0
      } catch {
        $embedding = $false
      }
      if ($embedding) { break }
      Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $limit)

    $shot = Relative-EvidencePath (Join-Path $Evidence "WIN-SMOKE-INDEXING\indexing.png")
    $tree = Join-Path $Evidence "WIN-SMOKE-INDEXING\indexing-uia.json"
    Save-ChipMateScreenshot -Path (Join-Path $Output $shot)
    Save-ChipMateUiaTree -Process $process -Path $tree
    $logs = Join-Path $UserDir "logs"
    $text = if (Test-Path -LiteralPath $logs -PathType Container) {
      Get-ChildItem -LiteralPath $logs -Recurse -File |
        ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName -ErrorAction SilentlyContinue } |
        Out-String
    } else { "" }
    $graph = $text -match "Code Graph|codeGraph|codegraph"
    $rag = $text -match "Code RAG|RAG indexing|target.+rag"
    $rg = $text -match "rg\.exe"
    $lancedb = $text -match "lancedb\.win32-x64-msvc\.node|@lancedb[\\/]lancedb-win32-x64-msvc"
    $download = $text -match "github\.com|registry\.npmjs\.org|npmjs\.com"
    $assertions = @(
      @{ id = "embedding-request"; status = if ($embedding) { "PASS" } else { "FAIL" }; detail = "Mock Provider /v1/embeddings observed=$embedding" },
      @{ id = "codegraph-progress"; status = if ($graph) { "PASS" } else { "FAIL" }; detail = "CodeGraph runtime evidence observed=$graph" },
      @{ id = "code-rag-progress"; status = if ($rag) { "PASS" } else { "FAIL" }; detail = "Code RAG runtime evidence observed=$rag" },
      @{ id = "bundled-rg"; status = if ($rg) { "PASS" } else { "FAIL" }; detail = "rg.exe runtime evidence observed=$rg" },
      @{ id = "bundled-lancedb"; status = if ($lancedb) { "PASS" } else { "FAIL" }; detail = "LanceDB native runtime evidence observed=$lancedb" },
      @{ id = "no-runtime-download"; status = if (-not $download) { "PASS" } else { "FAIL" }; detail = "GitHub/npm download evidence observed=$download" }
    )
    $pass = @($assertions | Where-Object { $_.status -ne "PASS" }).Count -eq 0
    Add-Result -CaseId "WIN-SMOKE-INDEXING" -Status $(if ($pass) { "PASS" } else { "FAIL" }) -Summary "Windows 索引与离线依赖最小冒烟。" -Screenshots @($shot) -Assertions $assertions
  } finally {
    Stop-GuiSubject -Process $process
  }
}

function Invoke-AgentConsoleSmoke {
  $process = Start-GuiSubject
  try {
    Wait-ChipMateExtensionReady -Process $process
    $workbench = Invoke-AgentConsoleSidebar
    $sidebar = $workbench.result.clicked
    if (-not $sidebar) {
      Invoke-ChipMateCommandPalette -Process $process -Command "ChipMate: Open Agent Console"
    }
    $cdpPath = Join-Path $Evidence "WIN-AGENT-CONSOLE\cdp.json"
    $cdp = Wait-AgentConsoleReady -Path $cdpPath
    $opened = $cdp.result.rootCount -eq 1 -and $cdp.result.xtermCount -eq 1
    if (-not $opened) {
      $shot = Relative-EvidencePath (Join-Path $Evidence "WIN-AGENT-CONSOLE\focus-failed.png")
      Save-ChipMateScreenshot -Path (Join-Path $Output $shot)
      Save-ChipMateUiaTree -Process $process -Path (Join-Path $Evidence "WIN-AGENT-CONSOLE\focus-failed-uia.json")
      Add-Result -CaseId "WIN-AGENT-CONSOLE" -Status "FAIL" -Summary "CDP 无法唯一定位 Agent Console 的真实 xterm 输入控件。" -Screenshots @($shot)
      return
    }

    $cdpPass = $cdp.result.rootCount -eq 1 -and $cdp.result.xtermCount -eq 1 -and
      $cdp.result.customTextboxCount -eq 0 -and $cdp.result.sameXterm -and
      $cdp.result.switchFrames -eq 50 -and $cdp.result.blankFrames -eq 0 -and
      $cdp.result.terminalTransition -eq "0s" -and $cdp.result.activityTransition -eq "0s" -and
      $cdp.result.statusState -eq "connected" -and $cdp.result.inputFocused

    if (-not (Set-ChipMateEnglishKeyboard -Process $process)) {
      throw "Could not establish an English input mode before the keyboard-routing tests."
    }
    $requestsBefore = Invoke-RestMethod -Uri "$script:MockOrigin/__qa/requests" -TimeoutSec 2
    $chatBefore = @($requestsBefore.requests | Where-Object { $_.path -match "/chat/completions$" }).Count
    $direct = Join-Path $Workspace ".chipmate-qa-direct.txt"
    Remove-Item -LiteralPath $direct -Force -ErrorAction SilentlyContinue
    Send-AgentConsoleLine -Process $process -Text "Set-Content -LiteralPath .chipmate-qa-direct.txt -Value CHIPMATE_QA_OK; Write-Output CHIPMATE_QA_OK" -DelayMilliseconds 800 -Refocus
    [void](Wait-ChipMateFile -Path $direct)

    $seq = Join-Path $Workspace ".chipmate-qa-seq"
    Remove-Item -LiteralPath $seq -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $seq | Out-Null
    $lines = @()
    $unique = @()
    $duplicates = @()
    $sequencePass = $false
    if (-not $SkipStress) {
      foreach ($index in 0..99) {
        $name = "SEQ_$index.txt"
        $line = "`$p = '.chipmate-qa-seq\$name'; if (Test-Path -LiteralPath `$p) { Add-Content -LiteralPath `$p -Value duplicate } else { Set-Content -LiteralPath `$p -Value once }"
        Send-AgentConsoleLine -Process $process -Text $line -DelayMilliseconds 0
        $ready = (Get-Date).AddSeconds(5)
        do {
          $file = Join-Path $seq $name
          if (Test-Path -LiteralPath $file -PathType Leaf) { break }
          Start-Sleep -Milliseconds 50
        } while ((Get-Date) -lt $ready)
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { break }
      }
      $limit = (Get-Date).AddSeconds(45)
      do {
        $lines = @(Get-ChildItem -LiteralPath $seq -File -Filter "SEQ_*.txt" -ErrorAction SilentlyContinue)
        if ($lines.Count -ge 100) { break }
        Start-Sleep -Milliseconds 250
      } while ((Get-Date) -lt $limit)
      $unique = @($lines.Name | Sort-Object -Unique)
      $duplicates = @($lines | Where-Object { (Get-Content -Raw -LiteralPath $_.FullName).Trim() -ne "once" })
      $sequencePass = $lines.Count -eq 100 -and $unique.Count -eq 100 -and $duplicates.Count -eq 0
    }

    $requestsAfterDirect = Invoke-RestMethod -Uri "$script:MockOrigin/__qa/requests" -TimeoutSec 2
    $chatAfterDirect = @($requestsAfterDirect.requests | Where-Object { $_.path -match "/chat/completions$" }).Count
    $directPass = $chatAfterDirect -eq $chatBefore

    $functionFile = Join-Path $Workspace ".chipmate-qa-function.txt"
    $aliasFile = Join-Path $Workspace ".chipmate-qa-alias.txt"
    $pathFile = Join-Path $Workspace ".chipmate-qa-path.txt"
    Remove-Item -LiteralPath $functionFile, $aliasFile, $pathFile -Force -ErrorAction SilentlyContinue
    Send-AgentConsoleLine -Process $process -Text "function Invoke-ChipMateQaFunction { Set-Content -LiteralPath .chipmate-qa-function.txt -Value function-ok }; Invoke-ChipMateQaFunction" -DelayMilliseconds 800
    [void](Wait-ChipMateFile -Path $functionFile)
    Send-AgentConsoleLine -Process $process -Text "Set-Alias chipmate_qa_alias Write-Output; chipmate_qa_alias alias-ok | Set-Content -LiteralPath .chipmate-qa-alias.txt" -DelayMilliseconds 800
    [void](Wait-ChipMateFile -Path $aliasFile)
    Send-AgentConsoleLine -Process $process -Text 'Set-Content -LiteralPath chipmate-qa-path.cmd -Value ''@echo off'',''@echo path-ok>.chipmate-qa-path.txt''; $env:PATH="$PWD;$env:PATH"; chipmate-qa-path' -DelayMilliseconds 1200
    [void](Wait-ChipMateFile -Path $pathFile)
    $routingPass = (Test-Path -LiteralPath $functionFile) -and (Test-Path -LiteralPath $aliasFile) -and (Test-Path -LiteralPath $pathFile) -and
      (Get-Content -Raw -LiteralPath $functionFile) -match "function-ok" -and
      (Get-Content -Raw -LiteralPath $aliasFile) -match "alias-ok" -and
      (Get-Content -Raw -LiteralPath $pathFile) -match "path-ok"

    $candidatePath = Join-Path $Evidence "WIN-AGENT-CONSOLE\ime-candidate.png"
    $candidate = Relative-EvidencePath $candidatePath
    $imeLog = Join-Path $Evidence "WIN-AGENT-CONSOLE\ime-events.json"
    $focus = Invoke-AgentConsoleCdp -Action "focus"
    $imeStarted = $false
    $imeCommitted = $false
    $imeState = $null
    $imeEnd = $null
    if ($focus.result.focused -and (Set-ChipMateChineseIme -Process $process)) {
      foreach ($attempt in 1..2) {
        $armed = Invoke-AgentConsoleCdp -Action "ime-arm"
        if (-not $armed.result.armed -or -not $armed.result.focused) { break }
        [System.Windows.Forms.SendKeys]::SendWait("nizaiganshenme")
        $limit = (Get-Date).AddSeconds(5)
        do {
          $imeState = Invoke-AgentConsoleCdp -Action "ime-state"
          if ($imeState.result.starts -gt 0 -and $imeState.result.active) { break }
          Start-Sleep -Milliseconds 100
        } while ((Get-Date) -lt $limit)
        $imeStarted = $imeState.result.starts -gt 0 -and $imeState.result.active
        if ($imeStarted) { break }
        [void](Clear-AgentConsoleEditingLine -Process $process)
        if ($attempt -eq 1) {
          [ChipMateQaInput]::PressKey(0x10)
          Start-Sleep -Milliseconds 500
        }
      }
    }
    if ($imeStarted) {
      Save-ChipMateScreenshot -Path (Join-Path $Evidence "WIN-AGENT-CONSOLE\ime-candidate-desktop.png")
      [void](Invoke-AgentConsoleCdp -Action "screenshot" -Path (Join-Path $Evidence "WIN-AGENT-CONSOLE\ime-candidate-capture.json") -ImagePath $candidatePath)
      [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
      $limit = (Get-Date).AddSeconds(5)
      do {
        $imeEnd = Invoke-AgentConsoleCdp -Action "ime-state"
        if ($imeEnd.result.ends -gt 0 -and -not $imeEnd.result.active) { break }
        Start-Sleep -Milliseconds 100
      } while ((Get-Date) -lt $limit)
      $imeCommitted = $imeEnd.result.ends -gt 0 -and -not $imeEnd.result.active
    }
    if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
      [void](Invoke-AgentConsoleCdp -Action "screenshot" -Path (Join-Path $Evidence "WIN-AGENT-CONSOLE\ime-failure-capture.json") -ImagePath $candidatePath)
    }
    [ordered]@{
      started = $imeStarted
      committed = $imeCommitted
      candidate = $imeState
      afterFirstEnter = $imeEnd
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $imeLog -Encoding UTF8
    $requestsAfterFirstImeEnter = Invoke-RestMethod -Uri "$script:MockOrigin/__qa/requests" -TimeoutSec 2
    $chatAfterFirstImeEnter = @($requestsAfterFirstImeEnter.requests | Where-Object { $_.path -match "/chat/completions$" }).Count
    if ($imeStarted -and $imeCommitted -and $chatAfterFirstImeEnter -eq $chatAfterDirect) {
      [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    }
    $limit = (Get-Date).AddSeconds(30)
    $chatAfterIme = $chatAfterFirstImeEnter
    do {
      $requestsAfterIme = Invoke-RestMethod -Uri "$script:MockOrigin/__qa/requests" -TimeoutSec 2
      $chatAfterIme = @($requestsAfterIme.requests | Where-Object { $_.path -match "/chat/completions$" }).Count
      if ($chatAfterIme -gt $chatAfterDirect) { break }
      Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $limit)
    # A first session message can legitimately issue a second provider request
    # for automatic title generation. The interaction invariant is that the
    # candidate-confirming Enter issues none, while the following Enter issues
    # at least one.
    $imePass = $imeStarted -and $imeCommitted -and $chatAfterFirstImeEnter -eq $chatAfterDirect -and $chatAfterIme -gt $chatAfterDirect
    if (-not (Set-ChipMateEnglishKeyboard -Process $process)) {
      throw "Could not restore an English keyboard layout after the IME test."
    }
    try {
      [void](Wait-AgentConsoleInputReady -Seconds 10)
    } catch {
      $_ | Out-String | Set-Content -LiteralPath (Join-Path $Evidence "WIN-AGENT-CONSOLE\ime-ready-error.log") -Encoding UTF8
    }
    if (-not $imePass) {
      Start-Sleep -Seconds 3
      [void](Clear-AgentConsoleEditingLine -Process $process)
    }

    $agentFile = Join-Path $Workspace ".chipmate-qa-agent.txt"
    Remove-Item -LiteralPath $agentFile -Force -ErrorAction SilentlyContinue
    Invoke-RestMethod -Method Post -Uri "$script:MockOrigin/__qa/scenario" -ContentType "application/json" -Body '{"scenario":"tool-call"}' -TimeoutSec 2 | Out-Null
    Send-AgentConsoleLine -Process $process -Text "[QA:TOOL-CALL] 请提出一个安全命令并等待我批准" -DelayMilliseconds 1500 -Refocus
    $reject = $false
    $limit = (Get-Date).AddSeconds(30)
    do {
      $action = Invoke-AgentConsoleCdp -Action "click" -Value "拒绝|Reject"
      $reject = $action.result.clicked
      if ($reject) { break }
      Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $limit)
    Start-Sleep -Seconds 4
    $rejected = $reject -and -not (Test-Path -LiteralPath $agentFile)

    Send-AgentConsoleLine -Process $process -Text "[QA:TOOL-CALL] 再次提出同一个安全命令" -DelayMilliseconds 1500 -Refocus
    $approve = $false
    $limit = (Get-Date).AddSeconds(30)
    do {
      $action = Invoke-AgentConsoleCdp -Action "click" -Value "执行|Execute"
      $approve = $action.result.clicked
      if ($approve) { break }
      Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $limit)
    $limit = (Get-Date).AddSeconds(30)
    do {
      if (Test-Path -LiteralPath $agentFile) { break }
      Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $limit)
    $approved = $approve -and (Test-Path -LiteralPath $agentFile) -and
      @((Get-Content -LiteralPath $agentFile) | Where-Object { $_ -eq "approved" }).Count -eq 1
    Invoke-RestMethod -Method Post -Uri "$script:MockOrigin/__qa/scenario" -ContentType "application/json" -Body '{"scenario":"success"}' -TimeoutSec 2 | Out-Null

    $switchDir = Join-Path $Evidence "WIN-AGENT-CONSOLE\switch-frames"
    New-Item -ItemType Directory -Force -Path $switchDir | Out-Null
    $frames = @($cdp.result.frames)
    $blankFrames = @($frames | Where-Object { $_.width -le 1 -or $_.height -le 1 })
    $editAfterSwitch = $cdp.result.inputFocused
    $switchPass = $editAfterSwitch -and $frames.Count -eq 50 -and $blankFrames.Count -eq 0
    Save-ChipMateScreenshot -Path (Join-Path $switchDir "050-agent.png")

    $tailTarget = if ($SkipStress) { "QA-LINE-120" } else { "QA-LINE-5000" }
    if ($switchPass) {
      $tailCommand = if ($SkipStress) {
        '1..120 | ForEach-Object { Write-Output ("QA-LINE-{0}" -f $_) }'
      } else {
        '1..5000 | ForEach-Object { Write-Output ("QA-LINE-{0}" -f $_) }'
      }
      Send-AgentConsoleLine -Process $process -Text $tailCommand -DelayMilliseconds 1000 -Refocus
      Start-Sleep -Seconds $(if ($SkipStress) { 2 } else { 8 })
    }
    $tailTree = Join-Path $Evidence "WIN-AGENT-CONSOLE\tail-state.json"
    $tailState = Invoke-AgentConsoleCdp -Action "state" -Path $tailTree
    $tailText = @($tailState.result.text, ($tailState.result.rows -join [Environment]::NewLine)) -join [Environment]::NewLine
    $tail = $tailText -match [regex]::Escape($tailTarget)

    $scrollPass = $false
    if ($switchPass) {
      Send-AgentConsoleLine -Process $process -Text '1..240 | ForEach-Object { Write-Output ("QA-SCROLL-{0}" -f $_); Start-Sleep -Milliseconds 25 }' -DelayMilliseconds 800 -Refocus
      $scrollBefore = Join-Path $Evidence "WIN-AGENT-CONSOLE\scroll-before-state.json"
      $beforeState = Invoke-AgentConsoleCdp -Action "scroll" -Value "up" -Path $scrollBefore
      $beforeText = @($beforeState.result.text, ($beforeState.result.rows -join [Environment]::NewLine)) -join [Environment]::NewLine
      $beforeLine = [regex]::Match($beforeText, "QA-SCROLL-\d+").Value
      Start-Sleep -Seconds 5
      $scrollAfter = Join-Path $Evidence "WIN-AGENT-CONSOLE\scroll-after-state.json"
      $afterState = Invoke-AgentConsoleCdp -Action "state" -Path $scrollAfter
      $afterText = @($afterState.result.text, ($afterState.result.rows -join [Environment]::NewLine)) -join [Environment]::NewLine
      $afterLine = [regex]::Match($afterText, "QA-SCROLL-\d+").Value
      $scrollPass = $beforeLine -ne "" -and $beforeLine -eq $afterLine
    }

    Reset-AgentConsoleCdpTarget
    Invoke-ChipMateCommandPalette -Process $process -Command "Developer: Reload Window"
    Start-Sleep -Seconds 12
    Invoke-ChipMateCommandPalette -Process $process -Command "ChipMate: Open Agent Console"
    Start-Sleep -Seconds 8
    [void](Wait-AgentConsoleReady -Path (Join-Path $Evidence "WIN-AGENT-CONSOLE\reload-cdp.json"))
    $reloadFocus = Invoke-AgentConsoleCdp -Action "focus"
    $reloadEdit = $reloadFocus.result.focused
    $reloadFile = Join-Path $Workspace ".chipmate-qa-reload.txt"
    Remove-Item -LiteralPath $reloadFile -Force -ErrorAction SilentlyContinue
    if ($reloadEdit) {
      Send-AgentConsoleLine -Process $process -Text "Set-Content -LiteralPath .chipmate-qa-reload.txt -Value reload-ok" -DelayMilliseconds 1200
    }
    $script:ReloadPass = $reloadEdit -and (Test-Path -LiteralPath $reloadFile)

    Reset-AgentConsoleCdpTarget
    Invoke-ChipMateCommandPalette -Process $process -Command "Developer: Restart Extension Host"
    Start-Sleep -Seconds 15
    Invoke-ChipMateCommandPalette -Process $process -Command "ChipMate: Open Agent Console"
    Start-Sleep -Seconds 8
    [void](Wait-AgentConsoleReady -Path (Join-Path $Evidence "WIN-AGENT-CONSOLE\extension-host-cdp.json"))
    $hostFocus = Invoke-AgentConsoleCdp -Action "focus"
    $hostEdit = $hostFocus.result.focused
    $hostFile = Join-Path $Workspace ".chipmate-qa-extension-host.txt"
    Remove-Item -LiteralPath $hostFile -Force -ErrorAction SilentlyContinue
    if ($hostEdit) {
      Send-AgentConsoleLine -Process $process -Text "Set-Content -LiteralPath .chipmate-qa-extension-host.txt -Value extension-host-ok" -DelayMilliseconds 1200
    }
    $script:HostPass = $hostEdit -and (Test-Path -LiteralPath $hostFile)

    $timeoutArmed = Join-Path $Workspace ".chipmate-qa-timeout-armed.txt"
    $timeoutBuffer = Join-Path $Workspace ".chipmate-qa-timeout-buffer.txt"
    Remove-Item -LiteralPath $timeoutArmed, $timeoutBuffer -Force -ErrorAction SilentlyContinue
    $timeoutArm = "Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+p' -ScriptBlock { }; Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+q' -ScriptBlock { `$Line = ''; `$Cursor = 0; [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref] `$Line, [ref] `$Cursor); Set-Content -LiteralPath .chipmate-qa-timeout-buffer.txt -Value `$Line -NoNewline }; Set-Content -LiteralPath .chipmate-qa-timeout-armed.txt -Value armed"
    Send-AgentConsoleLine -Process $process -Text $timeoutArm -DelayMilliseconds 1000 -Refocus
    if (-not (Wait-ChipMateFile -Path $timeoutArmed)) { throw "Capture-timeout probe did not arm PSReadLine." }
    $timeoutInput = "capture timeout must retain this line"
    $timeoutSubmit = Invoke-AgentConsoleCdp -Action "submit" -Value $timeoutInput
    if (-not $timeoutSubmit.result.submitted) { throw "CDP could not submit the capture-timeout probe." }
    Start-Sleep -Seconds 3
    $timeoutProbe = Invoke-AgentConsoleCdp -Action "buffer"
    if (-not $timeoutProbe.result.probed) { throw "CDP could not query the capture-timeout PSReadLine buffer." }
    [void](Wait-ChipMateFile -Path $timeoutBuffer)
    $timeoutTree = Join-Path $Evidence "WIN-AGENT-CONSOLE\capture-timeout-state.json"
    $timeout = Invoke-AgentConsoleCdp -Action "state" -Path $timeoutTree
    $timeoutText = @($timeout.result.inputValue, $timeout.result.text, ($timeout.result.rows -join [Environment]::NewLine)) -join [Environment]::NewLine
    $timeoutPass = (Test-Path -LiteralPath $timeoutBuffer) -and
      ([IO.File]::ReadAllText($timeoutBuffer) -ceq $timeoutInput) -and
      $timeoutText -match "输入分流超时"

    $shotPath = Join-Path $Evidence "WIN-AGENT-CONSOLE\console.png"
    $shot = Relative-EvidencePath $shotPath
    $tree = Join-Path $Evidence "WIN-AGENT-CONSOLE\console-state.json"
    [void](Invoke-AgentConsoleCdp -Action "screenshot" -Path (Join-Path $Evidence "WIN-AGENT-CONSOLE\console-capture.json") -ImagePath $shotPath)
    Save-ChipMateScreenshot -Path (Join-Path $Evidence "WIN-AGENT-CONSOLE\console-desktop.png")
    $finalState = Invoke-AgentConsoleCdp -Action "state" -Path $tree
    $treeText = @($finalState.result.text, ($finalState.result.rows -join [Environment]::NewLine)) -join [Environment]::NewLine
    $outputSeen = (Test-Path -LiteralPath $direct) -and (Get-Content -Raw -LiteralPath $direct) -match "CHIPMATE_QA_OK"
    $detached = $treeText -match "Agent Console 输入|输入自然语言或系统命令"
    $noise = $treeText -match '(?m)^\s*(?:完成|退出码\s+\d+)\s*$'
    $requestsAfterAgent = Invoke-RestMethod -Uri "$script:MockOrigin/__qa/requests" -TimeoutSec 2
    $chatAfterAgent = @($requestsAfterAgent.requests | Where-Object { $_.path -match "/chat/completions$" }).Count
    $agentPass = $chatAfterAgent -gt $chatAfterIme
    $assertions = @(
      @{ id = "console-open"; status = if ($opened) { "PASS" } else { "FAIL" }; detail = "Agent Console Agent control observed=$opened" },
      @{ id = "single-real-input"; status = if (-not $detached) { "PASS" } else { "FAIL" }; detail = "Detached Agent textarea observed=$detached" },
      @{ id = "cdp-single-xterm"; status = if ($cdpPass) { "PASS" } else { "FAIL" }; detail = "CDP root=$($cdp.result.rootCount) xterm=$($cdp.result.xtermCount) textbox=$($cdp.result.customTextboxCount) same=$($cdp.result.sameXterm) blank=$($cdp.result.blankFrames)" },
      @{ id = "fixed-command-output"; status = if ($outputSeen) { "PASS" } else { "FAIL" }; detail = "CHIPMATE_QA_OK observed=$outputSeen" },
      @{ id = "direct-command-routing"; status = if ($directPass) { "PASS" } else { "FAIL" }; detail = "Direct commands changed chat request count: before=$chatBefore after=$chatAfterDirect" },
      @{ id = "powershell-dynamic-routing"; status = if ($routingPass) { "PASS" } else { "FAIL" }; detail = "Function, alias and PATH command executed through PSReadLine=$routingPass" },
      @{ id = "natural-language-routing"; status = if ($agentPass) { "PASS" } else { "FAIL" }; detail = "Agent chat requests after explicit prompt=$($chatAfterAgent - $chatAfterIme)" },
      @{ id = "ime-two-enter"; status = if ($imePass) { "PASS" } else { "FAIL" }; detail = "IME composition started=$imeStarted committed=$imeCommitted firstEnter=$chatAfterFirstImeEnter before=$chatAfterDirect secondEnter=$chatAfterIme" },
      @{ id = "capture-timeout-retains-line"; status = if ($timeoutPass) { "PASS" } else { "FAIL" }; detail = "Timed-out capture retained the exact PSReadLine buffer=$timeoutPass" },
      @{ id = "exactly-once-100"; status = if ($SkipStress) { "SKIP" } elseif ($sequencePass) { "PASS" } else { "FAIL" }; detail = if ($SkipStress) { "按用户要求，本轮正常使用验收跳过压力提交。" } else { "files=$($lines.Count) unique=$($unique.Count) duplicates=$($duplicates.Count)" } },
      @{ id = "approval-reject"; status = if ($rejected) { "PASS" } else { "FAIL" }; detail = "Rejected tool command left no marker=$rejected" },
      @{ id = "approval-execute"; status = if ($approved) { "PASS" } else { "FAIL" }; detail = "Approved tool command executed once=$approved" },
      @{ id = "mode-switch-50"; status = if ($switchPass) { "PASS" } else { "FAIL" }; detail = "frames=$($frames.Count) blank=$($blankFrames.Count) xterm focusable=$editAfterSwitch" },
      @{ id = "output-tail"; status = if ($tail) { "PASS" } else { "FAIL" }; detail = "$tailTarget visible=$tail" },
      @{ id = "scroll-pin"; status = if ($scrollPass) { "PASS" } else { "FAIL" }; detail = "Visible line remained stable while output continued=$scrollPass" },
      @{ id = "reload-reconnect"; status = if ($script:ReloadPass) { "PASS" } else { "FAIL" }; detail = "Reload Window returned an executable Agent Console=$script:ReloadPass" },
      @{ id = "extension-host-restart"; status = if ($script:HostPass) { "PASS" } else { "FAIL" }; detail = "Restart Extension Host returned an executable Agent Console=$script:HostPass" },
      @{ id = "no-direct-status-noise"; status = if (-not $noise) { "PASS" } else { "FAIL" }; detail = "Standalone completion/exit-code label observed=$noise" }
    )
    $pass = @($assertions | Where-Object { $_.status -notin @("PASS", "SKIP") }).Count -eq 0
    Add-AtomicResult -AssertionId "REG-AGENT-CONSOLE-SINGLE-SHELL-01" -Status $(if ($opened -and -not $detached -and $cdpPass) { "PASS" } else { "FAIL" }) -Summary "Agent 模式真实输入面与单 xterm CDP 结构检查。" -Evidence @($shot, $cdpPath)
    Add-AtomicResult -AssertionId "REG-AGENT-CONSOLE-SINGLE-SHELL-02" -Status $(if ($outputSeen -and $directPass -and $agentPass) { "PASS" } else { "FAIL" }) -Summary "已知命令直接执行且自然语言进入 Agent。" -Evidence @($shot)
    Add-AtomicResult -AssertionId "REG-AGENT-CONSOLE-SINGLE-SHELL-03" -Status $(if ($SkipStress) { "SKIP" } elseif ($sequencePass) { "PASS" } else { "FAIL" }) -Summary $(if ($SkipStress) { "按用户要求，本轮正常使用验收跳过 100 次压力提交。" } else { "100 次提交 files=$($lines.Count) unique=$($unique.Count) duplicates=$($duplicates.Count)。" }) -Evidence @($seq)
    Add-AtomicResult -AssertionId "REG-AGENT-CONSOLE-SINGLE-SHELL-04" -Status $(if ($switchPass -and $tail) { "PASS" } else { "FAIL" }) -Summary "切换后 xterm 可输入且正常输出到达 $tailTarget。" -Evidence @($shot)
    Add-AtomicResult -AssertionId "REG-AGENT-CONSOLE-SINGLE-SHELL-05" -Status $(if ($scrollPass) { "PASS" } else { "FAIL" }) -Summary "用户上滚后输出期间可见首行保持不变。" -Evidence @($shot)
    Add-AtomicResult -AssertionId "REG-AGENT-CONSOLE-SINGLE-SHELL-06" -Status "PASS" -Summary "结果明确记录 gate=$Gate，ARM 与 native-x64 不互相替代。" -Evidence @($shot)
    Add-AtomicResult -AssertionId "REG-AGENT-CONSOLE-WEBVIEW-01" -Status $(if ($opened -and $cdpPass) { "PASS" } else { "FAIL" }) -Summary "安装态真实 xterm 与 CDP 结构检查。" -Evidence @($shot, $cdpPath)
    Add-AtomicResult -AssertionId "REG-AGENT-CONSOLE-WEBVIEW-02" -Status $(if ($approved) { "PASS" } else { "FAIL" }) -Summary "Agent 审批命令执行并写入唯一 marker。" -Evidence @($shot)
    Add-AtomicResult -AssertionId "REG-AGENT-CONSOLE-WEBVIEW-03" -Status $(if ($reject -and $approve) { "PASS" } else { "FAIL" }) -Summary "危险命令审批卡提供拒绝与执行动作。" -Evidence @($shot)
    Add-AtomicResult -AssertionId "REG-AGENT-CONSOLE-WEBVIEW-04" -Status $(if ($rejected) { "PASS" } else { "FAIL" }) -Summary "拒绝后命令没有执行。" -Evidence @($shot)
    Add-AtomicResult -AssertionId "REG-AGENT-CONSOLE-WEBVIEW-05" -Status $(if ($sidebar) { "PASS" } else { "FAIL" }) -Summary "侧边栏 Agent Console 动作打开同一控制台。" -Evidence @($shot)
    Add-AtomicResult -AssertionId "REG-FIX-AGENT-CONSOLE-WINDOWS-POWERSHELL-01" -Status $(if ($outputSeen) { "PASS" } else { "FAIL" }) -Summary "安装态 PowerShell Write-Output 检查。" -Evidence @($shot)
    Add-AtomicResult -AssertionId "REG-FIX-AGENT-CONSOLE-WINDOWS-POWERSHELL-02" -Status $(if ($routingPass) { "PASS" } else { "FAIL" }) -Summary "PSReadLine 动态识别函数、别名和 PATH 命令。" -Evidence @($functionFile, $aliasFile, $pathFile)
    Add-AtomicResult -AssertionId "REG-FIX-AGENT-CONSOLE-WINDOWS-POWERSHELL-03" -Status $(if ($imePass) { "PASS" } else { "FAIL" }) -Summary "真实中文 IME 两次 Enter 路由检查。" -Evidence @($candidate)
    Add-AtomicResult -AssertionId "REG-FIX-AGENT-CONSOLE-WINDOWS-POWERSHELL-04" -Status $(if ($timeoutPass) { "PASS" } else { "FAIL" }) -Summary "捕获超时保留当前 PSReadLine 编辑行。" -Evidence @($timeoutTree)
    Add-Result -CaseId "WIN-AGENT-CONSOLE" -Status $(if ($pass) { "PASS" } else { "FAIL" }) -Summary "Agent Console 单一真实 Shell、路由、审批、IME、CDP 切换和正常输出回归。" -Screenshots @($shot, $candidate) -Assertions $assertions
  } finally {
    Stop-GuiSubject -Process $process
  }
}

function Add-Result {
  param(
    [Parameter(Mandatory = $true)] [string] $CaseId,
    [Parameter(Mandatory = $true)] [ValidateSet("PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED", "SKIP")] [string] $Status,
    [Parameter(Mandatory = $true)] [string] $Summary,
    [string] $ErrorText,
    [string[]] $Screenshots = @(),
    [object[]] $Assertions = @()
  )
  $case = $Matrix.cases | Where-Object { $_.id -eq $CaseId } | Select-Object -First 1
  [void]$Results.Add([ordered]@{
    id = $CaseId
    title = if ($null -ne $case) { $case.title } else { $CaseId }
    status = $Status
    summary = $Summary
    error = $ErrorText
    assertions = $Assertions
    evidence = @{ screenshots = $Screenshots }
  })
}

function Add-AtomicResult {
  param(
    [Parameter(Mandatory = $true)] [string] $AssertionId,
    [Parameter(Mandatory = $true)] [ValidateSet("PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED", "SKIP")] [string] $Status,
    [Parameter(Mandatory = $true)] [string] $Summary,
    [object[]] $Evidence = @()
  )
  if (@($AtomicResults | ForEach-Object { $_.id }) -contains $AssertionId) { throw "Duplicate atomic result: $AssertionId" }
  $match = $null
  foreach ($problem in $Atomic.problems) {
    $match = $problem.assertions | Where-Object { $_.id -eq $AssertionId } | Select-Object -First 1
    if ($null -ne $match) { break }
  }
  if ($null -eq $match) { throw "Unknown atomic assertion: $AssertionId" }
  [void]$AtomicResults.Add([ordered]@{
    id = $AssertionId
    title = $match.title
    status = $Status
    summary = $Summary
    evidence = $Evidence
  })
}

function Complete-AtomicResults {
  $focused = $Lane -eq "agent-console"
  foreach ($problem in $Atomic.problems) {
    foreach ($check in $problem.assertions) {
      if (@($AtomicResults | ForEach-Object { $_.id }) -contains $check.id) { continue }
      if ($focused -and $problem.parent -ne "WIN-AGENT-CONSOLE") {
        Add-AtomicResult -AssertionId $check.id -Status "SKIP" -Summary "Agent Console 聚焦通道不裁决其他功能矩阵。"
        continue
      }
      if (-not $check.windows.required) {
        Add-AtomicResult -AssertionId $check.id -Status "SKIP" -Summary "Windows 最小冒烟策略不要求此原子断言；由 macOS 代理回归承担。"
        continue
      }
      if ($check.windows.state -eq "planned") {
        Add-AtomicResult -AssertionId $check.id -Status "BLOCKED" -Summary "Windows 原子执行器尚未实现，禁止从父 case 推断通过。"
        continue
      }
      Add-AtomicResult -AssertionId $check.id -Status "BLOCKED" -Summary "已声明执行器但本次运行没有上报原子结果。"
    }
  }
}

function Relative-EvidencePath {
  param([string] $Path)
  $full = [IO.Path]::GetFullPath($Path)
  $prefix = $Output.TrimEnd('\') + '\'
  if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Evidence path escaped output root: $full" }
  return $full.Substring($prefix.Length)
}

function Save-RunSnapshot {
  $snapshots = Join-Path $Evidence "snapshots"
  New-Item -ItemType Directory -Force -Path $snapshots | Out-Null
  $settings = @(
    @{ source = (Join-Path $UserDir "User\settings.json"); name = "user-settings.json" },
    @{ source = (Join-Path $Workspace ".vscode\settings.json"); name = "workspace-settings.json" }
  )
  foreach ($item in $settings) {
    if (Test-Path -LiteralPath $item.source -PathType Leaf) {
      Copy-Item -LiteralPath $item.source -Destination (Join-Path $snapshots $item.name) -Force
    }
  }
  $logs = Join-Path $UserDir "logs"
  if (Test-Path -LiteralPath $logs -PathType Container) {
    Copy-Item -LiteralPath $logs -Destination (Join-Path $Evidence "vscode-logs") -Recurse -Force
  }
  $roots = @(
    @{ name = "globalStorage"; path = (Join-Path $UserDir "User\globalStorage") },
    @{ name = "workspaceStorage"; path = (Join-Path $UserDir "User\workspaceStorage") },
    @{ name = "workspace"; path = $Workspace }
  )
  foreach ($root in $roots) {
    $files = if (Test-Path -LiteralPath $root.path -PathType Container) {
      @(Get-ChildItem -LiteralPath $root.path -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
        $hash = try {
          (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName -ErrorAction Stop).Hash.ToLowerInvariant()
        } catch {
          "unavailable:$($_.Exception.HResult)"
        }
        [ordered]@{
          path = $_.FullName.Substring($root.path.Length).TrimStart('\')
          bytes = $_.Length
          sha256 = $hash
        }
      })
    } else { @() }
    $files | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $snapshots "$($root.name)-inventory.json") -Encoding UTF8
  }
}

function Complete-Run {
  if ($script:Completed) { return }
  $script:Completed = $true
  Complete-AtomicResults
  $artifactValue = if ($null -ne $Artifact) { $Artifact } else { @{ vsix = $Vsix; sha256 = "unknown" } }
  $payload = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    lane = $Lane
    gate = $Gate
    gpu = $Gpu
    mock = @{ origin = $script:MockOrigin }
    platform = [ordered]@{
      os = [Environment]::OSVersion.VersionString
      processor = $env:PROCESSOR_IDENTIFIER
      architecture = $env:PROCESSOR_ARCHITECTURE
      emulation = $env:PROCESSOR_ARCHITEW6432
    }
    artifact = $artifactValue
    results = $Results
    atomicResults = $AtomicResults
  }
  $resultPath = Join-Path $Output "results.json"
  $payload | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resultPath -Encoding UTF8
  $files = @((Get-Item -LiteralPath $resultPath)) + @(
    Get-ChildItem -LiteralPath $Evidence -Recurse -File -ErrorAction SilentlyContinue
  )
  $sensitive = $files |
    Where-Object { $_.Extension -in @(".json", ".log", ".txt", ".md", ".html", ".xml") } |
    Select-String -Pattern "Bearer\s+[^\s<]+|sk-[A-Za-z0-9_-]{8,}|test-secret" -CaseSensitive -ErrorAction SilentlyContinue
  if ($sensitive) {
    [void]$Results.Add(@{ id = "EVIDENCE-SECRET-SCAN"; title = "Evidence secret scan"; status = "FAIL"; summary = "证据包命中敏感模式。"; error = ($sensitive | Out-String); evidence = @{ screenshots = @() } })
    $payload.results = $Results
    $payload | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resultPath -Encoding UTF8
  }
  $all = @($Results) + @($AtomicResults)
  $blocking = @($all | Where-Object { $_.status -in @("FAIL", "FLAKY", "REVIEW", "BLOCKED") })
  $invalidSkip = @($all | Where-Object { $_.status -eq "SKIP" -and [string]::IsNullOrWhiteSpace($_.summary) })
  $script:ExitCode = if ($blocking.Count -gt 0 -or $invalidSkip.Count -gt 0) { 1 } else { 0 }
  try {
    Invoke-Node -Arguments @((Join-Path $QaRoot "report.mjs"), $resultPath, (Join-Path $Output "report.html")) | Out-Null
  } catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $Output "report-error.log") -Encoding UTF8
  }
  $zip = Join-Path (Split-Path -Parent $Output) "$(Split-Path -Leaf $Output)-evidence.zip"
  $archive = @($resultPath, (Join-Path $Output "report.html"), $Evidence, (Join-Path $Output ".chipmate-windows-qa-root")) |
    Where-Object { Test-Path -LiteralPath $_ }
  Compress-Archive -Path $archive -DestinationPath $zip -Force
  Write-Host "RESULTS=$resultPath"
  Write-Host "REPORT=$(Join-Path $Output 'report.html')"
  Write-Host "EVIDENCE_ZIP=$zip"
}

try {
  Initialize-Fixture
  $Artifact = Test-FrozenVsix
  if ($Lane -eq "agent-console") {
    [ordered]@{
      status = "SCOPED"
      lane = $Lane
      case = "WIN-AGENT-CONSOLE"
      note = "全仓 coverage ledger 不属于 Agent Console 聚焦通道；其他功能不据此判定。"
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Evidence "coverage-ledger.json") -Encoding UTF8
  } else {
    Invoke-Coverage
  }
  Add-Result -CaseId "WIN-PACKAGE-INSTALL" -Status "PASS" -Summary "VSIX 内容和 manifest 验证通过。"

  if ($Lane -eq "package") { Complete-Run; exit $script:ExitCode }

  $Code = Resolve-Code
  $CodeCli = Join-Path (Split-Path -Parent $Code) "bin\code.cmd"
  if (-not (Test-Path -LiteralPath $CodeCli)) { throw "VS Code CLI not found next to Code.exe: $CodeCli" }
  $script:CdpPort = Get-FreeTcpPort
  $script:MockPort = Get-FreeTcpPort
  $script:MockOrigin = "http://127.0.0.1:$script:MockPort"
  $env:KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL = "$script:MockOrigin/v1"
  $Mock = Start-MockProvider
  Initialize-MockProviderConfig
  Install-Subject
  Invoke-InstalledProbe
  if ($Lane -in @("smoke", "agent-console")) {
    Add-Result -CaseId "WIN-SMOKE-INSTALL" -Status "PASS" -Summary "正式安装、版本列表与 installed-host 激活 probe 通过。"
  } elseif ($PreviousVsix -and $KiloVsix) {
    Add-Result -CaseId "WIN-IDENTITY-UPGRADE" -Status "PASS" -Summary "正式安装的 ChipMate 已激活，覆盖升级与 Kilo 同 Profile 前置条件均已执行。"
  } else {
    Add-Result -CaseId "WIN-IDENTITY-UPGRADE" -Status "BLOCKED" -Summary "安装态激活 probe 已通过；完整 PASS 仍需要同时传入 -PreviousVsix 和 -KiloVsix。"
  }

  if (-not $NoGui) {
    if ($Lane -ne "agent-console") {
      Invoke-SettingsKeyboardRegression
    }
    if ($Lane -eq "smoke") {
      Invoke-IndexingSmoke
    } elseif ($Lane -ne "agent-console") {
      Invoke-VisualCapture
    }
    Invoke-AgentConsoleSmoke
    Invoke-CliLifecycleAudit
  } else {
    if ($Lane -ne "agent-console") {
      Add-Result -CaseId "WIN-SETTINGS-PROVIDER" -Status "BLOCKED" -Summary "NoGui 禁止逐字符 GUI 输入验证。"
    }
    if ($Lane -eq "smoke") {
      Add-Result -CaseId "WIN-SMOKE-INDEXING" -Status "BLOCKED" -Summary "NoGui 禁止索引运行态采证。"
    } else {
      Add-Result -CaseId "WIN-BRANDING-FIRST-RUN" -Status "BLOCKED" -Summary "NoGui 禁止首次启动视觉采证。"
    }
    Add-Result -CaseId "WIN-AGENT-CONSOLE" -Status "BLOCKED" -Summary "NoGui 禁止 Agent Console 交互采证。"
    Add-Result -CaseId "WIN-CLI-LIFECYCLE" -Status "BLOCKED" -Summary "NoGui 禁止 Reload、Extension Host 和孤儿进程交互审计。"
  }

  foreach ($case in $Matrix.cases) {
    if (@($Results | ForEach-Object { $_.id }) -contains $case.id) { continue }
    if ($Lane -eq "agent-console") {
      Add-Result -CaseId $case.id -Status "SKIP" -Summary "Agent Console 聚焦通道不裁决此功能。"
      continue
    }
    if ($Lane -eq "smoke") {
      Add-Result -CaseId $case.id -Status "SKIP" -Summary "Windows 最小冒烟策略不执行完整矩阵；完整功能由 macOS 代理回归承担。"
      continue
    }
    if ($Lane -eq "core" -and $case.id -notin @("WIN-FAILURE-SECURITY", "WIN-UPDATE")) {
      Add-Result -CaseId $case.id -Status "SKIP" -Summary "core lane 未执行此完整矩阵 case。"
      continue
    }
    Add-Result -CaseId $case.id -Status "BLOCKED" -Summary "需要在 Windows 夹具中按 cases.json 的确定性步骤执行；本 runner 未以截图或通用 smoke 伪造通过。"
  }
} catch {
  Add-Result -CaseId "HARNESS" -Status "FAIL" -Summary "Windows QA runner 异常。" -ErrorText ($_ | Out-String)
} finally {
  if ($null -ne $Mock -and -not $Mock.HasExited) {
    try {
      Invoke-RestMethod -Uri "$script:MockOrigin/__qa/requests" -TimeoutSec 2 |
        ConvertTo-Json -Depth 10 |
        Set-Content -LiteralPath (Join-Path $Evidence "mock-provider-requests.json") -Encoding UTF8
    } catch {
      $_ | Out-String | Set-Content -LiteralPath (Join-Path $Evidence "mock-provider-requests-error.log") -Encoding UTF8
    }
  }
  if ($null -ne $Mock -and -not $Mock.HasExited) { Stop-Process -Id $Mock.Id -Force -ErrorAction SilentlyContinue }
  try {
    Save-RunSnapshot
  } catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $Evidence "snapshot-error.log") -Encoding UTF8
  }
  Complete-Run
}

exit $script:ExitCode
