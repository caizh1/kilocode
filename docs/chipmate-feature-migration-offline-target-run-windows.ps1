param(
  [Parameter(Mandatory = $true)]
  [string] $DeliveryDir,

  [Parameter(Mandatory = $false)]
  [string] $EvidenceDir = ""
)

$ErrorActionPreference = "Stop"
$Version = "0.0.38"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerStatus = "PASS_PACKAGE_ONLY"
$DeliveryDir = (Resolve-Path -LiteralPath $DeliveryDir).Path
if ([string]::IsNullOrWhiteSpace($EvidenceDir)) {
  $EvidenceDir = Join-Path $DeliveryDir "chipmate-$Version-target-package-evidence-windows"
}
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

$Bundle = Join-Path $DeliveryDir "chipmate-$Version-offline-handoff.tar.gz"
$SofficeCommand = Get-Command soffice -ErrorAction SilentlyContinue
$PdftoppmCommand = Get-Command pdftoppm -ErrorAction SilentlyContinue
$WordRenderEndpointStatus = if ([string]::IsNullOrWhiteSpace([System.Environment]::GetEnvironmentVariable("CHIPMATE_WORD_RENDER_ENDPOINT"))) { "not configured" } else { "configured" }
$WordRenderSofficeEnv = [System.Environment]::GetEnvironmentVariable("CHIPMATE_WORD_RENDER_SOFFICE")
$WordRenderPdftoppmEnv = [System.Environment]::GetEnvironmentVariable("CHIPMATE_WORD_RENDER_PDFTOPPM")
$WordRenderSofficeStatus = if (-not [string]::IsNullOrWhiteSpace($WordRenderSofficeEnv)) {
  if (Test-Path -LiteralPath $WordRenderSofficeEnv -PathType Leaf) { $WordRenderSofficeEnv } else { "configured but not found: $WordRenderSofficeEnv" }
} elseif ($SofficeCommand) {
  "PATH: $($SofficeCommand.Source)"
} else {
  "not configured and not found on PATH"
}
$WordRenderPdftoppmStatus = if (-not [string]::IsNullOrWhiteSpace($WordRenderPdftoppmEnv)) {
  if (Test-Path -LiteralPath $WordRenderPdftoppmEnv -PathType Leaf) { $WordRenderPdftoppmEnv } else { "configured but not found: $WordRenderPdftoppmEnv" }
} elseif ($PdftoppmCommand) {
  "PATH: $($PdftoppmCommand.Source)"
} else {
  "not configured and not found on PATH"
}

@"
# ChipMate Windows Target Package Evidence Environment

- Date UTC: $((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))
- Delivery directory: $DeliveryDir
- Evidence directory: $EvidenceDir
- OS: $([System.Environment]::OSVersion.VersionString)
- Machine name: $([System.Environment]::MachineName)
- Processor architecture: $([System.Environment]::GetEnvironmentVariable("PROCESSOR_ARCHITECTURE"))
- PowerShell version: $($PSVersionTable.PSVersion)

## Optional Word render availability

- CHIPMATE_WORD_RENDER_ENDPOINT: $WordRenderEndpointStatus
- soffice: $WordRenderSofficeStatus
- pdftoppm: $WordRenderPdftoppmStatus
"@ | Set-Content -Encoding UTF8 -Path (Join-Path $EvidenceDir "environment.md")

$Python = Get-Command python -ErrorAction SilentlyContinue
if (-not $Python) {
  $Python = Get-Command python3 -ErrorAction SilentlyContinue
}

if ($Python) {
  & $Python.Source (Join-Path $ScriptDir "chipmate-feature-migration-offline-delivery-set-verify.py") `
    $DeliveryDir `
    --output (Join-Path $EvidenceDir "delivery-set-summary.md") `
    > (Join-Path $EvidenceDir "delivery-set.stdout.txt") `
    2> (Join-Path $EvidenceDir "delivery-set.stderr.txt")

  & $Python.Source (Join-Path $ScriptDir "chipmate-feature-migration-offline-target-verify.py") `
    $Bundle `
    (Join-Path $EvidenceDir "python-bundle-evidence") `
    > (Join-Path $EvidenceDir "python-bundle.stdout.txt") `
    2> (Join-Path $EvidenceDir "python-bundle.stderr.txt")
} else {
  $RunnerStatus = "PASS_WITH_LIMITS"
  @"
# Python Not Available

- Status: BLOCKED_ENV
- Impact: delivery-set verifier and Python bundle verifier were not run.
- Fallback: Windows PowerShell bundle verifier still runs below.
"@ | Set-Content -Encoding UTF8 -Path (Join-Path $EvidenceDir "python-not-available.md")
}

& powershell -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "chipmate-feature-migration-offline-target-verify-windows.ps1") `
  -BundlePath $Bundle `
  -EvidenceDir (Join-Path $EvidenceDir "powershell-bundle-evidence") `
  > (Join-Path $EvidenceDir "powershell-bundle.stdout.txt") `
  2> (Join-Path $EvidenceDir "powershell-bundle.stderr.txt")

$Template = Join-Path $ScriptDir "chipmate-feature-migration-target-evidence-return-template.md"
if (Test-Path -LiteralPath $Template -PathType Leaf) {
  Copy-Item -LiteralPath $Template -Destination (Join-Path $EvidenceDir "chipmate-feature-migration-target-evidence-return-template.md") -Force
}

$DeliveryManifestJson = Join-Path $DeliveryDir "CHIPMATE_OFFLINE_DELIVERY_MANIFEST-$Version.json"
if (Test-Path -LiteralPath $DeliveryManifestJson -PathType Leaf) {
  Copy-Item -LiteralPath $DeliveryManifestJson -Destination (Join-Path $EvidenceDir "CHIPMATE_OFFLINE_DELIVERY_MANIFEST-$Version.json") -Force
}
$DeliveryManifestMd = Join-Path $DeliveryDir "CHIPMATE_OFFLINE_DELIVERY_MANIFEST-$Version.md"
if (Test-Path -LiteralPath $DeliveryManifestMd -PathType Leaf) {
  Copy-Item -LiteralPath $DeliveryManifestMd -Destination (Join-Path $EvidenceDir "CHIPMATE_OFFLINE_DELIVERY_MANIFEST-$Version.md") -Force
}

$RuntimeBootstrap = Join-Path $ScriptDir "chipmate-feature-migration-target-runtime-evidence-bootstrap.py"
if ($Python -and (Test-Path -LiteralPath $RuntimeBootstrap -PathType Leaf)) {
  & $Python.Source $RuntimeBootstrap `
    --target win32-x64 `
    --output-dir (Join-Path $EvidenceDir "runtime-evidence-skeleton") `
    > (Join-Path $EvidenceDir "runtime-bootstrap.stdout.txt") `
    2> (Join-Path $EvidenceDir "runtime-bootstrap.stderr.txt")
} else {
  $RunnerStatus = "PASS_WITH_LIMITS"
  if (-not $Python) {
    $RuntimeBootstrapBlockedReason = "Python command is not available, so the runtime evidence skeleton was not generated."
  } else {
    $RuntimeBootstrapBlockedReason = "Runtime evidence bootstrap helper script is not available in this runner directory."
  }
  @"
# Runtime Evidence Bootstrap Helper Not Available

- Status: BLOCKED_ENV
- Impact: runtime evidence skeleton was not generated.
- Reason: $RuntimeBootstrapBlockedReason
- Expected file: chipmate-feature-migration-target-runtime-evidence-bootstrap.py
"@ | Set-Content -Encoding UTF8 -Path (Join-Path $EvidenceDir "runtime-bootstrap-not-available.md")
}

$IntakeVerifier = Join-Path $ScriptDir "chipmate-feature-migration-target-evidence-intake-verify.py"
if ($Python -and (Test-Path -LiteralPath $IntakeVerifier -PathType Leaf)) {
  & $Python.Source $IntakeVerifier `
    --target win32-x64 `
    --package-evidence (Join-Path $EvidenceDir "powershell-bundle-evidence") `
    --output (Join-Path $EvidenceDir "intake-summary.md") `
    --allow-package-only `
    > (Join-Path $EvidenceDir "intake.stdout.txt") `
    2> (Join-Path $EvidenceDir "intake.stderr.txt")
} else {
  $RunnerStatus = "PASS_WITH_LIMITS"
  if (-not $Python) {
    $IntakeBlockedReason = "Python command is not available, so the package-only intake self-check could not run."
  } else {
    $IntakeBlockedReason = "Target evidence intake verifier script is not available in this runner directory."
  }
  @"
# Target Evidence Intake Verifier Not Available

- Status: BLOCKED_ENV
- Impact: package-only intake self-check was not run.
- Reason: $IntakeBlockedReason
- Expected file: chipmate-feature-migration-target-evidence-intake-verify.py
"@ | Set-Content -Encoding UTF8 -Path (Join-Path $EvidenceDir "intake-not-available.md")
}

@"
# ChipMate Windows Target Package Evidence Runner

- Status: $RunnerStatus
- Target kind: offline windows x86-64
- Delivery directory: ``$DeliveryDir``
- Evidence directory: ``$EvidenceDir``
- Environment: ``environment.md`` including optional Word renderer availability
- Delivery-set verifier: ``delivery-set-summary.md`` when Python is available
- Python bundle verifier: ``python-bundle-evidence/summary.md`` when Python is available
- PowerShell bundle verifier: ``powershell-bundle-evidence/summary.md``
- Package-only intake self-check: ``intake-summary.md`` when Python and intake verifier are available
- Package-only intake blocked evidence: ``intake-not-available.md`` when Python or the intake verifier is unavailable
- Delivery manifest copy: ``CHIPMATE_OFFLINE_DELIVERY_MANIFEST-$Version.json`` when present
- Runtime S1-S16 intake verifier available in kit: ``chipmate-feature-migration-runtime-smoke-intake-verify.py``
- Runtime evidence skeleton: ``runtime-evidence-skeleton/runtime-smoke.tsv`` when Python and bootstrap helper are available
- Evidence return template: ``chipmate-feature-migration-target-evidence-return-template.md``
- Evidence return pack helper available in kit: ``chipmate-feature-migration-target-evidence-return-pack.py``

This runner verifies delivery/package integrity only. It does not install VS Code, does not run S1-S16 runtime smoke, and does not prove ChipMate native QA/no-regression acceptance.
"@ | Set-Content -Encoding UTF8 -Path (Join-Path $EvidenceDir "summary.md")

Write-Host "${RunnerStatus}: wrote $(Join-Path $EvidenceDir "summary.md")"
