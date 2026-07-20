[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Vsix,
  [string] $CodePath,
  [string] $PreviousVsix,
  [string] $KiloVsix,
  [string] $FixtureRoot,
  [string] $Output,
  [ValidateSet("full", "core", "smoke", "package")] [string] $Lane = "smoke",
  [switch] $NoGui
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$QaRoot = $PSScriptRoot
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $QaRoot "..\..\..\.."))
$Matrix = Get-Content -Raw -LiteralPath (Join-Path $QaRoot "cases.json") | ConvertFrom-Json
$Atomic = Get-Content -Raw -LiteralPath (Join-Path $QaRoot "atomic-cases.json") | ConvertFrom-Json
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
$ExtDir = Join-Path $Runtime "extensions"
$UserDir = Join-Path $Runtime "user"
New-Item -ItemType Directory -Force -Path $ExtDir, $UserDir | Out-Null

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
  @{
    "chipmate.v2.language" = "zh-cn"
    "chipmate.v2.indexing.provider" = "openai-compatible"
    "chipmate.v2.indexing.model" = "qa-embedding-model"
    "chipmate.v2.indexing.dimension" = 2048
  } | ConvertTo-Json | Set-Content -LiteralPath $settings -Encoding UTF8
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
  $manifest = Get-Content -Raw -LiteralPath (Join-Path $unpack "extension\package.json") | ConvertFrom-Json
  if ($manifest.publisher -ne "chipmate" -or $manifest.name -ne "chipmate") { throw "Unexpected extension identity in VSIX." }
  if ($manifest.version -ne "0.0.88") { throw "Expected VSIX version 0.0.88, got $($manifest.version)." }
  if ($manifest.chipmatePackageTarget -ne "win32-x64-baseline") { throw "Unexpected chipmatePackageTarget: $($manifest.chipmatePackageTarget)" }
  return @{ vsix = $Vsix; sha256 = $hash; version = $manifest.version; target = $manifest.chipmatePackageTarget }
}

function Invoke-Coverage {
  $ledger = Join-Path $Evidence "coverage-ledger.json"
  if (Test-Path -LiteralPath (Join-Path $RepoRoot ".changeset")) {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    & $node (Join-Path $QaRoot "coverage.mjs") --output $ledger | Set-Content -LiteralPath (Join-Path $Evidence "coverage.log") -Encoding UTF8
    if ($LASTEXITCODE -ne 0) { throw "Changeset/runtime coverage gate failed. See coverage.log." }
    return
  }
  $snapshot = Join-Path $QaRoot "coverage-snapshot.json"
  if (-not (Test-Path -LiteralPath $snapshot)) { throw "Standalone kit is missing coverage-snapshot.json." }
  $frozen = Get-Content -Raw -LiteralPath $snapshot | ConvertFrom-Json
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

function Start-MockProvider {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $stdout = Join-Path $Evidence "mock-provider.log"
  $stderr = Join-Path $Evidence "mock-provider-error.log"
  $process = Start-Process -FilePath $node -ArgumentList @((Join-Path $QaRoot "mock-provider.mjs"), "--port=43119") -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
  $limit = (Get-Date).AddSeconds(20)
  do {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:43119/__qa/health" -TimeoutSec 1
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
    & $CodeCli --install-extension $previous --force --extensions-dir $ExtDir --user-data-dir $UserDir *> (Join-Path $Evidence "install-previous.log")
    if ($LASTEXITCODE -ne 0) { throw "Previous VSIX installation failed." }
    $userSettings = Join-Path $UserDir "User\settings.json"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $userSettings) | Out-Null
    @{ "chipmate.v2.language" = "auto" } | ConvertTo-Json | Set-Content -LiteralPath $userSettings -Encoding UTF8
  }
  & $CodeCli --install-extension $Vsix --force --extensions-dir $ExtDir --user-data-dir $UserDir *> $log
  if ($LASTEXITCODE -ne 0) { throw "VSIX installation failed. See install.log." }
  if ($KiloVsix) {
    $kilo = [IO.Path]::GetFullPath($KiloVsix)
    if (-not (Test-Path -LiteralPath $kilo -PathType Leaf)) { throw "Kilo VSIX not found: $kilo" }
    & $CodeCli --install-extension $kilo --force --extensions-dir $ExtDir --user-data-dir $UserDir *> (Join-Path $Evidence "install-kilo.log")
    if ($LASTEXITCODE -ne 0) { throw "Kilo VSIX installation failed." }
  }
  & $CodeCli --list-extensions --show-versions --extensions-dir $ExtDir --user-data-dir $UserDir | Set-Content -LiteralPath (Join-Path $Evidence "extensions.txt") -Encoding UTF8
  if (-not (Select-String -LiteralPath (Join-Path $Evidence "extensions.txt") -Pattern "^chipmate\.chipmate@0\.0\.88$" -Quiet)) {
    throw "Installed extension list does not contain chipmate.chipmate@0.0.88."
  }
  if ($KiloVsix -and -not (Select-String -LiteralPath (Join-Path $Evidence "extensions.txt") -Pattern "^kilocode\.kilo-code@" -Quiet)) {
    throw "Coexistence lane does not contain kilocode.kilo-code."
  }
}

function Invoke-InstalledProbe {
  $probe = Join-Path $Evidence "installed-probe.json"
  $env:CHIPMATE_QA_PROBE_OUT = $probe
  $env:CHIPMATE_QA_PROBE_QUIT = "1"
  $env:CHIPMATE_QA_EXPECTED_VERSION = "0.0.88"
  $args = @(
    $Workspace,
    "--new-window",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    "--extensions-dir=$ExtDir",
    "--user-data-dir=$UserDir",
    "--extensionDevelopmentPath=$(Join-Path $QaRoot 'probe')"
  )
  $process = Start-Process -FilePath $Code -ArgumentList $args -PassThru
  $limit = (Get-Date).AddSeconds(90)
  do {
    if (Test-Path -LiteralPath $probe) { break }
    if ($process.HasExited) { Start-Sleep -Milliseconds 300 }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $limit)
  if (-not (Test-Path -LiteralPath $probe)) { throw "Installed-host probe did not produce a result." }
  $result = Get-Content -Raw -LiteralPath $probe | ConvertFrom-Json
  if ($result.status -ne "PASS") { throw "Installed-host probe failed: $($result.errors -join '; ')" }
  if (-not $process.HasExited) {
    [void]$process.WaitForExit(10000)
  }
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}

function Start-GuiSubject {
  . (Join-Path $QaRoot "ui-automation.ps1")
  $args = @($Workspace, "--new-window", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", "--extensions-dir=$ExtDir", "--user-data-dir=$UserDir")
  Start-Process -FilePath $Code -ArgumentList $args | Out-Null
  $process = Get-ChipMateCodeWindow
  Set-ChipMateForeground -Process $process
  return $process
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
    $process.CloseMainWindow() | Out-Null
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
    $process.CloseMainWindow() | Out-Null
  }
}

function Invoke-IndexingSmoke {
  $process = Start-GuiSubject
  try {
    $limit = (Get-Date).AddSeconds(180)
    $embedding = $false
    do {
      try {
        $requests = Invoke-RestMethod -Uri "http://127.0.0.1:43119/__qa/requests" -TimeoutSec 2
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
    $process.CloseMainWindow() | Out-Null
  }
}

function Invoke-AgentConsoleSmoke {
  $process = Start-GuiSubject
  try {
    Invoke-ChipMateCommandPalette -Process $process -Command "ChipMate: Open Agent Console"
    Start-Sleep -Seconds 3
    $opened = Invoke-ChipMateNamedControl -Process $process -Names @("Shell")
    $edit = Find-ChipMateFocusableEdit -Process $process
    if ($opened -and $null -ne $edit) {
      Send-ChipMateTextByKeyboard -Element $edit -Text "Write-Output CHIPMATE_QA_OK"
      Start-Sleep -Seconds 3
    }
    $shot = Relative-EvidencePath (Join-Path $Evidence "WIN-SMOKE-AGENT-CONSOLE\console.png")
    $tree = Join-Path $Evidence "WIN-SMOKE-AGENT-CONSOLE\console-uia.json"
    Save-ChipMateScreenshot -Path (Join-Path $Output $shot)
    Save-ChipMateUiaTree -Process $process -Path $tree
    $treeText = Get-Content -Raw -LiteralPath $tree
    $outputSeen = $treeText -match "CHIPMATE_QA_OK"
    $assertions = @(
      @{ id = "console-open"; status = if ($opened) { "PASS" } else { "FAIL" }; detail = "Agent Console Shell control observed=$opened" },
      @{ id = "fixed-command-output"; status = if ($outputSeen) { "PASS" } else { "FAIL" }; detail = "CHIPMATE_QA_OK observed=$outputSeen" },
      @{ id = "approval-cancel"; status = "BLOCKED"; detail = "需要 Agent 模式的确定性高风险 tool-call 夹具；不得用 Shell 立即执行冒充审批。" }
    )
    Add-Result -CaseId "WIN-SMOKE-AGENT-CONSOLE" -Status "BLOCKED" -Summary "Console 打开与固定命令已执行；审批取消仍缺少安全的 Agent tool-call 夹具。" -Screenshots @($shot) -Assertions $assertions
  } finally {
    $process.CloseMainWindow() | Out-Null
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
  if ($AtomicResults.id -contains $AssertionId) { throw "Duplicate atomic result: $AssertionId" }
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
      if ($AtomicResults.id -contains $check.id) { continue }
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
      @(Get-ChildItem -LiteralPath $root.path -Recurse -File | ForEach-Object {
        [ordered]@{
          path = $_.FullName.Substring($root.path.Length).TrimStart('\')
          bytes = $_.Length
          sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
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
    artifact = $artifactValue
    results = $Results
    atomicResults = $AtomicResults
  }
  $resultPath = Join-Path $Output "results.json"
  $payload | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resultPath -Encoding UTF8
  $sensitive = Get-ChildItem -LiteralPath $Output -Recurse -File -Include *.json,*.log,*.txt,*.md,*.html,*.xml |
    Select-String -Pattern "Bearer\s+[^\s<]+|sk-[A-Za-z0-9_-]{8,}|test-secret" -ErrorAction SilentlyContinue
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
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    & $node (Join-Path $QaRoot "report.mjs") $resultPath (Join-Path $Output "report.html") | Out-Null
  } catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $Output "report-error.log") -Encoding UTF8
  }
  $zip = Join-Path (Split-Path -Parent $Output) "$(Split-Path -Leaf $Output)-evidence.zip"
  Compress-Archive -Path (Join-Path $Output "*") -DestinationPath $zip -Force
  Write-Host "RESULTS=$resultPath"
  Write-Host "REPORT=$(Join-Path $Output 'report.html')"
  Write-Host "EVIDENCE_ZIP=$zip"
}

try {
  Initialize-Fixture
  $Artifact = Test-FrozenVsix
  Invoke-Coverage
  Add-Result -CaseId "WIN-PACKAGE-INSTALL" -Status "PASS" -Summary "VSIX 内容和 manifest 验证通过。"

  if ($Lane -eq "package") { Complete-Run; exit $script:ExitCode }

  $Code = Resolve-Code
  $CodeCli = Join-Path (Split-Path -Parent $Code) "bin\code.cmd"
  if (-not (Test-Path -LiteralPath $CodeCli)) { throw "VS Code CLI not found next to Code.exe: $CodeCli" }
  $env:KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL = "http://127.0.0.1:43119/v1"
  $Mock = Start-MockProvider
  Install-Subject
  Invoke-InstalledProbe
  if ($Lane -eq "smoke") {
    Add-Result -CaseId "WIN-SMOKE-INSTALL" -Status "PASS" -Summary "正式安装、版本列表与 installed-host 激活 probe 通过。"
  } elseif ($PreviousVsix -and $KiloVsix) {
    Add-Result -CaseId "WIN-IDENTITY-UPGRADE" -Status "PASS" -Summary "正式安装的 ChipMate 已激活，覆盖升级与 Kilo 同 Profile 前置条件均已执行。"
  } else {
    Add-Result -CaseId "WIN-IDENTITY-UPGRADE" -Status "BLOCKED" -Summary "安装态激活 probe 已通过；完整 PASS 仍需要同时传入 -PreviousVsix 和 -KiloVsix。"
  }

  if (-not $NoGui) {
    Invoke-SettingsKeyboardRegression
    if ($Lane -eq "smoke") {
      Invoke-IndexingSmoke
      Invoke-AgentConsoleSmoke
    } else {
      Invoke-VisualCapture
    }
  } else {
    Add-Result -CaseId "WIN-SETTINGS-PROVIDER" -Status "BLOCKED" -Summary "NoGui 禁止逐字符 GUI 输入验证。"
    if ($Lane -eq "smoke") {
      Add-Result -CaseId "WIN-SMOKE-INDEXING" -Status "BLOCKED" -Summary "NoGui 禁止索引运行态采证。"
      Add-Result -CaseId "WIN-SMOKE-AGENT-CONSOLE" -Status "BLOCKED" -Summary "NoGui 禁止 Agent Console 交互采证。"
    } else {
      Add-Result -CaseId "WIN-BRANDING-FIRST-RUN" -Status "BLOCKED" -Summary "NoGui 禁止首次启动视觉采证。"
    }
  }

  foreach ($case in $Matrix.cases) {
    if ($Results.id -contains $case.id) { continue }
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
      Invoke-RestMethod -Uri "http://127.0.0.1:43119/__qa/requests" -TimeoutSec 2 |
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
