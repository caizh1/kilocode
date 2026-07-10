# ChipMate Offline Windows/Linux Release Sign-off

This sign-off covers the current offline transfer artifacts for ChipMate
`0.0.38`. It proves package handoff integrity only. It does not prove installed
chat/runtime S1-S16, provider availability, target OS execution, or internal
embedded C detail-design runtime quality.

## Transfer recommendation

Preferred transfer pair:

| File | Purpose | Status |
|---|---|---|
| `packages/kilo-vscode/out/chipmate-0.0.38-offline-handoff.tar.gz` | Single offline bundle containing both target VSIX files and release metadata. | PASS |
| `packages/kilo-vscode/out/chipmate-0.0.38-offline-handoff.tar.gz.sha256` | Checksum sidecar for the transfer bundle. | PASS |

Bundle SHA256:

```text
97a70108ae648a1998168d679c3c65638ea7756926860fad113cd06c31d2dba5
```

Bundle size:

```text
317784738 bytes / 303.06 MiB
```

## Bundle contents

The clean rebuilt bundle contains exactly these files:

| File | Purpose |
|---|---|
| `kilo-vscode-linux-x64-baseline.vsix` | Offline Linux x86-64 target VSIX. |
| `kilo-vscode-win32-x64-baseline.vsix` | Offline Windows x86-64 target VSIX. |
| `SHA256SUMS-chipmate-0.0.38-offline.txt` | Checksums for the two VSIX files. |
| `OFFLINE_RELEASE_NOTES-chipmate-0.0.38.md` | Release notes and install caveats. |
| `OFFLINE_RELEASE_INDEX-chipmate-0.0.38.json` | Machine-readable target artifact index. |
| `OFFLINE_RELEASE_INDEX-chipmate-0.0.38.md` | Human-readable target artifact index. |

The external bundle index files are kept beside the bundle and are not embedded
inside it:

- `packages/kilo-vscode/out/OFFLINE_BUNDLE_INDEX-chipmate-0.0.38.json`
- `packages/kilo-vscode/out/OFFLINE_BUNDLE_INDEX-chipmate-0.0.38.md`

## Verification evidence

| Check | Evidence | Status |
|---|---|---|
| Rebuild after source-backed contract-boundary cleanup | `docs/chipmate-feature-migration-validation-runs/20260708-114840-vsix-repackage-contract-boundary/summary.md` | PASS_WITH_LIMITS |
| VSIX checksum file validates both target VSIX files | `docs/chipmate-feature-migration-validation-runs/20260708-114900-offline-handoff-verify-after-repackage/summary.md` | PASS |
| Release index JSON validates target file sizes and SHA256 values | `docs/chipmate-feature-migration-validation-runs/20260708-114900-offline-handoff-verify-after-repackage/summary.md` | PASS |
| Bundle index JSON validates bundle size and SHA256 | `docs/chipmate-feature-migration-validation-runs/20260708-114900-offline-handoff-verify-after-repackage/summary.md` | PASS |
| Bundle checksum sidecar matches bundle SHA256 | `docs/chipmate-feature-migration-validation-runs/20260708-114900-offline-handoff-verify-after-repackage/summary.md` | PASS |
| Tarball contents match the bundle index content list | `docs/chipmate-feature-migration-validation-runs/20260708-114900-offline-handoff-verify-after-repackage/summary.md` | PASS |
| Tarball is clean of macOS AppleDouble `._*` files | `docs/chipmate-feature-migration-validation-runs/20260708-114900-offline-handoff-verify-after-repackage/summary.md` | PASS |
| Target VSIX package identity, contents, and contract-marker boundary verified | `docs/chipmate-feature-migration-validation-runs/20260708-122200-vsix-target-verify-with-contract-markers/summary.md` | PASS |
| Target-machine validation runbook prepared | `docs/chipmate-feature-migration-offline-target-validation-runbook.md` | PASS_WITH_LIMITS |
| Target-machine verifier scripts prepared | Linux local `docs/chipmate-feature-migration-validation-runs/20260708-114910-offline-target-linux-local-after-repackage/summary.md`; Python local `docs/chipmate-feature-migration-validation-runs/20260708-114920-offline-target-python-local-after-repackage/summary.md`; delivery-set local `docs/chipmate-feature-migration-validation-runs/20260708-114930-offline-delivery-set-local-after-repackage/summary.md` | PASS_WITH_LIMITS |
| Sidecar target verify kit prepared | `packages/kilo-vscode/out/chipmate-0.0.38-offline-target-verify-kit.tar.gz`; SHA256 `803c6a22129cc7fcbe9b9912a43a9ebab741a5b8502e26d6d3d0c9cb741f5471`; size `32344` bytes; includes runtime S1-S16 intake verifier, runner-generated runtime evidence skeleton support, target evidence intake verifier, target evidence return pack helper, optional Word renderer environment capture guardrails, and a filled return-template PASS guard; source-checkout-only S3 readiness helper is intentionally not packaged | PASS_WITH_LIMITS |
| Offline delivery manifest prepared | `packages/kilo-vscode/out/CHIPMATE_OFFLINE_DELIVERY_MANIFEST-0.0.38.md`, `packages/kilo-vscode/out/CHIPMATE_OFFLINE_DELIVERY_MANIFEST-0.0.38.json`, `packages/kilo-vscode/out/SHA256SUMS-chipmate-0.0.38-offline-delivery.txt`; verify evidence `docs/chipmate-feature-migration-validation-runs/20260709-021500-target-kit-manifest-return-verifier-refresh/summary.md` | PASS_WITH_LIMITS |
| Offline delivery manifest checksum sidecar prepared | `packages/kilo-vscode/out/SHA256SUMS-chipmate-0.0.38-offline-delivery-manifest.txt`; verify evidence `docs/chipmate-feature-migration-validation-runs/20260708-114930-offline-delivery-set-local-after-repackage/summary.md` | PASS_WITH_LIMITS |
| Optional outer delivery-set package prepared | `packages/kilo-vscode/out/chipmate-0.0.38-offline-delivery-set.tar.gz`; SHA256 `83c8c27dbe058bd0d2bd5fe63f7bb17259c5dea1943ba18a81e83c142c736954`; size `317916299` bytes; extracted verify evidence `docs/chipmate-feature-migration-validation-runs/20260709-021500-target-kit-manifest-return-verifier-refresh/tar-extracted-delivery-set-summary.md` | PASS_WITH_LIMITS |
| Optional Windows-friendly outer delivery-set zip prepared | `packages/kilo-vscode/out/chipmate-0.0.38-offline-delivery-set.zip`; SHA256 `d4014986abf84d5d3b4207996427f0bc655e473f9a36a9846790cbbc7b08cbb4`; size `317917776` bytes; extracted verify evidence `docs/chipmate-feature-migration-validation-runs/20260709-021500-target-kit-manifest-return-verifier-refresh/zip-extracted-delivery-set-summary.md` | PASS_WITH_LIMITS |
| Target-side verifier CLI marker boundary, runtime intake verifier with S16 source-checkout guard support, runner-generated runtime evidence skeleton, return-pack helper, optional Word renderer guardrails, and return-template PASS guard included in delivery kit | `docs/chipmate-feature-migration-validation-runs/20260709-021500-target-kit-manifest-return-verifier-refresh/summary.md`; target kit SHA256 `803c6a22129cc7fcbe9b9912a43a9ebab741a5b8502e26d6d3d0c9cb741f5471`; delivery-set verifier PASS and extracted tar/zip verifiers PASS; source-checkout-only S3 helper is excluded from the standalone kit by content guardrail. | PASS_WITH_LIMITS |
| Target evidence intake requires filled return template PASS | `docs/chipmate-feature-migration-validation-runs/20260708-162000-target-intake-requires-return-template/summary.md`; local and extracted-kit checks accept full package+runtime+template `PASS` and reject missing/unfilled target evidence return templates. | PASS_WITH_LIMITS |
| Target runtime evidence bootstrap helper included | `docs/chipmate-feature-migration-validation-runs/20260708-164500-target-runtime-evidence-bootstrap/summary.md` and `docs/chipmate-feature-migration-validation-runs/20260708-165200-target-runtime-bootstrap-kit-refresh/summary.md`; default NOT_RUN/PARTIAL skeletons are rejected, fixture PASS skeletons pass verifier intake, and the sidecar kit manifest records `containsTargetRuntimeEvidenceBootstrap=true`. | PASS_WITH_LIMITS |
| Target package runners generate runtime evidence skeleton | `docs/chipmate-feature-migration-validation-runs/20260708-171000-target-runner-runtime-bootstrap-local/summary.md` and `docs/chipmate-feature-migration-validation-runs/20260708-172000-target-runner-runtime-bootstrap-manifest-guard/summary.md`; Linux runner and extracted-kit runner generate `runtime-evidence-skeleton/runtime-smoke.tsv`, default runtime intake remains `PARTIAL`, and manifest guard `targetPackageRunnersGenerateRuntimeEvidenceSkeleton=true` is verifier-enforced. | PASS_WITH_LIMITS |
| Target evidence return pack helper and verifier included | `docs/chipmate-feature-migration-validation-runs/20260709-042000-target-evidence-return-pack-verify/summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-043000-target-evidence-return-pack-verify-kit-refresh/summary.md`; returned evidence helper emits manifest/tar/zip/checksum files, preserves non-PASS status signals for M11 review, and can verify returned tar/zip archive integrity before workstation-side intake. | PASS_WITH_LIMITS |
| Installed VSIX host smoke on current rebuilt packages | Linux `docs/chipmate-feature-migration-validation-runs/20260708-115010-installed-linux-vsix-host-smoke-after-repackage/summary.md` PASS; Windows rerun `docs/chipmate-feature-migration-validation-runs/20260708-115040-installed-win32-vsix-host-smoke-after-repackage-rerun/summary.md` PASS. The earlier parallel Windows attempt `docs/chipmate-feature-migration-validation-runs/20260708-115020-installed-win32-vsix-host-smoke-after-repackage/summary.md` failed from temp-dir `ENOTEMPTY` collision and is superseded by the serial rerun. | PASS_WITH_LIMITS |
| Target runbook/template marker-boundary evidence refreshed | `docs/chipmate-feature-migration-validation-runs/20260708-124500-target-runbook-template-marker-boundary-refresh/summary.md`; runbook/template now require VSIX CLI marker-boundary evidence and avoid target kit SHA self-reference. | PASS_WITH_LIMITS |
| Target evidence return template prepared | `docs/chipmate-feature-migration-target-evidence-return-template.md`; included in rebuilt sidecar target verify kit and now requires `runtime-intake-summary.md` when S1-S16 runtime smoke is attempted; source-checkout S16 evidence must include a passing source guard | PASS_WITH_LIMITS |
| Linux target runner python boundary | `docs/chipmate-feature-migration-validation-runs/20260708-134020-linux-runner-python-boundary/summary.md`; no-python target package run now returns BLOCKED_ENV evidence instead of failing mid-run. | PASS_WITH_LIMITS |
| Target package runners auto-run package-only intake verifier | `docs/chipmate-feature-migration-validation-runs/20260708-133010-target-runner-auto-intake/summary.md`; package-only runner evidence now includes intake-summary with marker-boundary check. | PASS_WITH_LIMITS |
| Windows target runner intake blocked-env boundary | `docs/chipmate-feature-migration-validation-runs/20260708-045533-windows-runner-intake-boundary-refresh/summary.md`; latest target kit SHA256 `803c6a22129cc7fcbe9b9912a43a9ebab741a5b8502e26d6d3d0c9cb741f5471` from `docs/chipmate-feature-migration-validation-runs/20260709-021500-target-kit-manifest-return-verifier-refresh/summary.md` | PASS_WITH_LIMITS |
| Target runbook documents intake self-check commands | `docs/chipmate-feature-migration-validation-runs/20260708-132120-target-runbook-intake-command-delivery-refresh/summary.md`; runbook now explains package-only and full-runtime intake verifier commands. | PASS_WITH_LIMITS |
| Target verify kit includes evidence intake verifier | `docs/chipmate-feature-migration-validation-runs/20260708-131020-target-kit-includes-intake-verifier/summary.md`; extracted sidecar kit includes and runs package/runtime evidence intake guardrail. | PASS_WITH_LIMITS |
| Target evidence intake marker-boundary full-pass self-test | `docs/chipmate-feature-migration-validation-runs/20260708-130010-target-intake-marker-synthetic-full-pass/summary.md`; synthetic marker-boundary package evidence plus S1-S16 PASS runtime evidence returns final `PASS`. | PASS_WITH_LIMITS |
| Target evidence intake marker-boundary guard | `docs/chipmate-feature-migration-validation-runs/20260708-125130-target-intake-marker-boundary-guard/summary.md`; package-only intake now rejects evidence that has hashes but lacks VSIX CLI marker-boundary output. | PASS_WITH_LIMITS |
| Target evidence intake verifier prepared | `docs/chipmate-feature-migration-target-evidence-intake-verify.py`; package-only smoke remains package-only evidence | PASS_WITH_LIMITS |

## Sidecar target verify kit

Use this kit when the offline Windows/Linux target machine does not have the full repository checkout:

| Artifact | Size | SHA256 |
|---|---:|---|
| `packages/kilo-vscode/out/chipmate-0.0.38-offline-target-verify-kit.tar.gz` | `32344` | `803c6a22129cc7fcbe9b9912a43a9ebab741a5b8502e26d6d3d0c9cb741f5471` |

The kit contains the Linux verifier, Windows verifier, cross-platform Python verifier,
delivery-set verifier, package evidence runners, target validation runbook, Windows cmd
wrapper, target evidence intake verifier, target evidence return pack helper/verifier, runtime smoke intake verifier, target runtime evidence
bootstrap helper, runner-generated runtime skeleton support, and target evidence return template with a filled-template PASS guard. It is intentionally separate from the main handoff bundle so
the main bundle checksum remains stable and verifier scripts do not create a checksum
self-reference.

## Target artifacts

| Target | VSIX | Size | SHA256 |
|---|---|---:|---|
| Linux x86-64 | `kilo-vscode-linux-x64-baseline.vsix` | `151641659` bytes / `144.62 MiB` | `95218162b0d0a09c6425c80a10e9745569c1b021edd9d666a5f43278d31458ad` |
| Windows x86-64 | `kilo-vscode-win32-x64-baseline.vsix` | `168397172` bytes / `160.60 MiB` | `3c6b9943ecf8259379c6f75b1ff321bb83677c092aac3974584524fcd90e489d` |

## Install commands after transfer

Linux target:

```bash
code --install-extension kilo-vscode-linux-x64-baseline.vsix --force
```

Windows target:

```powershell
code --install-extension .\kilo-vscode-win32-x64-baseline.vsix --force
```

## Caveats before final product sign-off

| Caveat | Status |
|---|---|
| Full installed chat/runtime smoke S1-S16 is not complete. | OPEN |
| Full internal embedded C source-backed detailed-design runtime validation is not complete. | OPEN |
| Real company `.docx` template validation is not complete. | OPEN |
| Word/document contract migration is intentionally out of scope; target validation must confirm generic Word tools do not steer ordinary Kilo QA. | OPEN |
| Current local chat runtime smoke is blocked by provider auth availability. | BLOCKED_AUTH |
| Target Windows and target Linux OS execution of the rebuilt package remains pending. | OPEN |

## M11 interpretation

- Offline package handoff integrity can be treated as `PASS_WITH_LIMITS`.
- Do not treat this document as no-regression proof for Kilo QA, Document RAG,
  autocomplete, or installed chat/runtime behavior.
- Final M11 still requires S1-S16 and internal embedded C runtime validation, or
  an explicit release decision that accepts those known limits.
