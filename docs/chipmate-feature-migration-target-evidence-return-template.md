# ChipMate Offline Target Evidence Return Template

Use this template for each offline target machine. Return the filled file together
with raw logs, screenshots if available, and verifier output directories.

This template is evidence capture only. It does not turn package-integrity
checks into installed runtime acceptance. Final acceptance still requires M11
review.

## Target summary

| Field | Value |
|---|---|
| Target platform | linux-x64 / win32-x64 |
| Machine owner | TODO |
| Machine hostname | TODO |
| OS version | TODO |
| CPU architecture | TODO |
| VS Code version | TODO |
| Verification date | TODO |
| Verifier kit file | chipmate-0.0.38-offline-target-verify-kit.tar.gz |
| Main handoff bundle file | chipmate-0.0.38-offline-handoff.tar.gz |

## Package-integrity result

| Check | Status | Evidence path | Notes |
|---|---|---|---|
| Delivery checksum file validated | TODO | TODO | PASS / FAIL / BLOCKED_ENV |
| Target verify kit extracted | TODO | TODO | PASS / FAIL / BLOCKED_ENV |
| Target verifier script ran | TODO | TODO | PASS / FAIL / BLOCKED_ENV |
| Main handoff bundle SHA256 matched | TODO | TODO | PASS / FAIL |
| Main handoff bundle size matched | TODO | TODO | PASS / FAIL |
| Tar contents matched expected six files | TODO | TODO | PASS / FAIL |
| No macOS metadata in tar contents | TODO | TODO | PASS / FAIL |
| Linux VSIX SHA256 matched | TODO | TODO | PASS / FAIL |
| Windows VSIX SHA256 matched | TODO | TODO | PASS / FAIL |
| VSIX CLI marker boundary matched | TODO | TODO | Required migrated skill markers present; old ChipMate contract markers absent |
| Runtime smoke intake verifier present | TODO | TODO | `chipmate-feature-migration-runtime-smoke-intake-verify.py` exists in target verify kit |

Required migrated CLI markers:

- `source-backed-detail-design`
- `generic Word/Mermaid/artifact guidance`
- `not a migrated Word/document contract`

Forbidden old ChipMate contract markers:

- `validate_artifacts`
- `nextToolContract`
- `missingDeliverable`
- `missing-required-artifact`
- `missing-mermaid-pngs`
- `先渲染缺失图表`
- `缺失文档合同规划`

## VSIX install result

| Check | Status | Evidence path | Notes |
|---|---|---|---|
| Correct target VSIX selected | TODO | TODO | PASS / FAIL |
| VSIX installed with force/upgrade path | TODO | TODO | PASS / FAIL / BLOCKED_ENV |
| Extension identity is chipmate.chipmate | TODO | TODO | PASS / FAIL |
| Extension version is 0.0.38 | TODO | TODO | PASS / FAIL |
| VS Code extension host activated | TODO | TODO | PASS / FAIL / BLOCKED_ENV |

## Runtime smoke S1-S16

Use exactly one of these status values: PASS, FAIL, BLOCKED_AUTH, BLOCKED_ENV,
PARTIAL, NOT_RUN.

| Case | Scope | Status | Evidence path | Notes |
|---|---|---|---|---|
| S1 | Native C QA call chain | TODO | TODO | Expected native ChipMate code understanding; no Word/Mermaid/artifact tools |
| S2 | Macro/register QA | TODO | TODO | Expected native search/code understanding tools |
| S3 | Document RAG QA | TODO | TODO | Expected document_search path |
| S4 | Artifact create/list | TODO | TODO | Expected artifact manifest and open/list behavior |
| S5 | Word create | TODO | TODO | Expected .docx artifact |
| S6 | Word edit/add table | TODO | TODO | Expected new .docx artifact and source backup |
| S7 | Word delete dry-run | TODO | TODO | Expected dry-run impact only before apply |
| S8 | Word template | TODO | TODO | Expected style inheritance or scoped warning |
| S9 | Word merge/diff | TODO | TODO | Expected bounded summary and artifact paths |
| S10 | Word render | TODO | TODO | Expected PDF/page PNG when remote renderer or external local soffice/pdftoppm is configured; otherwise warning diagnostics artifact |
| S11 | Mermaid PNG | TODO | TODO | Expected .mmd/.png/diagnostics artifact |
| S12 | Mermaid inserted into Word | TODO | TODO | Expected new Word artifact with figure |
| S13 | Source-backed detail design | TODO | TODO | Expected evidence, diagrams, Word output, quality report |
| S14 | Agent Terminal open | TODO | TODO | Expected default-off prompt or enabled terminal open |
| S15 | Agent Terminal dangerous command | TODO | TODO | Expected explicit confirmation requirement |
| S16 | Qwen direct autocomplete | TODO | TODO | Expected provider still registers and diagnostics/log command works |

After filling the S1-S16 table, run the runtime smoke intake verifier and
return its output. Do not mark overall runtime acceptance as PASS unless this
verifier also reports final status `PASS`.

If S16 evidence was generated from a source checkout instead of a target-machine
installed VSIX-only workspace, also run the S16 source guard on that source
checkout and pass its summary with `--require-s16-source-guard`. Target-machine
installed VSIX evidence without a source checkout does not need this flag.

```bash
python3 chipmate-feature-migration-runtime-smoke-intake-verify.py \
  --runtime-evidence <runtime-s1-s16-evidence-dir> \
  --output <evidence-dir>/runtime-intake-summary.md

# Source-checkout S16 evidence only:
python3 chipmate-feature-migration-runtime-smoke-intake-verify.py \
  --runtime-evidence <runtime-s1-s16-evidence-dir> \
  --s16-source-guard-summary <s16-source-guard-summary.md> \
  --require-s16-source-guard \
  --output <evidence-dir>/runtime-intake-summary.md
```

Windows:

```powershell
python .\chipmate-feature-migration-runtime-smoke-intake-verify.py `
  --runtime-evidence <runtime-s1-s16-evidence-dir> `
  --output <evidence-dir>\runtime-intake-summary.md

# Source-checkout S16 evidence only:
python .\chipmate-feature-migration-runtime-smoke-intake-verify.py `
  --runtime-evidence <runtime-s1-s16-evidence-dir> `
  --s16-source-guard-summary <s16-source-guard-summary.md> `
  --require-s16-source-guard `
  --output <evidence-dir>\runtime-intake-summary.md
```

| Runtime intake check | Status | Evidence path | Notes |
|---|---|---|---|
| Runtime smoke intake verifier ran | TODO | TODO | PASS / FAIL / BLOCKED_ENV |
| Runtime smoke intake final status is PASS | TODO | TODO | Required before S1-S16 can be accepted |
| No NEEDS_REVIEW/BLOCKED_AUTH/TIMEOUT/ERROR_NEEDS_REVIEW/PARTIAL/NOT_RUN remains | TODO | TODO | Required before M11 runtime acceptance |
| S16 source guard checked when source checkout evidence is used | TODO | TODO | Required for source-checkout S16 evidence; not required for target installed VSIX-only evidence |

## Blocking classification

Fill this section if any runtime case is not PASS.

| Blocking type | Applies? | Evidence path | Notes |
|---|---|---|---|
| BLOCKED_AUTH | TODO | TODO | Provider credential/API unavailable before answer generation |
| BLOCKED_ENV | TODO | TODO | Missing VS Code, shell, filesystem permission, sample file, optional renderer, or OS dependency |
| FAIL | TODO | TODO | Product behavior ran but produced incorrect result |
| PARTIAL | TODO | TODO | Some evidence exists but scope is incomplete |
| NOT_RUN | TODO | TODO | Case intentionally not run; explain why |

## Native ChipMate no-regression observations

| Capability | Status | Evidence path | Notes |
|---|---|---|---|
| Native code QA did not route through Word/Mermaid tools | TODO | TODO | Required for S1/S2 |
| Document RAG still uses native document_search | TODO | TODO | Required for S3 |
| Source-backed/Word delivery skills did not trigger old document-contract repair flow | TODO | TODO | Required marker-boundary and runtime observation |
| Autocomplete configuration/diagnostics still available | TODO | TODO | Required for S16 |
| S16 source-checkout evidence has passing source guard when applicable | TODO | TODO | Required before accepting local/source-checkout S16 runtime evidence |
| Native terminal/session behavior not broken | TODO | TODO | Required for M11 |
| Tool registry and activation commands still available | TODO | TODO | Required for M11 |
| Runtime smoke intake summary returned PASS | TODO | TODO | Required before accepting S1-S16 as complete |

## Returned evidence files

List every file returned to the migration workstation.

| File or directory | Description |
|---|---|
| TODO | TODO |
| runtime-intake-summary.md | Required runtime S1-S16 intake verifier output when runtime smoke was attempted |

## Target owner sign-off

| Field | Value |
|---|---|
| Prepared by | TODO |
| Date | TODO |
| Overall target status | PASS / PARTIAL / BLOCKED_AUTH / BLOCKED_ENV / FAIL |
| Notes | TODO |
