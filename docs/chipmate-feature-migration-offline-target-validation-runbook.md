# ChipMate Offline Target Validation Runbook

This runbook is for validating the ChipMate `0.0.38` offline release on the
actual target machines:

- Windows x86-64 offline target
- Linux x86-64 offline target

It is not a replacement for the project-side M10/M11 evidence. It describes how
to generate target-machine evidence after transferring the release bundle.

## Inputs to transfer

Preferred transfer pair:

| File | Purpose |
|---|---|
| `chipmate-0.0.38-offline-handoff.tar.gz` | Bundle containing Linux and Windows VSIX files plus release metadata. |
| `chipmate-0.0.38-offline-handoff.tar.gz.sha256` | Bundle checksum sidecar. |

Expected bundle SHA256:

```text
97a70108ae648a1998168d679c3c65638ea7756926860fad113cd06c31d2dba5
```

Expected bundle size:

```text
317784738 bytes / 303.06 MiB
```

## Step 1: verify the transferred bundle

Linux:

```bash
sha256sum -c chipmate-0.0.38-offline-handoff.tar.gz.sha256
```

macOS or other Unix shell with `shasum`:

```bash
shasum -a 256 -c chipmate-0.0.38-offline-handoff.tar.gz.sha256
```

Windows PowerShell:

```powershell
$expected = "97a70108ae648a1998168d679c3c65638ea7756926860fad113cd06c31d2dba5"
$actual = (Get-FileHash .\chipmate-0.0.38-offline-handoff.tar.gz -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "bundle sha256 mismatch: $actual" }
```

Expected result:

- Status: `PASS`
- Evidence to capture: command output and target machine name/profile.

## Step 2: extract the bundle

Linux:

```bash
mkdir -p chipmate-0.0.38-offline
tar -xzf chipmate-0.0.38-offline-handoff.tar.gz -C chipmate-0.0.38-offline
cd chipmate-0.0.38-offline
```

Windows PowerShell:

```powershell
mkdir chipmate-0.0.38-offline
tar -xzf .\chipmate-0.0.38-offline-handoff.tar.gz -C .\chipmate-0.0.38-offline
cd .\chipmate-0.0.38-offline
```

Expected extracted files:

```text
kilo-vscode-linux-x64-baseline.vsix
kilo-vscode-win32-x64-baseline.vsix
SHA256SUMS-chipmate-0.0.38-offline.txt
OFFLINE_RELEASE_NOTES-chipmate-0.0.38.md
OFFLINE_RELEASE_INDEX-chipmate-0.0.38.json
OFFLINE_RELEASE_INDEX-chipmate-0.0.38.md
```

Expected result:

- No `._*`, `.DS_Store`, or `__MACOSX` files.
- Evidence to capture: directory listing after extraction.

## Step 3: verify target VSIX checksums

Linux:

```bash
sha256sum -c SHA256SUMS-chipmate-0.0.38-offline.txt
```

macOS or other Unix shell with `shasum`:

```bash
shasum -a 256 -c SHA256SUMS-chipmate-0.0.38-offline.txt
```

Windows PowerShell:

```powershell
$expectedWin = "3c6b9943ecf8259379c6f75b1ff321bb83677c092aac3974584524fcd90e489d"
$actualWin = (Get-FileHash .\kilo-vscode-win32-x64-baseline.vsix -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualWin -ne $expectedWin) { throw "win32 VSIX sha256 mismatch: $actualWin" }
```

Expected VSIX hashes:

| Target | File | SHA256 |
|---|---|---|
| Linux x86-64 | `kilo-vscode-linux-x64-baseline.vsix` | `95218162b0d0a09c6425c80a10e9745569c1b021edd9d666a5f43278d31458ad` |
| Windows x86-64 | `kilo-vscode-win32-x64-baseline.vsix` | `3c6b9943ecf8259379c6f75b1ff321bb83677c092aac3974584524fcd90e489d` |

## Step 4: install the target VSIX

Linux target:

```bash
code --install-extension ./kilo-vscode-linux-x64-baseline.vsix --force
```

Windows target:

```powershell
code --install-extension .\kilo-vscode-win32-x64-baseline.vsix --force
```

Expected result:

- VS Code reports installed extension `chipmate.chipmate`.
- Extension version is `0.0.38`.
- Do not uninstall the previous extension first unless explicitly required by
  the target environment policy.

Evidence to capture:

```text
code --list-extensions --show-versions | findstr chipmate
```

or on Linux:

```bash
code --list-extensions --show-versions | grep -i chipmate
```

## Step 5: record package identity in VS Code

Open VS Code on a representative workspace and confirm:

| Check | Expected |
|---|---|
| Extension ID | `chipmate.chipmate` |
| Version | `0.0.38` |
| Display name | ChipMate |
| Sidebar contribution | Existing Kilo/ChipMate sidebar appears. |
| Native Kilo commands | Existing Kilo commands remain visible in Command Palette. |
| Document sidecar commands | Document artifact commands appear, but do not trigger during ordinary QA unless requested. |
| Agent Terminal | Default-off unless explicitly enabled. |
| Qwen autocomplete settings | Existing qwen-direct settings remain present. |

## Optional Word render target configuration

Word render does not bundle LibreOffice, Chromium, or Poppler renderer binaries
into the VSIX. On target machines, S10 can pass in either of these ways:

- Remote renderer: set `KILO_WORD_RENDER_ENDPOINT` or pass an explicit
  `remoteEndpoint` to `render_word_document`.
- Local external renderer: set `KILO_WORD_RENDER_SOFFICE` to an existing
  `soffice` executable and `KILO_WORD_RENDER_PDFTOPPM` to an existing
  `pdftoppm` executable, or make both available on `PATH`.
- Warning-only boundary: if no renderer is available, the expected output is a
  warning diagnostics artifact such as `word-render-endpoint-not-configured`;
  do not mark PDF/page PNG generation itself as `PASS`.

Linux example:

```bash
export KILO_WORD_RENDER_SOFFICE=/path/to/soffice
export KILO_WORD_RENDER_PDFTOPPM=/path/to/pdftoppm
```

Windows PowerShell example:

```powershell
$env:KILO_WORD_RENDER_SOFFICE = "C:\Program Files\LibreOffice\program\soffice.exe"
$env:KILO_WORD_RENDER_PDFTOPPM = "C:\path\to\pdftoppm.exe"
```

## Step 6: runtime smoke matrix S1-S16

Use a representative embedded C workspace and an existing document/RAG workspace
when available. Record actual tool sequence, visible behavior, and artifact
paths. If the chat provider is not usable, mark QA rows as `BLOCKED_AUTH`, not
`PASS` and not product regression.

For pure target-machine installed VSIX validation, S16 source files normally do
not exist and the source guard is not required. For any S16 smoke performed in a
source checkout, first run `docs/chipmate-feature-migration-s16-source-guard.sh`
and pass its summary to `chipmate-feature-migration-runtime-smoke-intake-verify.py`
with `--require-s16-source-guard`; a `NEEDS_REVIEW` guard means S16 must remain
unaccepted.

| ID | Area | Prompt or action | Expected behavior | Status |
|---|---|---|---|---|
| S1 | Native C QA | Ask for a C function call chain. | Uses Kilo native code understanding; no Word/Mermaid/artifact tools. | TODO |
| S2 | Macro/register QA | Ask where a macro is defined and used. | Uses native code/search tools only. | TODO |
| S3 | Document RAG | Ask about an indexed existing document. | Uses `document_search`; no Word generation. | TODO |
| S4 | Artifact | Generate and list a report artifact. | `.kilo/artifacts/.../artifact.json` exists and opens. | TODO |
| S5 | Word create | Generate a module interface design Word. | `.docx` artifact exists. | TODO |
| S6 | Word edit | Add an error-code table. | New `.docx` artifact and source backup exist. | TODO |
| S7 | Word delete | Delete a chapter dry-run first. | Impact is reported without writing until explicit apply. | TODO |
| S8 | Word template | Apply a real company template. | Style inheritance result and warnings recorded. | TODO |
| S9 | Word merge/diff | Merge or compare docs. | Bounded summary and artifact paths returned. | TODO |
| S10 | Word render | Render docx to PDF/page PNG. | PDF/page PNG artifact when remote or local external renderer is configured; otherwise warning diagnostics artifact. | TODO |
| S11 | Mermaid | Generate state-machine Mermaid PNG. | `.mmd`, `.png`, diagnostics artifact. | TODO |
| S12 | Mermaid + Word | Insert Mermaid PNG into Word. | New Word artifact with figure. | TODO |
| S13 | Source-backed detail design | Run on one internal embedded C module. | Evidence, diagrams, Word output, quality report. | TODO |
| S14 | Agent Terminal open | Open Agent Terminal. | Disabled prompt appears; terminal opens after workspace enable. | TODO |
| S15 | Agent Terminal danger | Plan/delete temporary artifacts. | Dangerous command requires explicit confirmation. | TODO |
| S16 | Autocomplete | Enable qwen-direct and trigger inline completion. | Provider still registers; diagnostics commands exist. | TODO |

## Status rules

Use these status values in captured evidence:

| Status | Meaning |
|---|---|
| PASS | Requirement was executed and matched expected behavior. |
| FAIL | Requirement was executed and contradicted expected behavior. |
| BLOCKED_AUTH | Chat/autocomplete provider auth or availability prevented execution. |
| BLOCKED_ENV | Target machine, VS Code, workspace, required sample file, or required optional renderer dependency was unavailable. |
| PARTIAL | Tool-level or command-level evidence exists, but installed runtime prompt was not fully exercised. |
| PASS_WITH_LIMITS | Requirement passed only inside a scoped boundary that must be documented. |

## Evidence bundle to return from target machine

Collect these files or screenshots after target validation:

| Evidence | Notes |
|---|---|
| Bundle checksum command output | Proves transfer integrity. |
| VSIX checksum command output | Proves target artifact integrity. |
| VSIX CLI marker boundary output | Proves migrated skill markers are present and old ChipMate document-contract repair markers are absent. |
| VS Code extension list output | Proves installed extension ID and version. |
| VS Code screenshots or logs | Useful for sidebar/command/Agent Terminal behavior. |
| `.kilo/artifacts` output paths | Required for artifact, Word, Mermaid, and detail-design checks. |
| Provider/auth error logs | Required when status is `BLOCKED_AUTH`. |
| Completed S1-S16 table | Required before M11 can claim installed runtime no-regression. |

To make returned evidence transferable and auditable, package the final evidence
directory with the return-pack helper:

Linux:

```bash
python3 chipmate-feature-migration-target-evidence-return-pack.py \
  --target linux-x64 \
  --evidence-dir <target-package-evidence-dir> \
  --output-dir returned-evidence
```

Windows:

```powershell
python .\chipmate-feature-migration-target-evidence-return-pack.py `
  --target win32-x64 `
  --evidence-dir <target-package-evidence-dir> `
  --output-dir returned-evidence
```

The helper writes `.tar.gz`, `.zip`, manifest, and checksum files. It preserves
`BLOCKED_AUTH`, `BLOCKED_ENV`, `PARTIAL`, and `FAIL` status signals in the
manifest; packaging evidence for transfer is not runtime acceptance.

Before using a returned archive for workstation-side intake or M11 review,
verify the returned archive on the migration workstation:

```bash
python3 docs/chipmate-feature-migration-target-evidence-return-pack.py \
  --verify-pack <returned-evidence.tar.gz-or.zip> \
  --checksum-file <returned-evidence-SHA256SUMS.txt> \
  --output-summary <returned-evidence-verify-summary.md>
```

This verification checks the returned archive checksum, manifest JSON, archive
member safety, exact evidence file list, and evidence file size/SHA256. It still
does not execute S1-S16 or decide M11 acceptance; it only proves the returned
evidence package is intact enough to hand to the intake verifiers.

## Optional runtime evidence bootstrap helper

The sidecar target verify kit includes
`chipmate-feature-migration-target-runtime-evidence-bootstrap.py`. Use it to
create a machine-readable S1-S16 evidence skeleton before filling real target
results:

Linux:

```bash
python3 chipmate-feature-migration-target-runtime-evidence-bootstrap.py \
  --target linux-x64 \
  --output-dir target-runtime-evidence
```

Windows:

```powershell
python .\chipmate-feature-migration-target-runtime-evidence-bootstrap.py `
  --target win32-x64 `
  --output-dir target-runtime-evidence
```

The generated `runtime-smoke.tsv` defaults every case to `NOT_RUN`, and the
generated return template defaults `Overall target status` to `PARTIAL`. This is
intentional: the bootstrap output is not acceptance evidence until target
operators replace placeholders with real results, rerun
`chipmate-feature-migration-runtime-smoke-intake-verify.py`, and then rerun
`chipmate-feature-migration-target-evidence-intake-verify.py`.

The Linux and Windows target package runners also invoke this bootstrap helper
automatically when Python and the helper are available. In that case the package
evidence directory contains `runtime-evidence-skeleton/runtime-smoke.tsv`.
Treat that generated skeleton as a starting point only; its default status
remains incomplete until real target-machine S1-S16 results are filled.

## M11 boundary

This runbook can prove target-machine package installability and installed
runtime behavior only after it is executed on the target machines. Preparing the
runbook is not enough to mark M11 complete.

Do not claim final no-regression for Kilo QA, Document RAG, autocomplete, or
installed source-backed detail design until S1-S16 are either PASS or explicitly
accepted as scoped release limits by the release owner.

## Automated package integrity verifier scripts

Use these scripts before manual VS Code install/runtime smoke on the offline target machines:

- Linux x86-64: `bash docs/chipmate-feature-migration-offline-target-verify-linux.sh <chipmate-0.0.38-offline-handoff.tar.gz> <evidence-dir>`
- Windows x86-64 PowerShell: `powershell -ExecutionPolicy Bypass -File docs/chipmate-feature-migration-offline-target-verify-windows.ps1 -BundlePath <chipmate-0.0.38-offline-handoff.tar.gz> -EvidenceDir <evidence-dir>`

The scripts verify bundle SHA256, bundle size, exact tarball contents, absence of macOS metadata, target VSIX SHA256 values, release/checksum metadata, and the VSIX CLI marker boundary. They write a `summary.md` file that can be returned as target-machine evidence.

The marker-boundary check requires these migrated markers in the target CLI binaries:

- `source-backed-detail-design`
- `generic Word/Mermaid/artifact guidance`
- `not a migrated Word/document contract`

It also fails if these old ChipMate document-contract repair markers appear:

- `validate_artifacts`
- `nextToolContract`
- `missingDeliverable`
- `missing-required-artifact`
- `missing-mermaid-pngs`
- `先渲染缺失图表`
- `缺失文档合同规划`

These scripts are package-integrity checks only. Passing them does not replace installed VS Code smoke S1-S16, provider/auth preflight, native QA preservation checks, Document RAG checks, autocomplete checks, Agent Terminal checks, Word/Mermaid artifact checks, or source-backed detailed-design runtime validation.

Word validation scope after the latest migration boundary update: verify generic `.docx` create/inspect/edit/template-style/merge/diff/render tools only. Do not treat ChipMate Word/document runtime contracts, required-artifact validators, recipe repair loops, or skill contract gates as migrated target behavior.

## Sidecar target verify kit

If the target machine does not have the full repository checkout, transfer this sidecar kit together with the main handoff bundle:

- Main bundle: `chipmate-0.0.38-offline-handoff.tar.gz`
- Main bundle SHA256: `97a70108ae648a1998168d679c3c65638ea7756926860fad113cd06c31d2dba5`
- Target verify kit: `chipmate-0.0.38-offline-target-verify-kit.tar.gz`
- Target verify kit SHA256: verify with `chipmate-0.0.38-offline-target-verify-kit.tar.gz.sha256` or `CHIPMATE_OFFLINE_DELIVERY_MANIFEST-0.0.38.md`

Extract the kit first, then run the Linux or Windows verifier script from the extracted kit directory against the main handoff bundle. The kit is intentionally separate from the main handoff bundle so the main bundle checksum remains stable and verifier scripts do not create a self-referential checksum problem.

## Delivery manifest entry point

When the release folder includes `CHIPMATE_OFFLINE_DELIVERY_MANIFEST-0.0.38.md` or `CHIPMATE_OFFLINE_DELIVERY_MANIFEST-0.0.38.json`, use that manifest as the first transfer checklist. It lists the main handoff bundle, checksum sidecars, target verify kit, and delivery checksum file. The delivery manifest is metadata only; the target verifier kit and installed runtime smoke remain the authoritative package-integrity and behavior checks.

## Target evidence intake self-check

The sidecar target verify kit also includes `chipmate-feature-migration-target-evidence-intake-verify.py` and `chipmate-feature-migration-runtime-smoke-intake-verify.py`. Use them before returning target-machine evidence to the migration workstation.

The source-workstation helper `docs/chipmate-feature-migration-document-rag-readiness-smoke.sh` is intentionally not part of the standalone target verify kit because it depends on the source checkout and `packages/opencode` runtime. On offline target machines, record S3 `document_search` tool-sequence evidence from the installed runtime; if Document RAG cannot initialize, return the provider/indexing readiness logs as `BLOCKED_ENV` or `BLOCKED_AUTH` evidence instead of treating S3 as PASS.

Package-only evidence self-check:

```bash
python3 chipmate-feature-migration-target-evidence-intake-verify.py \
  --target linux-x64 \
  --package-evidence <package-evidence-dir> \
  --output <evidence-dir>/intake-summary.md \
  --allow-package-only
```

Windows package-only evidence self-check:

```powershell
python .\chipmate-feature-migration-target-evidence-intake-verify.py `
  --target win32-x64 `
  --package-evidence <package-evidence-dir> `
  --output <evidence-dir>\intake-summary.md `
  --allow-package-only
```

Full package plus runtime evidence self-check:

```bash
python3 chipmate-feature-migration-target-evidence-intake-verify.py \
  --target linux-x64 \
  --package-evidence <package-evidence-dir> \
  --runtime-evidence <runtime-s1-s16-evidence-dir> \
  --output <evidence-dir>/intake-summary.md
```

The intake verifier requires package evidence to include the VSIX CLI marker-boundary result. It rejects package evidence that only contains hashes but omits the marker-boundary output.

Package-only `PASS` is still package-only progress. It is not final M11 acceptance. Final M11 still requires real installed runtime S1-S16 evidence, internal embedded C source-backed detail-design validation, and no-regression review.

Runtime S1-S16 evidence shape self-check:

```bash
python3 chipmate-feature-migration-runtime-smoke-intake-verify.py \
  --runtime-evidence <runtime-s1-s16-evidence-dir> \
  --output <evidence-dir>/runtime-intake-summary.md
```

This runtime intake verifier accepts only explicit reviewed `PASS` for every requested S-id. It rejects `NEEDS_REVIEW`, `BLOCKED_AUTH`, `TIMEOUT`, `ERROR_NEEDS_REVIEW`, `FAIL`, `PENDING`, `PARTIAL`, and missing S-ids. Passing this verifier still does not replace manual M11 review; it only prevents incomplete runtime evidence from being returned as final.

## Returned evidence intake check

After an offline target machine returns its evidence directory or archive, first
verify any returned tar/zip package with `chipmate-feature-migration-target-evidence-return-pack.py --verify-pack`.
Then run the local intake verifier before M11 sign-off:

```bash
python3 docs/chipmate-feature-migration-target-evidence-intake-verify.py \
  --target linux-x64 \
  --package-evidence <returned-package-evidence-dir> \
  --runtime-evidence <returned-runtime-s1-s16-evidence-dir> \
  --output <intake-summary.md>
```

For Windows target evidence, use `--target win32-x64`. If only package-integrity evidence has been returned, the verifier should report `PARTIAL_PACKAGE_ONLY`; that is acceptable as package-transfer evidence but is not acceptable as final installed runtime evidence.

If runtime evidence is returned separately, also run:

```bash
python3 docs/chipmate-feature-migration-runtime-smoke-intake-verify.py \
  --runtime-evidence <returned-runtime-s1-s16-evidence-dir> \
  --output <runtime-intake-summary.md>
```

The final M11 review should treat any runtime intake status other than `PASS` as incomplete.

## Standard evidence return template

The sidecar target verify kit includes `chipmate-feature-migration-target-evidence-return-template.md`. Fill this template on each offline Windows/Linux target before returning evidence. The template is designed to keep package-integrity evidence, VSIX install evidence, S1-S16 runtime smoke, blocking status, native Kilo no-regression observations, and returned file inventory in one consistent shape.

A filled template with package-integrity PASS but missing S1-S16 runtime evidence should still be treated as partial evidence, not final acceptance.

## Manifest checksum sidecar

When `SHA256SUMS-chipmate-0.0.38-offline-delivery-manifest.txt` is present, verify it before trusting the JSON/Markdown delivery manifest:

```bash
shasum -a 256 -c SHA256SUMS-chipmate-0.0.38-offline-delivery-manifest.txt
```

This sidecar validates the delivery manifest files only. It is intentionally separate from the manifest files themselves to avoid checksum recursion.

## Cross-platform Python package verifier

The sidecar target verify kit also includes `chipmate-feature-migration-offline-target-verify.py`. Use it when bash or PowerShell is unavailable or unreliable on the target machine:

```bash
python3 chipmate-feature-migration-offline-target-verify.py chipmate-0.0.38-offline-handoff.tar.gz evidence-python
```

The Python verifier uses only the Python standard library. Passing it proves package-transfer integrity only and does not replace installed runtime smoke S1-S16.

## Delivery-set verifier

The sidecar target verify kit includes `chipmate-feature-migration-offline-delivery-set-verify.py`. After extracting the kit, use it as the first one-command verification for the release folder:

```bash
python3 chipmate-feature-migration-offline-delivery-set-verify.py <delivery-dir> --output evidence-delivery-set.md
```

This checks the delivery manifest JSON/Markdown checksum sidecar, delivery checksum list, main handoff bundle SHA/size, target verify kit SHA/size, and expected helper files inside the target verify kit. Passing it proves delivery metadata and package-transfer integrity only. It does not install the VSIX and does not replace runtime smoke S1-S16.

## Optional one-file delivery-set package

If the release is transferred as `chipmate-0.0.38-offline-delivery-set.tar.gz`, verify its sidecar first, extract it, then run the inner delivery-set verifier:

```bash
shasum -a 256 -c chipmate-0.0.38-offline-delivery-set.tar.gz.sha256
tar -xzf chipmate-0.0.38-offline-delivery-set.tar.gz
cd chipmate-0.0.38-offline-delivery-set
tar -xzf chipmate-0.0.38-offline-target-verify-kit.tar.gz
python3 chipmate-0.0.38-offline-target-verify-kit/chipmate-feature-migration-offline-delivery-set-verify.py . --output evidence-delivery-set.md
```

This outer package is only a transport container. After it passes, continue with package verifier execution, VSIX install, S1-S16 runtime smoke, evidence return template, and local intake verification.

## Target package evidence runners

The sidecar target verify kit includes package-evidence runners that collect the delivery-set and bundle verifier outputs into one evidence directory.

Linux:

```bash
bash chipmate-0.0.38-offline-target-verify-kit/chipmate-feature-migration-offline-target-run-linux.sh . evidence-linux-package
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\chipmate-0.0.38-offline-target-verify-kit\chipmate-feature-migration-offline-target-run-windows.ps1 -DeliveryDir . -EvidenceDir evidence-windows-package
```

Runner output status `PASS_PACKAGE_ONLY` means package-transfer integrity evidence exists. It is not final acceptance. Continue with VSIX install, S1-S16 runtime smoke, the filled evidence return template, and local intake verification.

## Optional Windows-friendly delivery-set zip

If the release is transferred as `chipmate-0.0.38-offline-delivery-set.zip`, verify its sidecar first, extract it, then run the inner delivery-set verifier or target package runner:

```powershell
Get-FileHash -Algorithm SHA256 .\chipmate-0.0.38-offline-delivery-set.zip
Expand-Archive -Force .\chipmate-0.0.38-offline-delivery-set.zip .
cd .\chipmate-0.0.38-offline-delivery-set
powershell -ExecutionPolicy Bypass -File .\chipmate-0.0.38-offline-target-verify-kit\chipmate-feature-migration-offline-target-run-windows.ps1 -DeliveryDir . -EvidenceDir evidence-windows-package
```

The zip is only a transport container. After it passes package evidence collection, continue with VSIX install, S1-S16 runtime smoke, the filled evidence return template, and local intake verification.

## Windows cmd runner shortcut

The sidecar target verify kit includes `chipmate-feature-migration-offline-target-run-windows.cmd` as a convenience wrapper around the PowerShell runner. From a Windows cmd prompt inside the delivery directory:

```bat
chipmate-0.0.38-offline-target-verify-kit\chipmate-feature-migration-offline-target-run-windows.cmd . evidence-windows-package
```

This shortcut produces package evidence only. It does not install VS Code, does not run S1-S16 runtime smoke, and does not replace the filled evidence return template or local intake verification.
