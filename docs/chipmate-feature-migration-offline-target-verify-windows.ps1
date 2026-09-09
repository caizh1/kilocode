param(
  [Parameter(Mandatory = $true)]
  [string] $BundlePath,

  [Parameter(Mandatory = $false)]
  [string] $EvidenceDir = "chipmate-0.0.38-offline-target-windows-evidence"
)

$ErrorActionPreference = "Stop"

$ExpectedVersion = "0.0.38"
$ExpectedBundleSha = "97a70108ae648a1998168d679c3c65638ea7756926860fad113cd06c31d2dba5"
$ExpectedBundleSize = 317784738
$ExpectedLinuxVsix = "chipmate-vscode-linux-x64-baseline.vsix"
$ExpectedLinuxSha = "95218162b0d0a09c6425c80a10e9745569c1b021edd9d666a5f43278d31458ad"
$ExpectedWindowsVsix = "chipmate-vscode-win32-x64-baseline.vsix"
$ExpectedWindowsSha = "3c6b9943ecf8259379c6f75b1ff321bb83677c092aac3974584524fcd90e489d"

function Fail([string] $Message) {
  Write-Error "FAIL: $Message"
  exit 1
}

function Sha256([string] $Path) {
  return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

function Assert-VsixCliMarkers([string] $VsixPath, [string] $CliMember, [string] $Label) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $RequiredMarkers = @(
    "source-backed-detail-design",
    "generic Word/Mermaid/artifact guidance",
    "not a migrated Word/document contract"
  )
  $ForbiddenMarkers = @(
    "validate_artifacts",
    "nextToolContract",
    "missingDeliverable",
    "missing-required-artifact",
    "missing-mermaid-pngs",
    "先渲染缺失图表",
    "缺失文档合同规划"
  )

  $Zip = [System.IO.Compression.ZipFile]::OpenRead($VsixPath)
  try {
    $Entry = $Zip.GetEntry($CliMember)
    if ($null -eq $Entry) {
      Fail "$Label VSIX missing CLI member: $CliMember"
    }
    $Stream = $Entry.Open()
    try {
      $Memory = New-Object System.IO.MemoryStream
      try {
        $Stream.CopyTo($Memory)
        $Text = [System.Text.Encoding]::UTF8.GetString($Memory.ToArray())
      } finally {
        $Memory.Dispose()
      }
    } finally {
      $Stream.Dispose()
    }

    foreach ($Marker in $RequiredMarkers) {
      if (-not $Text.Contains($Marker)) {
        Fail "$Label VSIX missing required CLI marker: $Marker"
      }
    }
    foreach ($Marker in $ForbiddenMarkers) {
      if ($Text.Contains($Marker)) {
        Fail "$Label VSIX contains forbidden old ChipMate contract marker: $Marker"
      }
    }
  } finally {
    $Zip.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $BundlePath -PathType Leaf)) {
  Fail "bundle not found: $BundlePath"
}

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

$BundleSha = Sha256 $BundlePath
$BundleSize = (Get-Item -LiteralPath $BundlePath).Length

if ($BundleSha -ne $ExpectedBundleSha) {
  Fail "bundle sha mismatch: expected $ExpectedBundleSha got $BundleSha"
}
if ($BundleSize -ne $ExpectedBundleSize) {
  Fail "bundle size mismatch: expected $ExpectedBundleSize got $BundleSize"
}

$ActualTarContents = Join-Path $EvidenceDir "tar-contents.actual.txt"
$ExpectedTarContents = Join-Path $EvidenceDir "tar-contents.expected.txt"
$TarDiff = Join-Path $EvidenceDir "tar-contents.diff.txt"

tar -tzf $BundlePath | Sort-Object | Set-Content -Encoding UTF8 $ActualTarContents
@(
  "OFFLINE_RELEASE_INDEX-chipmate-$ExpectedVersion.json",
  "OFFLINE_RELEASE_INDEX-chipmate-$ExpectedVersion.md",
  "OFFLINE_RELEASE_NOTES-chipmate-$ExpectedVersion.md",
  "SHA256SUMS-chipmate-$ExpectedVersion-offline.txt",
  $ExpectedLinuxVsix,
  $ExpectedWindowsVsix
) | Sort-Object | Set-Content -Encoding UTF8 $ExpectedTarContents

$Actual = Get-Content $ActualTarContents
$Expected = Get-Content $ExpectedTarContents
$Compare = Compare-Object -ReferenceObject $Expected -DifferenceObject $Actual
if ($Compare) {
  $Compare | Out-String | Set-Content -Encoding UTF8 $TarDiff
  Fail "tar contents differ; see $TarDiff"
}
Set-Content -Encoding UTF8 -Path $TarDiff -Value "No differences."

if ($Actual | Where-Object { $_ -match '(^|/)(\._|\.DS_Store|__MACOSX)(/|$)' }) {
  Fail "macOS metadata found in tar contents"
}

$WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("chipmate-target-verify-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

try {
  tar -xzf $BundlePath -C $WorkDir

  $LinuxSha = Sha256 (Join-Path $WorkDir $ExpectedLinuxVsix)
  $WindowsSha = Sha256 (Join-Path $WorkDir $ExpectedWindowsVsix)

  if ($LinuxSha -ne $ExpectedLinuxSha) {
    Fail "linux vsix sha mismatch: expected $ExpectedLinuxSha got $LinuxSha"
  }
  if ($WindowsSha -ne $ExpectedWindowsSha) {
    Fail "windows vsix sha mismatch: expected $ExpectedWindowsSha got $WindowsSha"
  }

  Assert-VsixCliMarkers (Join-Path $WorkDir $ExpectedLinuxVsix) "extension/bin/chipmate" "linux"
  Assert-VsixCliMarkers (Join-Path $WorkDir $ExpectedWindowsVsix) "extension/bin/chipmate.exe" "windows"
  "linux: CLI marker boundary OK`nwindows: CLI marker boundary OK" | Set-Content -Encoding UTF8 -Path (Join-Path $EvidenceDir "vsix-marker-verify.txt")

  $ReleaseIndexJson = Get-Content -Raw -Path (Join-Path $WorkDir "OFFLINE_RELEASE_INDEX-chipmate-$ExpectedVersion.json")
  if ($ReleaseIndexJson -notmatch '"version"\s*:\s*"0\.0\.38"') {
    Fail "release index json does not contain expected version"
  }

  $ShaSums = Get-Content -Raw -Path (Join-Path $WorkDir "SHA256SUMS-chipmate-$ExpectedVersion-offline.txt")
  if ($ShaSums -notmatch $ExpectedLinuxSha) {
    Fail "sha256 sums file missing linux vsix hash"
  }
  if ($ShaSums -notmatch $ExpectedWindowsSha) {
    Fail "sha256 sums file missing windows vsix hash"
  }

  $Summary = Join-Path $EvidenceDir "summary.md"
  @"
# ChipMate Offline Target Windows Verification

- Status: PASS
- Target kind: offline windows x86-64
- Bundle: ``$BundlePath``
- Bundle SHA256: ``$BundleSha``
- Bundle size: ``$BundleSize``
- Version: ``$ExpectedVersion``
- Linux VSIX SHA256: ``$LinuxSha``
- Windows VSIX SHA256: ``$WindowsSha``
- VSIX CLI marker boundary: ``vsix-marker-verify.txt``
- Tar contents evidence: ``tar-contents.actual.txt``
- Tar contents diff: ``tar-contents.diff.txt``

This verifies transfer/package integrity only. It does not prove installed VS Code chat QA, Document RAG, autocomplete, Word, Mermaid, or source-backed detail-design runtime behavior.
"@ | Set-Content -Encoding UTF8 -Path $Summary

  Write-Host "PASS: wrote $Summary"
} finally {
  Remove-Item -Recurse -Force -LiteralPath $WorkDir -ErrorAction SilentlyContinue
}
