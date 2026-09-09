[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Vsix,
  [string] $CodePath,
  [string] $PreviousVsix,
  [string] $ChipMateVsix,
  [string] $FixtureRoot,
  [string] $Output,
  [string] $ExpectedVersion,
  [ValidateSet("full", "core", "smoke", "settings", "package", "update")] [string] $Lane = "smoke",
  [Parameter(Mandatory = $true)] [ValidateSet("arm64-vm", "native-x64")] [string] $Gate,
  [ValidateSet("default", "disabled")] [string] $Gpu = "default",
  [switch] $NoGui,
  [switch] $SkipStress
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
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
$ProviderMock = $null
$Code = $null
$CodeCli = $null
$Artifact = $null
$script:Completed = $false
$script:ExitCode = 1
$script:CdpPort = 0
$script:MockPort = 0
$script:MockOrigin = ""
$script:ProviderMockPort = 0
$script:ProviderMockOrigin = ""
$script:ReloadPass = $false
$script:HostPass = $false
$script:CdpTarget = ""
$script:CdpExcluded = New-Object Collections.Generic.List[string]
$ExtDir = Join-Path $Runtime $(if ($Lane -eq "update") { "extensions-中文 path" } else { "extensions" })
$UserDir = Join-Path $Runtime $(if ($Lane -eq "update") { "user-中文 path" } else { "user" })
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
  $paths = @(Get-ChildItem -LiteralPath $ExtDir -Recurse -File -Filter "chipmate*.exe" -ErrorAction SilentlyContinue |
    ForEach-Object { [IO.Path]::GetFullPath($_.FullName) })
  if (-not $paths.Count) { return @() }
  return @(Get-CimInstance Win32_Process -Filter "Name = 'chipmate.exe' OR Name = 'chipmate-arm64.exe' OR Name = 'chipmate-indexer.exe' OR Name = 'chipmate-indexer-arm64.exe'" -ErrorAction SilentlyContinue |
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
  param([string] $Origin = $script:MockOrigin)
  if ([string]::IsNullOrWhiteSpace($Origin)) { throw "Mock Provider origin is required." }
  $storage = Join-Path $UserDir "User\globalStorage\chipmate.chipmate"
  $provider = [ordered]@{
    model = "qa-local/qa-chat-model"
    plugin = @("@chipmate/chipmate-indexing")
    enabled_providers = @("qa-local")
    indexing = [ordered]@{
      provider = "openai-compatible"
      "openai-compatible" = [ordered]@{ baseUrl = "$Origin/v1/embeddings" }
    }
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
        options = @{ apiKey = "qa-local-key"; baseURL = "$Origin/v1" }
      }
    }
  }
  $models = [ordered]@{
    model = @{ code = @{ providerID = "qa-local"; modelID = "qa-chat-model" } }
    recent = @(@{ providerID = "qa-local"; modelID = "qa-chat-model" })
    favorite = @()
    variant = @{}
  }
  foreach ($root in @($storage, (Join-Path $storage "v2"))) {
    Write-Utf8NoBom -Path (Join-Path $root "config\chipmate.jsonc") -Value ($provider | ConvertTo-Json -Depth 12)
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

function Set-MockIndexingEndpoint {
  $settings = Join-Path $Workspace ".vscode\settings.json"
  $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $settings | ConvertFrom-Json
  $config | Add-Member -NotePropertyName "chipmate.v2.indexing.openaiCompatible.baseUrl" -NotePropertyValue "$script:MockOrigin/v1/embeddings" -Force
  Write-Utf8NoBom -Path $settings -Value ($config | ConvertTo-Json)

  $project = Join-Path $Workspace ".chipmate\chipmate.jsonc"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $project) | Out-Null
  $root = if (Test-Path -LiteralPath $project -PathType Leaf) {
    Get-Content -Raw -Encoding UTF8 -LiteralPath $project | ConvertFrom-Json
  } else {
    [pscustomobject]@{}
  }
  $indexing = [ordered]@{
    provider = "openai-compatible"
    "openai-compatible" = [ordered]@{ baseUrl = "$script:MockOrigin/v1/embeddings" }
  }
  $root | Add-Member -NotePropertyName "indexing" -NotePropertyValue $indexing -Force
  Write-Utf8NoBom -Path $project -Value ($root | ConvertTo-Json -Depth 12)
}

function Test-FrozenVsix {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Vsix).Hash.ToLowerInvariant()
  $zip = Join-Path $Runtime "subject.zip"
  $unpack = Join-Path $Runtime "vsix"
  Copy-Item -LiteralPath $Vsix -Destination $zip -Force
  if (Test-Path $unpack) { Remove-Item -LiteralPath $unpack -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
  $required = @(
    "extension\bin\chipmate.exe",
    "extension\bin\rg.exe",
    "extension\bin\models-snapshot.json",
    "extension\bin\tree-sitter\tree-sitter.wasm",
    "extension\bin\lancedb\node_modules\@lancedb\lancedb\dist\index.js",
    "extension\bin\lancedb\node_modules\@lancedb\lancedb-win32-x64-msvc\lancedb.win32-x64-msvc.node",
    "extension\bin\poppler\pdftotext.exe",
    "extension\dist\extension.js",
    "extension\dist\webview.js",
    "extension\dist\agent-manager.js",
    "extension\dist\diff-viewer.js",
    "extension\dist\diff-virtual.js"
  )
  $missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $unpack $_)) })
  if ($missing.Count) { throw "VSIX missing required files: $($missing -join ', ')" }
  $forbidden = @(Get-ChildItem -LiteralPath $unpack -Recurse -File | Where-Object { $_.Name -eq "ffmpeg.exe" -or $_.Name.EndsWith(".map") })
  if ($forbidden.Count) { throw "VSIX contains forbidden files: $($forbidden.FullName -join ', ')" }
  $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $unpack "extension\package.json") | ConvertFrom-Json
  if ($manifest.publisher -ne "chipmate" -or $manifest.name -ne "chipmate") { throw "Unexpected extension identity in VSIX." }
  if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) { $script:ExpectedVersion = [string] $manifest.version }
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
  param(
    [int] $Port = $script:MockPort,
    [string] $Origin = $script:MockOrigin,
    [string] $Name = "mock-provider"
  )
  if ($Port -lt 1 -or [string]::IsNullOrWhiteSpace($Origin)) { throw "Mock Provider port and origin are required." }
  $runtime = Resolve-Node
  $stdout = Join-Path $Evidence "$Name.log"
  $stderr = Join-Path $Evidence "$Name-error.log"
  $previous = [Environment]::GetEnvironmentVariable("ELECTRON_RUN_AS_NODE", "Process")
  try {
    if ($runtime.electron) { $env:ELECTRON_RUN_AS_NODE = "1" }
    $process = Start-Process -FilePath $runtime.path -ArgumentList @((Join-Path $QaRoot "mock-provider.mjs"), "--port=$Port") -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
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
      $health = Invoke-RestMethod -Uri "$Origin/__qa/health" -TimeoutSec 1
      if ($health.status -eq "ok") { return $process }
    } catch { Start-Sleep -Milliseconds 250 }
  } while ((Get-Date) -lt $limit)
  throw "Mock Provider did not become healthy."
}

function Start-UpdateServer {
  $runtime = Resolve-Node
  $stdout = Join-Path $Evidence "update-server.log"
  $stderr = Join-Path $Evidence "update-server-error.log"
  $requests = Join-Path $Evidence "update-server-requests.json"
  $args = @(
    (Join-Path $QaRoot "update-server.mjs"),
    "--port=$script:MockPort",
    "--vsix=$Vsix",
    "--version=$ExpectedVersion",
    "--target=win32-x64-baseline",
    "--log=$requests"
  )
  $previous = [Environment]::GetEnvironmentVariable("ELECTRON_RUN_AS_NODE", "Process")
  try {
    if ($runtime.electron) { $env:ELECTRON_RUN_AS_NODE = "1" }
    $process = Start-Process `
      -FilePath $runtime.path `
      -ArgumentList ($args | ForEach-Object { Quote-ProcessArgument $_ }) `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -PassThru `
      -WindowStyle Hidden
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
    } catch {
      Start-Sleep -Milliseconds 250
    }
  } while ((Get-Date) -lt $limit)
  throw "离线更新服务未能启动。"
}

function Get-UpdateVsixMeta {
  param([Parameter(Mandatory = $true)] [string] $Path)
  $id = [Guid]::NewGuid().ToString("N")
  $zip = Join-Path $Runtime "update-source-$id.zip"
  $dir = Join-Path $Runtime "update-source-$id"
  Copy-Item -LiteralPath $Path -Destination $zip -Force
  try {
    Expand-Archive -LiteralPath $zip -DestinationPath $dir -Force
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $dir "extension\package.json") | ConvertFrom-Json
    return @{
      version = [string] $manifest.version
      publisher = [string] $manifest.publisher
      name = [string] $manifest.name
      target = [string] $manifest.chipmatePackageTarget
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    }
  } finally {
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Initialize-UpdateProfile {
  $settings = Join-Path $UserDir "User\settings.json"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settings) | Out-Null
  Write-Utf8NoBom -Path $settings -Value (@{
    "chipmate.v2.language" = "zh-cn"
    "chipmate.v2.chipmateServer.baseUrl" = $script:MockOrigin
    "chipmate.v2.updateCheck.enabled" = $true
    "chipmate.v2.updateCheck.autoDownload" = $true
    "chipmate.v2.updateCheck.checkOnStartup" = $true
    "chipmate.v2.updateCheck.codeCliPath" = "code"
  } | ConvertTo-Json)

  # 其他 Windows lane 以辅助功能回归为目的，会显式开启 reduced motion。
  # 更新 lane 的目标是动态思考动画，必须在相同 workspace 中明确恢复为正常渲染条件。
  $workspaceSettings = Join-Path $Workspace ".vscode\settings.json"
  $workspaceConfig = Get-Content -Raw -Encoding UTF8 -LiteralPath $workspaceSettings | ConvertFrom-Json
  $workspaceConfig | Add-Member -NotePropertyName "editor.accessibilitySupport" -NotePropertyValue "off" -Force
  Write-Utf8NoBom -Path $workspaceSettings -Value ($workspaceConfig | ConvertTo-Json)
}

function Install-UpdateSource {
  if ([string]::IsNullOrWhiteSpace($PreviousVsix)) { throw "update lane 必须传入 -PreviousVsix。" }
  $previous = [IO.Path]::GetFullPath($PreviousVsix)
  if (-not (Test-Path -LiteralPath $previous -PathType Leaf)) { throw "Previous VSIX not found: $previous" }
  $meta = Get-UpdateVsixMeta -Path $previous
  if ($meta.publisher -ne "chipmate" -or $meta.name -ne "chipmate") {
    throw "旧版 VSIX 身份不是 chipmate.chipmate。"
  }
  if ($meta.target -ne "win32-x64-baseline") { throw "旧版 VSIX target 不是 win32-x64-baseline。" }
  if ([Version]$meta.version -ge [Version]$ExpectedVersion) {
    throw "旧版 VSIX 版本 $($meta.version) 必须低于候选版本 $ExpectedVersion。"
  }
  $exit = Invoke-CodeCli `
    -Arguments @("--install-extension", $previous, "--force", "--extensions-dir", $ExtDir, "--user-data-dir", $UserDir) `
    -Log (Join-Path $Evidence "update-install-old.log")
  if ($exit -ne 0) { throw "旧版 VSIX 安装失败，退出码 $exit。" }
  $meta | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Evidence "update-old-vsix.json") -Encoding UTF8
  return $meta
}

function Save-UpdateExtensionList {
  param([Parameter(Mandatory = $true)] [string] $Name)
  $path = Join-Path $Evidence $Name
  $exit = Invoke-CodeCli `
    -Arguments @("--list-extensions", "--show-versions", "--extensions-dir", $ExtDir, "--user-data-dir", $UserDir) `
    -Log $path
  if ($exit -ne 0) { throw "扩展列表读取失败，退出码 $exit。" }
  return $path
}

function Wait-UpdateLog {
  param(
    [Parameter(Mandatory = $true)] [string[]] $Pattern,
    [int] $Seconds = 180
  )
  $limit = (Get-Date).AddSeconds($Seconds)
  do {
    $logs = @(Get-ChildItem -LiteralPath (Join-Path $UserDir "logs") -Recurse -File -ErrorAction SilentlyContinue)
    foreach ($log in $logs) {
      foreach ($item in $Pattern) {
        if (Select-String -LiteralPath $log.FullName -Pattern $item -SimpleMatch -Quiet -ErrorAction SilentlyContinue) {
          return [pscustomobject]@{ path = $log.FullName; pattern = $item }
        }
      }
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $limit)
  throw "更新日志在 $Seconds 秒内未出现：$($Pattern -join ' / ')"
}

function Read-ChipMateProbe {
  param([Parameter(Mandatory = $true)] [string] $Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try {
    return Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-ChipMateProbeValue {
  param(
    $Object,
    [Parameter(Mandatory = $true)] [string] $Name
  )
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Test-ChipMatePathWithin {
  param(
    [string] $Path = "",
    [string] $Root = ""
  )
  if ([string]::IsNullOrWhiteSpace($Path) -or [string]::IsNullOrWhiteSpace($Root)) { return $false }
  try {
    $trimChars = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $subject = [IO.Path]::GetFullPath($Path).TrimEnd($trimChars)
    $parent = [IO.Path]::GetFullPath($Root).TrimEnd($trimChars)
    $prefix = "$parent$([IO.Path]::DirectorySeparatorChar)"
    return $subject.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function Wait-InitialUpdateProbe {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [int] $Seconds = 90
  )
  $limit = (Get-Date).AddSeconds($Seconds)
  do {
    $result = Read-ChipMateProbe -Path $Path
    if ($null -ne $result) { return $result }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $limit)
  throw "更新前已安装宿主 Probe 在 $Seconds 秒内未产生回执：$Path"
}

function Get-FirstReloadProbeEvaluation {
  param(
    [Parameter(Mandatory = $true)] $Result,
    [Parameter(Mandatory = $true)] [string] $InitialActivationId,
    [Parameter(Mandatory = $true)] [string] $InitialExtensionHostPid,
    [Parameter(Mandatory = $true)] [datetime] $ReloadRequestedAt,
    [Parameter(Mandatory = $true)] [string] $ExpectedVersion,
    [Parameter(Mandatory = $true)] [string] $ExpectedTarget,
    [Parameter(Mandatory = $true)] [string] $ExpectedExtensionRoot
  )
  $extension = Get-ChipMateProbeValue -Object $Result -Name "extension"
  $activationId = [string](Get-ChipMateProbeValue -Object $Result -Name "activationId")
  $extensionHostPid = Get-ChipMateProbeValue -Object $Result -Name "extensionHostPid"
  $probeAtText = [string](Get-ChipMateProbeValue -Object $Result -Name "at")
  $probeAt = $null
  try {
    if (-not [string]::IsNullOrWhiteSpace($probeAtText)) {
      $probeAt = [DateTimeOffset]::Parse($probeAtText).UtcDateTime
    }
  } catch {
    $probeAt = $null
  }

  $freshActivation = (
    -not [string]::IsNullOrWhiteSpace($activationId) -and
    $activationId -ne $InitialActivationId -and
    $null -ne $probeAt -and
    $probeAt -ge $ReloadRequestedAt.ToUniversalTime()
  )
  $freshExtensionHost = (
    -not [string]::IsNullOrWhiteSpace([string]$extensionHostPid) -and
    [string]$extensionHostPid -ne $InitialExtensionHostPid
  )
  $extensionId = [string](Get-ChipMateProbeValue -Object $extension -Name "id")
  $extensionVersion = [string](Get-ChipMateProbeValue -Object $extension -Name "version")
  $extensionTarget = [string](Get-ChipMateProbeValue -Object $extension -Name "target")
  $extensionPath = [string](Get-ChipMateProbeValue -Object $extension -Name "path")
  $extensionActive = Get-ChipMateProbeValue -Object $extension -Name "active"
  $extensionDevelopment = Get-ChipMateProbeValue -Object $extension -Name "development"
  $checks = @(
    [ordered]@{
      id = "fresh-activation"
      status = if ($freshActivation) { "PASS" } else { "FAIL" }
      detail = "activationId=$activationId previous=$InitialActivationId extensionHostPid=$extensionHostPid at=$probeAtText reloadRequestedAt=$($ReloadRequestedAt.ToUniversalTime().ToString('o'))"
    },
    [ordered]@{
      id = "fresh-extension-host"
      status = if ($freshExtensionHost) { "PASS" } else { "FAIL" }
      detail = "extensionHostPid=$extensionHostPid previous=$InitialExtensionHostPid"
    },
    [ordered]@{
      id = "candidate-version"
      status = if ($extensionId -eq "chipmate.chipmate" -and $extensionVersion -eq $ExpectedVersion) { "PASS" } else { "FAIL" }
      detail = "id=$extensionId version=$extensionVersion expected=$ExpectedVersion"
    },
    [ordered]@{
      id = "candidate-target"
      status = if ($extensionTarget -eq $ExpectedTarget) { "PASS" } else { "FAIL" }
      detail = "target=$extensionTarget expected=$ExpectedTarget"
    },
    [ordered]@{
      id = "candidate-extension-path"
      status = if (Test-ChipMatePathWithin -Path $extensionPath -Root $ExpectedExtensionRoot) { "PASS" } else { "FAIL" }
      detail = "path=$extensionPath expectedRoot=$ExpectedExtensionRoot"
    },
    [ordered]@{
      id = "installed-extension-active"
      status = if ($extensionActive -eq $true -and $extensionDevelopment -eq $false) { "PASS" } else { "FAIL" }
      detail = "active=$extensionActive development=$extensionDevelopment"
    },
    [ordered]@{
      id = "probe-status"
      status = if ([string](Get-ChipMateProbeValue -Object $Result -Name "status") -eq "PASS") { "PASS" } else { "FAIL" }
      detail = "status=$([string](Get-ChipMateProbeValue -Object $Result -Name 'status')) errors=$((Get-ChipMateProbeValue -Object $Result -Name 'errors') -join '; ')"
    }
  )
  return [pscustomobject]@{
    passed = @($checks | Where-Object { $_.status -ne "PASS" }).Count -eq 0
    assertions = $checks
  }
}

function Wait-FirstReloadProbe {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [string] $InitialActivationId,
    [Parameter(Mandatory = $true)] [string] $InitialExtensionHostPid,
    [Parameter(Mandatory = $true)] [datetime] $ReloadRequestedAt,
    [Parameter(Mandatory = $true)] [string] $ExpectedVersion,
    [Parameter(Mandatory = $true)] [string] $ExpectedTarget,
    [Parameter(Mandatory = $true)] [string] $ExpectedExtensionRoot,
    [int] $Seconds = 180
  )
  $limit = (Get-Date).AddSeconds($Seconds)
  $lastResult = $null
  $lastEvaluation = $null
  do {
    $candidate = Read-ChipMateProbe -Path $Path
    if ($null -ne $candidate) {
      $lastResult = $candidate
      $lastEvaluation = Get-FirstReloadProbeEvaluation `
        -Result $candidate `
        -InitialActivationId $InitialActivationId `
        -InitialExtensionHostPid $InitialExtensionHostPid `
        -ReloadRequestedAt $ReloadRequestedAt `
        -ExpectedVersion $ExpectedVersion `
        -ExpectedTarget $ExpectedTarget `
        -ExpectedExtensionRoot $ExpectedExtensionRoot
      if ($lastEvaluation.passed) {
        return [pscustomobject]@{
          passed = $true
          result = $candidate
          evaluation = $lastEvaluation
          reason = ""
        }
      }
    }
    Start-Sleep -Milliseconds 150
  } while ((Get-Date) -lt $limit)
  return [pscustomobject]@{
    passed = $false
    result = $lastResult
    evaluation = $lastEvaluation
    reason = "点击 Install and Reload Window 后 $Seconds 秒内未得到候选版本的首次激活回执。"
  }
}

function Invoke-ProbeControl {
  param(
    [Parameter(Mandatory = $true)] [string] $Control,
    [Parameter(Mandatory = $true)] [string] $Reply,
    [Parameter(Mandatory = $true)] [string] $Name,
    [Parameter(Mandatory = $true)] [string] $Command,
    [object[]] $Arguments = @(),
    [int] $Seconds = 60
  )
  $id = [Guid]::NewGuid().ToString("N")
  Remove-Item -LiteralPath $Reply -Force -ErrorAction SilentlyContinue
  Write-Utf8NoBom -Path $Control -Value ([ordered]@{
    id = $id
    command = $Command
    args = $Arguments
  } | ConvertTo-Json)
  $limit = (Get-Date).AddSeconds($Seconds)
  $response = $null
  do {
    $candidate = Read-ChipMateProbe -Path $Reply
    if ($null -ne $candidate -and [string](Get-ChipMateProbeValue -Object $candidate -Name "id") -eq $id) {
      $response = $candidate
      break
    }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $limit)
  if ($null -eq $response) {
    throw "首次 Reload 的 Probe 在 $Seconds 秒内未执行 $Name。"
  }
  if ([string](Get-ChipMateProbeValue -Object $response -Name "status") -ne "PASS") {
    throw "首次 Reload 的 Probe 执行 $Name 失败：$([string](Get-ChipMateProbeValue -Object $response -Name 'error'))"
  }
  return $response
}

function Invoke-ChatMotionCdp {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [string] $ImageDirectory
  )
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path), $ImageDirectory | Out-Null
  $log = "$Path.log"
  Invoke-Node -Arguments @(
    (Join-Path $QaRoot "cdp-chat-motion.mjs"),
    "--port=$script:CdpPort",
    "--output=$Path",
    "--image-dir=$ImageDirectory",
    "--timeout-ms=45000",
    "--sample-ms=280"
  ) *> $log
  $code = $LASTEXITCODE
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    $tail = if (Test-Path -LiteralPath $log) { Get-Content -Tail 80 -LiteralPath $log | Out-String } else { "" }
    throw "首次 Reload 后动态 spinner CDP 未写出结果（exit=$code）。`n$tail"
  }
  $result = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
  if ($code -ne 0 -and [string]$result.status -eq "PASS") {
    throw "首次 Reload 后动态 spinner CDP 返回矛盾状态（exit=$code, status=PASS）。"
  }
  return $result
}

function Invoke-UpdateRegression {
  $root = Join-Path $Evidence "WIN-UPDATE"
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  Initialize-UpdateProfile
  $old = Install-UpdateSource
  $before = Save-UpdateExtensionList -Name "update-extensions-before.txt"
  if (-not (Select-String -LiteralPath $before -Pattern "^chipmate\.chipmate@$([Regex]::Escape($old.version))$" -Quiet)) {
    throw "自动更新前扩展列表未发现旧版本 $($old.version)。"
  }

  $probe = Join-Path $root "first-reload-probe.json"
  $control = Join-Path $root "first-reload-control.json"
  $reply = Join-Path $root "first-reload-control-result.json"
  $promptScreenshot = Join-Path $root "reload-prompt.png"
  $promptUia = Join-Path $root "reload-prompt-uia.json"
  $activatedScreenshot = Join-Path $root "first-reload-activated.png"
  $activatedUia = Join-Path $root "first-reload-activated-uia.json"
  $motionPath = Join-Path $root "first-reload-spinner-motion.json"
  $motionFrameDirectory = Join-Path $root "spinner-frames"
  $process = $null
  $initialProbe = $null
  $firstReload = $null
  $reloadRequestedAt = $null
  $windowStayedAlive = $false
  $openInTabReply = $null
  $showMemoryReply = $null
  $motion = $null
  $motionError = ""
  $reloadError = ""
  $newUpdateFlow = $false
  $saved = $env:Path
  $parts = @($env:Path -split ";" | Where-Object {
    $_ -and
    -not (Test-Path -LiteralPath (Join-Path $_ "code.cmd") -PathType Leaf) -and
    -not (Test-Path -LiteralPath (Join-Path $_ "code.exe") -PathType Leaf)
  })
  $env:Path = $parts -join ";"
  try {
    $command = Get-Command code -CommandType Application -ErrorAction SilentlyContinue
    if ($command) { throw "PATH 清理后仍能解析 code：$($command.Source)" }
    "未找到 code 命令；自动更新必须使用当前 VS Code 内置 CLI。" |
      Set-Content -LiteralPath (Join-Path $root "get-command-code.txt") -Encoding UTF8

    # 首个宿主故意按候选版本校验失败；Reload 后继承同一环境，只有候选版
    # 重新激活才能写出 PASS，禁止以第二次启动的 VS Code 代替首次 Reload。
    $env:CHIPMATE_QA_PROBE_OUT = $probe
    $env:CHIPMATE_QA_PROBE_QUIT = "0"
    $env:CHIPMATE_QA_EXPECTED_VERSION = $ExpectedVersion
    $env:CHIPMATE_QA_CONTROL_FILE = $control
    $env:CHIPMATE_QA_CONTROL_OUT = $reply
    try {
      $process = Start-GuiSubject -Probe -AllowMotion
      $initialProbe = Wait-InitialUpdateProbe -Path $probe
      $initialVersion = [string](Get-ChipMateProbeValue -Object (Get-ChipMateProbeValue -Object $initialProbe -Name "extension") -Name "version")
      $initialActivationId = [string](Get-ChipMateProbeValue -Object $initialProbe -Name "activationId")
      $initialExtensionHostPid = [string](Get-ChipMateProbeValue -Object $initialProbe -Name "extensionHostPid")
      if ($initialVersion -ne $old.version) {
        throw "更新前首次窗口 Probe 不是旧版本：expected=$($old.version) actual=$initialVersion"
      }
      if ([string]::IsNullOrWhiteSpace($initialActivationId)) {
        throw "更新前首次窗口 Probe 未返回 activationId。"
      }
      if ([string]::IsNullOrWhiteSpace($initialExtensionHostPid)) {
        throw "更新前首次窗口 Probe 未返回 extensionHostPid。"
      }
      if ([string](Get-ChipMateProbeValue -Object $initialProbe -Name "status") -eq "PASS") {
        throw "更新前首次窗口 Probe 意外通过候选版本校验，无法证明 Reload 前后发生了版本切换。"
      }
      Copy-Item -LiteralPath $probe -Destination (Join-Path $root "old-version-probe.json") -Force

      $preparedPattern = "已下载并校验，等待用户确认安装并重载窗口"
      $legacyPattern = "等待用户重载窗口后激活"
      $log = Wait-UpdateLog -Pattern @($preparedPattern, $legacyPattern)
      $newUpdateFlow = $log.pattern -eq $preparedPattern
      Copy-Item -LiteralPath $log.path -Destination (Join-Path $root "chipmate-update.log") -Force
      Save-ChipMateScreenshot -Path $promptScreenshot
      Save-ChipMateUiaTree -Process $process -Path $promptUia

      $clicked = $false
      $actionNames = if ($newUpdateFlow) {
        @("Install and Reload Window", "安装并重载窗口")
      } else {
        @("Reload Window", "重载窗口")
      }
      foreach ($attempt in 1..20) {
        $reloadRequestedAt = Get-Date
        if (Invoke-ChipMateNamedControl -Process $process -Names $actionNames) {
          $clicked = $true
          break
        }
        $reloadRequestedAt = $null
        Start-Sleep -Milliseconds 500
      }
      if (-not $clicked) { throw "更新流程未找到 ChipMate 预期动作：$($actionNames -join ' / ')。" }
      $firstReload = Wait-FirstReloadProbe `
        -Path $probe `
        -InitialActivationId $initialActivationId `
        -InitialExtensionHostPid $initialExtensionHostPid `
        -ReloadRequestedAt $reloadRequestedAt `
        -ExpectedVersion $ExpectedVersion `
        -ExpectedTarget $Artifact.target `
        -ExpectedExtensionRoot $ExtDir
      if (Test-Path -LiteralPath $probe -PathType Leaf) {
        Copy-Item -LiteralPath $probe -Destination (Join-Path $root "candidate-first-reload-probe.json") -Force
      }
      if (-not $process.HasExited) { $windowStayedAlive = $true }
      if (-not $firstReload.passed) {
        $reloadError = $firstReload.reason
      } else {
        $activatedLog = Wait-UpdateLog -Pattern "更新首次重载已激活" -Seconds 90
        Copy-Item -LiteralPath $activatedLog.path -Destination (Join-Path $root "chipmate-update-activated.log") -Force
        $openInTabReply = Invoke-ProbeControl `
          -Control $control `
          -Reply $reply `
          -Name "chipmate.v2.openInTab" `
          -Command "chipmate.v2.openInTab"
        Copy-Item -LiteralPath $reply -Destination (Join-Path $root "control-open-in-tab.json") -Force

        # 动态动画只在非辅助功能降级条件下验收：由独立 mock provider 保持
        # 请求中的 working spinner，CDP 读取实际 webview 并采样该 spinner 的像素帧。
        try {
          Invoke-RestMethod `
            -Method Post `
            -Uri "$script:ProviderMockOrigin/__qa/scenario" `
            -ContentType "application/json" `
            -Body '{"scenario":"timeout","delayMs":30000}' `
            -TimeoutSec 2 | Out-Null
          Set-ChipMateForeground -Process $process
          $motion = Invoke-ChatMotionCdp -Path $motionPath -ImageDirectory $motionFrameDirectory
          if ([string]$motion.status -ne "PASS") {
            $motionDetail = if ($motion.PSObject.Properties.Name -contains "error" -and -not [string]::IsNullOrWhiteSpace([string]$motion.error)) {
              [string]$motion.error
            } elseif ($motion.PSObject.Properties.Name -contains "assertions") {
              $motion.assertions | ConvertTo-Json -Compress
            } else {
              "CDP 未返回可用诊断。"
            }
            $motionError = "首次 Reload 后动态 spinner 验收失败：$motionDetail"
          }
        } catch {
          $motionError = $_ | Out-String
          $_ | Out-String | Set-Content -LiteralPath (Join-Path $root "first-reload-spinner-motion-error.log") -Encoding UTF8
        }

        # showMemory 会等待 ChipMateProvider.waitForReady()；PASS 表示重载后的
        # webview 已完成就绪握手，不只是命令名称仍可被查到。
        $showMemoryReply = Invoke-ProbeControl `
          -Control $control `
          -Reply $reply `
          -Name "chipmate.v2.showMemory" `
          -Command "chipmate.v2.showMemory"
        Copy-Item -LiteralPath $reply -Destination (Join-Path $root "control-show-memory.json") -Force
        Save-ChipMateScreenshot -Path $activatedScreenshot
        Save-ChipMateUiaTree -Process $process -Path $activatedUia
      }
    } catch {
      $reloadError = $_ | Out-String
    } finally {
      if ($null -ne $process) { Stop-GuiSubject -Process $process }
      Remove-Item Env:CHIPMATE_QA_PROBE_OUT -ErrorAction SilentlyContinue
      Remove-Item Env:CHIPMATE_QA_PROBE_QUIT -ErrorAction SilentlyContinue
      Remove-Item Env:CHIPMATE_QA_EXPECTED_VERSION -ErrorAction SilentlyContinue
      Remove-Item Env:CHIPMATE_QA_CONTROL_FILE -ErrorAction SilentlyContinue
      Remove-Item Env:CHIPMATE_QA_CONTROL_OUT -ErrorAction SilentlyContinue
    }

    $afterInstall = Save-UpdateExtensionList -Name "update-extensions-after-install.txt"
    $diskInstalled = Select-String -LiteralPath $afterInstall -Pattern "^chipmate\.chipmate@$([Regex]::Escape($ExpectedVersion))$" -Quiet

    $requests = Invoke-RestMethod -Uri "$script:MockOrigin/__qa/requests" -TimeoutSec 2
    $requests | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root "requests.json") -Encoding UTF8
    $manifestRequests = @($requests.requests | Where-Object { $_.path -eq "/packages/manifest.json" })
    $vsixRequests = @($requests.requests | Where-Object { $_.path -like "/packages/*.vsix" })
    $motionRequests = $null
    $motionRequestError = ""
    try {
      $motionRequests = Invoke-RestMethod -Uri "$script:ProviderMockOrigin/__qa/requests" -TimeoutSec 2
      $motionRequests | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath (Join-Path $root "spinner-motion-provider-requests.json") -Encoding UTF8
    } catch {
      $motionRequestError = $_ | Out-String
      $_ | Out-String | Set-Content -LiteralPath (Join-Path $root "spinner-motion-provider-requests-error.log") -Encoding UTF8
    }
    $motionChatRequests = if ($null -ne $motionRequests) {
      @($motionRequests.requests | Where-Object { $_.path -match "/chat/completions$" }).Count
    } else {
      0
    }
    $cache = @(Get-ChildItem -LiteralPath $UserDir -Recurse -File -Filter "*.vsix" -ErrorAction SilentlyContinue |
      ForEach-Object {
        @{
          path = $_.FullName.Substring($UserDir.Length).TrimStart("\")
          bytes = $_.Length
          sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
        }
      })
    $cache | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root "cache-inventory.json") -Encoding UTF8
    $logText = @(
      Get-ChildItem -LiteralPath $root -File -Filter "chipmate-update*.log" -ErrorAction SilentlyContinue |
        ForEach-Object { Get-Content -Raw -Encoding UTF8 -LiteralPath $_.FullName }
    ) -join [Environment]::NewLine
    $promptUiaText = if (Test-Path -LiteralPath $promptUia -PathType Leaf) {
      Get-Content -Raw -Encoding UTF8 -LiteralPath $promptUia
    } else { "" }
    $activatedUiaText = if (Test-Path -LiteralPath $activatedUia -PathType Leaf) {
      Get-Content -Raw -Encoding UTF8 -LiteralPath $activatedUia
    } else { "" }
    $restartExtensionsVisible = $promptUiaText -match "Restart Extensions|重启扩展|重新启动扩展"
    $canceledNotificationVisible = "$promptUiaText`n$activatedUiaText" -match '"name"\s*:\s*"Cancel(?:ed|led)"|"Name"\s*:\s*"Cancel(?:ed|led)"'
    $expectsPreparedFlow = [Version]$old.version -ge [Version]"1.1.4"
    $initialVersion = if ($null -ne $initialProbe) {
      [string](Get-ChipMateProbeValue -Object (Get-ChipMateProbeValue -Object $initialProbe -Name "extension") -Name "version")
    } else { "" }
    $initialStatus = if ($null -ne $initialProbe) {
      [string](Get-ChipMateProbeValue -Object $initialProbe -Name "status")
    } else { "" }
    $reloadAssertions = if ($null -ne $firstReload -and $null -ne $firstReload.evaluation) {
      @($firstReload.evaluation.assertions)
    } else {
      @([ordered]@{
        id = "fresh-activation"
        status = "FAIL"
        detail = "首次 Reload 没有产生可评估的 Probe 回执。"
      })
    }
    $motionAssertions = if ($null -ne $motion -and $motion.PSObject.Properties.Name -contains "assertions") {
      @($motion.assertions | ForEach-Object {
        [ordered]@{
          id = "first-reload-$($_.id)"
          status = [string]$_.status
          detail = [string]$_.detail
        }
      })
    } else {
      @([ordered]@{
        id = "first-reload-spinner-motion"
        status = "FAIL"
        detail = if ($motionError) { $motionError.Trim() } else { "首次 Reload 后未生成动态 spinner CDP 结果。" }
      })
    }
    $assertions = @(
      @{ id = "path-code-missing"; status = "PASS"; detail = "Get-Command code 无结果" },
      @{ id = "manifest-request"; status = if ($manifestRequests.Count -ge 1) { "PASS" } else { "FAIL" }; detail = "manifest requests=$($manifestRequests.Count)" },
      @{ id = "single-download"; status = if ($vsixRequests.Count -eq 1) { "PASS" } else { "FAIL" }; detail = "VSIX requests=$($vsixRequests.Count)" },
      @{ id = "builtin-cli"; status = if ($logText -match "当前 VS Code 内置 CLI") { "PASS" } else { "FAIL" }; detail = "专用日志记录内置 CLI" },
      @{ id = "full-window-reload-request"; status = if ($logText -match "请求完整窗口重载") { "PASS" } else { "FAIL" }; detail = "专用日志记录完整窗口重载请求" },
      @{ id = "candidate-activation-log"; status = if ($logText -match "更新首次重载已激活") { "PASS" } else { "FAIL" }; detail = "新宿主激活结果写入同一 ChipMate 更新日志" },
      @{ id = "update-flow-version-boundary"; status = if ($newUpdateFlow -eq $expectsPreparedFlow) { "PASS" } else { "FAIL" }; detail = "previous=$($old.version) expectsPreparedFlow=$expectsPreparedFlow actualPreparedFlow=$newUpdateFlow；候选包不能反向改变旧版更新代码" },
      @{ id = "chipmate-owned-update-action"; status = if (($newUpdateFlow -and $promptUiaText -match "Install and Reload Window|安装并重载窗口") -or (-not $newUpdateFlow -and $promptUiaText -match 'Reload Window|重载窗口')) { "PASS" } else { "FAIL" }; detail = "仅点击 ChipMate 动作；preparedFlow=$newUpdateFlow actions=$($actionNames -join ' / ')" },
      @{ id = "no-restart-extensions-before-install"; status = if (-not $newUpdateFlow -or -not $restartExtensionsVisible) { "PASS" } else { "FAIL" }; detail = "1.1.4+ 新流程在安装前不应出现 VS Code Restart Extensions=$restartExtensionsVisible；旧版兼容链只验证不点击该动作" },
      @{ id = "no-canceled-notification"; status = if (-not $canceledNotificationVisible) { "PASS" } else { "FAIL" }; detail = "安装并完整重载前后 UIA 不包含新增 Canceled/Cancelled 通知=$canceledNotificationVisible" },
      @{ id = "cache-sha"; status = if (@($cache | Where-Object { $_.sha256 -eq $Artifact.sha256 }).Count -ge 1) { "PASS" } else { "FAIL" }; detail = "缓存包含候选 VSIX SHA-256" },
      @{ id = "initial-window-old-version"; status = if ($initialVersion -eq $old.version -and $initialStatus -eq "FAIL") { "PASS" } else { "FAIL" }; detail = "initialVersion=$initialVersion expectedOld=$($old.version) initialStatus=$initialStatus expectedCandidate=$ExpectedVersion" },
      @{ id = "same-window-process"; status = if ($windowStayedAlive) { "PASS" } else { "FAIL" }; detail = "Reload 后未重新启动 GUI 进程；initialGuiPid=$(if ($null -ne $process) { $process.Id } else { 'unknown' }) stayedAlive=$windowStayedAlive" }
    )
    $assertions += $reloadAssertions
    $assertions += $motionAssertions
    $assertions += @(
      @{ id = "disk-installed-candidate"; status = if ($diskInstalled) { "PASS" } else { "FAIL" }; detail = "扩展目录列出候选版本 $ExpectedVersion=$diskInstalled" },
      @{ id = "webview-open-in-tab"; status = if ($null -ne $openInTabReply) { "PASS" } else { "FAIL" }; detail = "首次 Reload Host 的 control channel 执行 chipmate.v2.openInTab" },
      @{ id = "first-reload-spinner-chat-request"; status = if ($motionChatRequests -ge 1 -and -not $motionRequestError) { "PASS" } else { "FAIL" }; detail = "首次 Reload 后 mock provider chat requests=$motionChatRequests error=$($motionRequestError.Trim())" },
      @{ id = "webview-ready-show-memory"; status = if ($null -ne $showMemoryReply) { "PASS" } else { "FAIL" }; detail = "首次 Reload Host 的 chipmate.v2.showMemory 已完成；该命令等待 webview ready" }
    )
    $pass = @($assertions | Where-Object { $_.status -ne "PASS" }).Count -eq 0
    Add-Result `
      -CaseId "WIN-UPDATE" `
      -Status $(if ($pass) { "PASS" } else { "FAIL" }) `
      -Summary "PATH 无 code 的隔离中文空格目录按旧版 updater 能力选择 ChipMate 自有动作：1.1.3 兼容链使用 Reload Window，1.1.4+ 行为链使用 Install and Reload Window；均不点击 VS Code Restart Extensions，并以内置 CLI、完整窗口重载、新 activation Probe、无 Canceled 通知、真实 working spinner 和 webview ready 回执验收。" `
      -ErrorText (@($reloadError, $motionError, $motionRequestError | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join [Environment]::NewLine) `
      -Screenshots @(
        (@($promptScreenshot, $activatedScreenshot) + @(Get-ChildItem -LiteralPath $motionFrameDirectory -File -Filter "spinner-frame-*.png" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })) |
          Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
          ForEach-Object { Relative-EvidencePath $_ }
      ) `
      -Assertions $assertions
  } finally {
    $env:Path = $saved
  }
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
  if ($ChipMateVsix) {
    $chipmate = [IO.Path]::GetFullPath($ChipMateVsix)
    if (-not (Test-Path -LiteralPath $chipmate -PathType Leaf)) { throw "ChipMate VSIX not found: $chipmate" }
    $exit = Invoke-CodeCli -Arguments @("--install-extension", $chipmate, "--force", "--extensions-dir", $ExtDir, "--user-data-dir", $UserDir) -Log (Join-Path $Evidence "install-chipmate.log")
    if ($exit -ne 0) { throw "ChipMate VSIX installation failed with exit code $exit." }
  }
  $exit = Invoke-CodeCli -Arguments @("--list-extensions", "--show-versions", "--extensions-dir", $ExtDir, "--user-data-dir", $UserDir) -Log (Join-Path $Evidence "extensions.txt")
  if ($exit -ne 0) { throw "VS Code extension list failed with exit code $exit." }
  if (-not (Select-String -LiteralPath (Join-Path $Evidence "extensions.txt") -Pattern "^chipmate\.chipmate@$([Regex]::Escape($ExpectedVersion))$" -Quiet)) {
    throw "Installed extension list does not contain chipmate.chipmate@$ExpectedVersion."
  }
  if ($ChipMateVsix -and -not (Select-String -LiteralPath (Join-Path $Evidence "extensions.txt") -Pattern "^chipmate\.chipmate-code@" -Quiet)) {
    throw "Coexistence lane does not contain chipmate.chipmate-code."
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
  param(
    [switch] $Probe,
    [switch] $AllowMotion
  )
  $args = @($Workspace, "--new-window", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", "--disable-updates")
  if (-not $AllowMotion) { $args += "--force-renderer-accessibility" }
  $args += @("--extensions-dir=$ExtDir", "--user-data-dir=$UserDir", "--remote-debugging-port=$script:CdpPort")
  if ($Probe) { $args += "--extensionDevelopmentPath=$(Join-Path $QaRoot 'probe')" }
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

function Invoke-SettingsCdpRegression {
  $root = Join-Path $Evidence "WIN-SETTINGS-PROVIDER"
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $control = Join-Path $root "control.json"
  $reply = Join-Path $root "control-result.json"
  $env:CHIPMATE_QA_PROBE_OUT = Join-Path $root "control-probe.json"
  $env:CHIPMATE_QA_PROBE_QUIT = "0"
  $env:CHIPMATE_QA_EXPECTED_VERSION = $ExpectedVersion
  $env:CHIPMATE_QA_CONTROL_FILE = $control
  $env:CHIPMATE_QA_CONTROL_OUT = $reply
  $process = Start-GuiSubject -Probe
  try {
    $server = "http://127.0.0.1:$script:MockPort"
    $embedding = "$script:MockOrigin/v1/embeddings"
    $model = "qa-embedding-model-1019"
    $dimension = "3072"
    $desktop = Join-Path $root "desktop.png"
    $narrow = Join-Path $root "narrow-220-420.png"
    $final = Join-Path $root "persisted.png"

    function Invoke-ControlCommand {
      param(
        [Parameter(Mandatory = $true)] [string] $Name,
        [Parameter(Mandatory = $true)] [string] $Command
      )
      $id = [Guid]::NewGuid().ToString("N")
      Write-Utf8NoBom -Path $control -Value (@{
        id = $id
        command = $Command
        args = @()
      } | ConvertTo-Json)
      $limit = (Get-Date).AddSeconds(30)
      $response = $null
      do {
        if (Test-Path -LiteralPath $reply -PathType Leaf) {
          $response = Get-Content -Raw -Encoding UTF8 -LiteralPath $reply | ConvertFrom-Json
          if ($response.id -eq $id) { break }
        }
        Start-Sleep -Milliseconds 100
      } while ((Get-Date) -lt $limit)
      if ($null -eq $response -or $response.id -ne $id) {
        throw "Installed probe did not execute $Name."
      }
      if ($response.status -ne "PASS") {
        throw "Installed probe failed to execute $Name`: $($response.error)"
      }
    }

    function Open-Settings {
      param([Parameter(Mandatory = $true)] [string] $Name)
      Invoke-ControlCommand -Name "Settings for $Name" -Command "chipmate.v2.settingsButtonClicked"
      Start-Sleep -Seconds 2
    }

    Set-ChipMateWindowMaximized -Process $process
    Invoke-ControlCommand -Name "close the primary sidebar" -Command "workbench.action.closeSidebar"
    Open-Settings -Name "audit"
    $audit = Join-Path $root "audit-server.json"
    Invoke-Node -Arguments @(
      (Join-Path $QaRoot "cdp-settings.mjs"),
      "--port=$script:CdpPort",
      "--mode=audit-server",
      "--server=$server",
      "--desktop=$desktop",
      "--narrow=$narrow",
      "--output=$audit"
    ) *> "$audit.log"
    if ($LASTEXITCODE -ne 0) { throw "Settings desktop/responsive/server audit failed. See $audit.log." }

    Set-ChipMateWindowSize -Process $process -Width 680 -Height 900
    Open-Settings -Name "narrow"
    $responsive = Join-Path $root "audit-narrow.json"
    Invoke-Node -Arguments @(
      (Join-Path $QaRoot "cdp-settings.mjs"),
      "--port=$script:CdpPort",
      "--mode=audit-narrow",
      "--narrow=$narrow",
      "--output=$responsive"
    ) *> "$responsive.log"
    if ($LASTEXITCODE -ne 0) { throw "Settings narrow responsive audit failed. See $responsive.log." }

    Set-ChipMateWindowMaximized -Process $process
    Open-Settings -Name "indexing"
    $indexing = Join-Path $root "verify-indexing.json"
    Invoke-Node -Arguments @(
      (Join-Path $QaRoot "cdp-settings.mjs"),
      "--port=$script:CdpPort",
      "--mode=verify-indexing",
      "--server=$server",
      "--embedding=$embedding",
      "--model=$model",
      "--dimension=$dimension",
      "--output=$indexing"
    ) *> "$indexing.log"
    if ($LASTEXITCODE -ne 0) { throw "Settings persisted server/indexing edit failed. See $indexing.log." }

    Open-Settings -Name "verify"
    $verify = Join-Path $root "verify.json"
    Invoke-Node -Arguments @(
      (Join-Path $QaRoot "cdp-settings.mjs"),
      "--port=$script:CdpPort",
      "--mode=verify",
      "--server=$server",
      "--embedding=$embedding",
      "--model=$model",
      "--dimension=$dimension",
      "--desktop=$final",
      "--output=$verify"
    ) *> "$verify.log"
    if ($LASTEXITCODE -ne 0) { throw "Settings reopen persistence verification failed. See $verify.log." }

    $requests = Invoke-RestMethod -Uri "$script:MockOrigin/__qa/requests" -TimeoutSec 2
    $embeddingRequests = @($requests.requests | Where-Object { $_.path -eq "/v1/embeddings" })
    $used = @($embeddingRequests | Where-Object {
      $requestModel = if ($_.PSObject.Properties["model"]) { $_.model } else { $null }
      $requestDimensions = if ($_.PSObject.Properties["dimensions"]) { $_.dimensions } else { $null }
      $requestModel -eq $model -and [int]$requestDimensions -eq [int]$dimension
    })
    $requests | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $root "embedding-requests.json") -Encoding UTF8
    if ($used.Count -lt 1) {
      throw "Saved indexing model/dimension were not observed by the embedding service."
    }

    Save-ChipMateScreenshot -Path (Join-Path $root "installed-window.png")
    Save-ChipMateUiaTree -Process $process -Path (Join-Path $root "installed-window-uia.json")
    Add-Result `
      -CaseId "WIN-SETTINGS-PROVIDER" `
      -Status "PASS" `
      -Summary "真实安装态的全部可见设置页、搜索、220-420px 窄态选择器、Server 校验、保存和重开持久化、索引字段保存和重开持久化均通过；保存后的模型和维度已被 embedding 请求实际使用。" `
      -Screenshots @(
        (Relative-EvidencePath $desktop),
        (Relative-EvidencePath $narrow),
        (Relative-EvidencePath $final),
        (Relative-EvidencePath (Join-Path $root "installed-window.png"))
      )
  } finally {
    Stop-GuiSubject -Process $process
    Remove-Item Env:CHIPMATE_QA_CONTROL_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:CHIPMATE_QA_CONTROL_OUT -ErrorAction SilentlyContinue
    Remove-Item Env:CHIPMATE_QA_PROBE_OUT -ErrorAction SilentlyContinue
    Remove-Item Env:CHIPMATE_QA_PROBE_QUIT -ErrorAction SilentlyContinue
    Remove-Item Env:CHIPMATE_QA_EXPECTED_VERSION -ErrorAction SilentlyContinue
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
  foreach ($problem in $Atomic.problems) {
    foreach ($check in $problem.assertions) {
      if (@($AtomicResults | ForEach-Object { $_.id }) -contains $check.id) { continue }
      if ($Lane -eq "package") {
        Add-AtomicResult -AssertionId $check.id -Status "SKIP" -Summary "包审计通道仅裁决冻结 VSIX 的身份、目标与内容，不裁决运行态功能矩阵。"
        continue
      }
      if ($Lane -eq "settings") {
        Add-AtomicResult -AssertionId $check.id -Status "SKIP" -Summary "设置页重构聚焦通道仅裁决安装态设置导航、响应式布局和字段交互；历史功能矩阵不据此判定。"
        continue
      }
      if ($Lane -eq "update") {
        Add-AtomicResult -AssertionId $check.id -Status "SKIP" -Summary "自动更新聚焦通道仅裁决 WIN-UPDATE，不从该结果推断其他功能矩阵。"
        continue
      }
      if ($Lane -eq "settings") {
        Add-AtomicResult -AssertionId $check.id -Status "SKIP" -Summary "设置页聚焦通道不裁决其他功能矩阵。"
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
  if ($Lane -in @("settings", "package", "update")) {
    [ordered]@{
      status = "SCOPED"
      lane = $Lane
      case = if ($Lane -eq "settings") {
        "WIN-SETTINGS-PROVIDER"
      } elseif ($Lane -eq "package") {
        "WIN-PACKAGE-INSTALL"
      } elseif ($Lane -eq "update") {
        "WIN-UPDATE"
      }
      note = if ($Lane -eq "settings") {
        "全仓 coverage ledger 不属于设置页重构聚焦通道；QA 与其他功能不据此判定。"
      } elseif ($Lane -eq "package") {
        "全仓 coverage ledger 不属于冻结 VSIX 包审计通道；运行态功能不据此判定。"
      } elseif ($Lane -eq "update") {
        "全仓 coverage ledger 不属于自动更新聚焦通道；仅裁决离线 Windows 更新真实链路。"
      }
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
  if ($Lane -eq "update") {
    $script:ProviderMockPort = Get-FreeTcpPort
    $script:ProviderMockOrigin = "http://127.0.0.1:$script:ProviderMockPort"
    $Mock = Start-UpdateServer
    $ProviderMock = Start-MockProvider `
      -Port $script:ProviderMockPort `
      -Origin $script:ProviderMockOrigin `
      -Name "update-motion-provider"
    Initialize-MockProviderConfig -Origin $script:ProviderMockOrigin
    Invoke-UpdateRegression
    foreach ($case in $Matrix.cases) {
      if (@($Results | ForEach-Object { $_.id }) -contains $case.id) { continue }
      Add-Result -CaseId $case.id -Status "SKIP" -Summary "自动更新聚焦通道不裁决其他 Windows 功能矩阵。"
    }
    Complete-Run
    exit $script:ExitCode
  }
  $env:CHIPMATE_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL = "$script:MockOrigin/v1/embeddings"
  Set-MockIndexingEndpoint
  $Mock = Start-MockProvider
  Initialize-MockProviderConfig
  Install-Subject
  Invoke-InstalledProbe
  if ($Lane -in @("smoke", "settings")) {
    Add-Result -CaseId "WIN-SMOKE-INSTALL" -Status "PASS" -Summary "正式安装、版本列表与 installed-host 激活 probe 通过。"
  } elseif ($PreviousVsix -and $ChipMateVsix) {
    Add-Result -CaseId "WIN-IDENTITY-UPGRADE" -Status "PASS" -Summary "正式安装的 ChipMate 已激活，覆盖升级与 ChipMate 同 Profile 前置条件均已执行。"
  } else {
    Add-Result -CaseId "WIN-IDENTITY-UPGRADE" -Status "BLOCKED" -Summary "安装态激活 probe 已通过；完整 PASS 仍需要同时传入 -PreviousVsix 和 -ChipMateVsix。"
  }

  if (-not $NoGui) {
    if ($Lane -eq "settings") {
      Invoke-SettingsCdpRegression
    } else {
      Invoke-SettingsKeyboardRegression
      if ($Lane -eq "smoke") {
        Invoke-IndexingSmoke
      } else {
        Invoke-VisualCapture
      }
      Invoke-CliLifecycleAudit
    }
  } else {
    if ($Lane -in @("settings", "smoke", "core", "full")) {
      Add-Result -CaseId "WIN-SETTINGS-PROVIDER" -Status "BLOCKED" -Summary "NoGui 禁止逐字符 GUI 输入验证。"
    }
    if ($Lane -ne "settings") {
      if ($Lane -eq "smoke") {
        Add-Result -CaseId "WIN-SMOKE-INDEXING" -Status "BLOCKED" -Summary "NoGui 禁止索引运行态采证。"
      } else {
        Add-Result -CaseId "WIN-BRANDING-FIRST-RUN" -Status "BLOCKED" -Summary "NoGui 禁止首次启动视觉采证。"
      }
      Add-Result -CaseId "WIN-CLI-LIFECYCLE" -Status "BLOCKED" -Summary "NoGui 禁止 Reload、Extension Host 和孤儿进程交互审计。"
    }
  }

  foreach ($case in $Matrix.cases) {
    if (@($Results | ForEach-Object { $_.id }) -contains $case.id) { continue }
    if ($Lane -eq "settings") {
      Add-Result -CaseId $case.id -Status "SKIP" -Summary "设置页重构聚焦通道不裁决此功能。"
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
  if ($null -ne $ProviderMock -and -not $ProviderMock.HasExited) {
    try {
      Invoke-RestMethod -Uri "$script:ProviderMockOrigin/__qa/requests" -TimeoutSec 2 |
        ConvertTo-Json -Depth 10 |
        Set-Content -LiteralPath (Join-Path $Evidence "update-motion-provider-requests.json") -Encoding UTF8
    } catch {
      $_ | Out-String | Set-Content -LiteralPath (Join-Path $Evidence "update-motion-provider-requests-error.log") -Encoding UTF8
    }
  }
  if ($null -ne $ProviderMock -and -not $ProviderMock.HasExited) {
    Stop-Process -Id $ProviderMock.Id -Force -ErrorAction SilentlyContinue
  }
  try {
    Save-RunSnapshot
  } catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $Evidence "snapshot-error.log") -Encoding UTF8
  }
  Complete-Run
}

exit $script:ExitCode
