# ChipMate Feature Migration Runtime Unblock Runbook

This runbook is for finishing M10/M11 after a working chat provider, internal embedded C workspace, and representative company `.docx` template are available.

It does not replace the migration plan. Do not mark M10/M11 complete from this runbook alone; use the generated validation evidence plus manual review.

## Preconditions

- [ ] A working chat provider/model is available.
- [ ] Do not write provider keys into tracked files.
- [ ] Internal embedded C workspace is available for S1, S2, and S13.
- [ ] Representative indexed document or project document is available for S3.
- [ ] Representative company `.docx` template is available for S8/S9.
- [ ] Current Linux and Windows x86-64 VSIX artifacts are present under `packages/chipmate-vscode/out`.
- [ ] Offline handoff verification passes before transferring packages.

## Provider preflight

Use one-shot environment variables when possible so global config does not need to be edited.

```bash
cd /Users/archer/Work/chipmate

export CHIPMATE_SMOKE_PROVIDER_BASE_URL='<openai-compatible-base-url>'
export CHIPMATE_SMOKE_PROVIDER_API_KEY='<api-key>'
export CHIPMATE_SMOKE_PROVIDER_MODEL='<model-id>'

VALIDATION_RUN_DIR="docs/chipmate-feature-migration-validation-runs/$(date +%Y%m%d-%H%M%S)-runtime-preflight" \
CHIPMATE_SMOKE_TIMEOUT=120 \
docs/chipmate-feature-migration-runtime-smoke.sh --preflight
```

Pass condition:

- [ ] Summary status is not `BLOCKED_AUTH`.
- [ ] Summary status is not `TIMEOUT`.
- [ ] If status is `NEEDS_REVIEW`, inspect the log and confirm the model actually answered.

## Native QA and Document RAG smoke

Before running the full S1-S3 batch, run the S3 Document RAG readiness helper
against the same representative document workspace. This checks that
`indexing.documents` is enabled, the document path is configured, the embedding
provider is usable, and `document_search` is actually exposed to runtime.

```bash
cd /Users/archer/Work/chipmate

VALIDATION_RUN_DIR="docs/chipmate-feature-migration-validation-runs/$(date +%Y%m%d-%H%M%S)-document-rag-readiness" \
CHIPMATE_DOCUMENT_RAG_SMOKE_SOURCE='/path/to/representative/document.md' \
CHIPMATE_SMOKE_TIMEOUT=180 \
docs/chipmate-feature-migration-document-rag-readiness-smoke.sh
```

Document RAG readiness pass condition:

- [ ] `document-rag-readiness-summary.md` reports `document_search used: yes`.
- [ ] `provider/readiness failure detected: no`.
- [ ] `s3-guard.txt` reports `guardrails passed`.
- [ ] If `document_search unavailable because Document RAG indexing provider/readiness failed` appears, fix embedding/indexing provider configuration before rerunning S3.

```bash
cd /Users/archer/Work/chipmate

VALIDATION_RUN_DIR="docs/chipmate-feature-migration-validation-runs/$(date +%Y%m%d-%H%M%S)-runtime-s1-s3" \
CHIPMATE_SMOKE_QA_WORKSPACE='/path/to/internal/embedded-c-workspace' \
CHIPMATE_SMOKE_DOC_WORKSPACE='/path/to/document-rag-workspace' \
CHIPMATE_SMOKE_TIMEOUT=180 \
docs/chipmate-feature-migration-runtime-smoke.sh --run-qa
```

Manual review gates:

- [ ] S1 uses native code understanding/search evidence and does not create Word/Mermaid/artifact deliverables.
- [ ] S2 uses native code/search evidence and does not create Word/Mermaid/artifact deliverables.
- [ ] S3 uses existing document QA/RAG behavior and does not generate Word.

## Full S1-S16 runtime smoke

```bash
cd /Users/archer/Work/chipmate

VALIDATION_RUN_DIR="docs/chipmate-feature-migration-validation-runs/$(date +%Y%m%d-%H%M%S)-runtime-s1-s16" \
CHIPMATE_SMOKE_QA_WORKSPACE='/path/to/internal/embedded-c-workspace' \
CHIPMATE_SMOKE_DOC_WORKSPACE='/path/to/document-rag-or-artifact-workspace' \
CHIPMATE_SMOKE_TEMPLATE_DOCX='/path/to/company-template.docx' \
CHIPMATE_SMOKE_TIMEOUT=300 \
docs/chipmate-feature-migration-runtime-smoke.sh --run-all
```

Manual review gates:

- [ ] S4 creates `.chipmate/artifacts/.../artifact.json`.
- [ ] S5 creates a `.docx` artifact.
- [ ] S6 creates a new `.docx` without overwriting the original.
- [ ] S7 performs dry-run only.
- [ ] S8/S9 record real template/style behavior and warnings.
- [ ] S10 records merge/diff or render diagnostics.
- [ ] S11 creates Mermaid source/PNG artifacts, or records renderer warning if renderer is unavailable.
- [ ] S12 inserts Mermaid PNG into Word when prerequisites exist.
- [ ] S13 runs source-backed detailed-design flow on internal embedded C source evidence.
- [ ] S14 opens Agent Terminal only after expected enablement flow.
- [ ] S15 requires explicit confirmation for dangerous delete-style commands.
- [ ] S16 confirms qwen-direct autocomplete diagnostics/provider registration.

After manual review, run the runtime intake verifier against the evidence
directory. It must not report `PARTIAL_NEEDS_REVIEW`, `BLOCKED_AUTH`,
`TIMEOUT`, `FAIL`, or missing S-ids before any S1-S16 checklist item is marked
complete.

```bash
python3 docs/chipmate-feature-migration-runtime-smoke-intake-verify.py \
  --runtime-evidence docs/chipmate-feature-migration-validation-runs/<runtime-s1-s16-run> \
  --output docs/chipmate-feature-migration-validation-runs/<runtime-s1-s16-run>/runtime-intake-summary.md
```

Pass condition:

- [ ] Final status is `PASS`.
- [ ] Every requested S-id is present.
- [ ] Every requested S-id has explicit reviewed `PASS`.
- [ ] No `NEEDS_REVIEW`, `BLOCKED_AUTH`, `TIMEOUT`, `ERROR_NEEDS_REVIEW`, `FAIL`, `PENDING`, or `PARTIAL` status remains.

## Installed VSIX extension-host and command smoke

Run both target VSIX files through the installed extension-host smoke helper.

```bash
cd /Users/archer/Work/chipmate

VALIDATION_RUN_DIR="docs/chipmate-feature-migration-validation-runs/$(date +%Y%m%d-%H%M%S)-installed-linux-smoke" \
docs/chipmate-feature-migration-installed-vsix-host-smoke.sh \
  packages/chipmate-vscode/out/chipmate-vscode-linux-x64-baseline.vsix

VALIDATION_RUN_DIR="docs/chipmate-feature-migration-validation-runs/$(date +%Y%m%d-%H%M%S)-installed-win32-smoke" \
docs/chipmate-feature-migration-installed-vsix-host-smoke.sh \
  packages/chipmate-vscode/out/chipmate-vscode-win32-x64-baseline.vsix
```

Pass condition:

- [ ] Installed extension activates from isolated installed extensions dir.
- [ ] Native ChipMate commands remain registered.
- [ ] Document artifact commands remain registered.
- [ ] Agent Terminal profile/command remain registered.
- [ ] qwen autocomplete diagnostics/log commands remain registered.
- [ ] Safe command smoke passes.

## Offline package handoff verification

```bash
cd /Users/archer/Work/chipmate

VALIDATION_RUN_DIR="docs/chipmate-feature-migration-validation-runs/$(date +%Y%m%d-%H%M%S)-offline-handoff-final-verify" \
docs/chipmate-feature-migration-offline-handoff-verify.sh
```

Pass condition:

- [ ] Required handoff files exist.
- [ ] `SHA256SUMS` verifies Linux and Windows VSIX files.
- [ ] Content release index validates target file size/SHA256.
- [ ] External bundle index validates bundle size/SHA256.

## Evidence update rule

- [ ] Update `docs/chipmate-feature-migration-validation-evidence.md` with new run paths.
- [ ] Update `docs/chipmate-feature-migration-plan.md` checkboxes only after evidence proves the exact item.
- [ ] Leave `BLOCKED_AUTH`, `TIMEOUT`, and `ERROR_NEEDS_REVIEW` as blockers.
- [ ] Treat `NEEDS_REVIEW` as incomplete until logs and artifacts are inspected.
- [ ] Use `docs/chipmate-feature-migration-runtime-smoke-intake-verify.py` to reject incomplete S1-S16 evidence before claiming runtime acceptance.
- [ ] Do not mark M10/M11 complete until `docs/chipmate-feature-migration-completion-audit.py` reports completion allowed and the final no-regression review is manually accepted.
