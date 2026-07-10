# ChipMate Feature Migration Post-validation Update Guide

This guide explains how to update `chipmate-feature-migration-plan.md` after real validation has been executed and reviewed.

Status: preparation only. No validation has been executed by this guide.

## Core Rule

Do not check a plan item merely because a script exists, a prompt exists, or a static review looks reasonable. Check a runtime item only after the corresponding command log, VSIX artifact, installed VS Code smoke result, or internal project artifact has been reviewed.

## Command Evidence to Plan Checklist Mapping

| Evidence | Required status | Plan items it may unlock | Notes |
|---|---|---|---|
| C1 `packages/opencode && bun run test` | `PASS` | M1-M7 automated test checklist items for artifact, Word, Mermaid, source-backed skill, and QA routing boundary | Review failures by test name before checking any subitem. |
| C2 `packages/opencode && bun run typecheck` | `PASS` | Tool-layer type-safety confidence for M1-M7 and M10 | Does not prove installed VS Code behavior. |
| C3 `packages/kilo-vscode && bun run test:unit` | `PASS` | M8 artifact UI tests, M9 Agent Terminal unit tests, autocomplete contribution smoke | Does not prove real installed profile behavior. |
| C4 `packages/kilo-vscode && bun run typecheck` | `PASS` | VS Code activation/type boundary confidence | Still requires installed smoke before M10/M11. |
| C5 `packages/kilo-vscode && bun run lint` | `PASS` | Extension/webview hygiene review | Does not prove runtime behavior. |
| C6 `packages/kilo-vscode && bun run package` | `PASS` | Local package/build readiness review | Still requires VSIX packaging if C7 is separate. |
| C7 `bun run package:internal-offline` | `PASS` | `打包 VSIX` and packaging evidence fields | Record VSIX path, version, and size before checking. |
| P1 `--inspect-vsix <path>` | `PASS` or reviewed `REVIEW` | Renderer dependency boundary and VSIX size review | `REVIEW` requires manual conclusion before checking packaging review items. `FAIL` blocks M10. |

## Installed Smoke to Plan Checklist Mapping

| Smoke | Required status | Plan items it may unlock | Notes |
|---|---|---|---|
| S1 Native C QA | `PASS` | QA regression call-chain acceptance item; Kilo code understanding preservation | Must confirm Word/Mermaid/artifact tools were not used. |
| S2 Macro/register QA | `PASS` | QA regression macro/register acceptance item | Must confirm no generated artifact was created for ordinary QA. |
| S3 Document RAG | `PASS` | Document RAG preservation review | Must use native `document_search` or equivalent installed behavior evidence. |
| S4 Artifact | `PASS` | Artifact acceptance item | Record `.kilo/artifacts/.../artifact.json`. |
| S5 Word create | `PASS` | Word create acceptance item | Record `.docx` and manifest paths. |
| S6 Word append/edit | `PASS` | Word add/edit acceptance items | Record source backup and new `.docx`. |
| S7 Word delete dry-run | `PASS` | Word delete dry-run acceptance item | Confirm no new file for dry-run until explicit apply. |
| S8 Word template | `PASS` or reviewed `SKIPPED` | Real `.docx` template validation | `SKIPPED` must be listed as known issue or explicit scope limit. |
| S9 Word merge/diff | `PASS` | Word merge and diff acceptance items | Record merged `.docx`, Markdown diff, JSON diff, and rel/image warnings. |
| S10 Word render | `PASS` or reviewed warning-only result | Word render acceptance item | If endpoint is absent, record endpoint warning artifact and accepted scope. |
| S11 Mermaid | `PASS` | Mermaid PNG acceptance item | Record `.mmd`, `.png`, diagnostics. |
| S12 Mermaid + Word | `PASS` | Mermaid insert into Word acceptance item | Record new Word artifact and manifest. |
| S13 Source-backed detail design | `PASS` | Internal embedded C detailed-design validation; real project M10 item | Record internal module, evidence refs, Markdown, diagrams, Word output, and quality report. |
| S14 Agent Terminal open | `PASS` | Agent Terminal open acceptance item | Confirm default-off prompt and native terminal/session manager still exists. |
| S15 Agent Terminal danger | `PASS` | Dangerous command confirmation acceptance item | Confirm no destructive command runs without explicit confirmation. |
| S16 Autocomplete | `PASS` | Autocomplete preservation review | Confirm qwen-direct provider remains available. |

## M10 Review Update Rules

Check M10 review items only after the following minimum evidence exists:

- `所有新增能力能按需触发`: S4-S15 are PASS or explicitly scoped with known issues.
- `所有非目标能力没有被误迁移`: static non-goal review plus S1-S3, S16, and Agent Terminal sidecar smoke are reviewed.
- `Kilo 原有 QA、terminal、autocomplete、Document RAG 没有明显退化`: S1-S3, S14, and S16 are PASS.
- `VSIX 体积和启动耗时没有明显异常`: C7 plus P1 plus installed startup observation are reviewed.

## M11 Final Review Update Rules

Before checking M11 final items:

- `chipmate-feature-migration-validation-evidence.md` must have no unreviewed TODO, FAIL, or REVIEW rows for required scope.
- `chipmate-feature-migration-final-review-template.md` must be filled in with concrete evidence, not TODO placeholders.
- Known issues must be listed with severity, user impact, and mitigation.
- The completion audit helper should report no blockers.
- The final answer must explicitly separate migrated capabilities, non-migrated capabilities, verified native Kilo capabilities, and residual risks.

## Known Issue Handling

- Any failed command or smoke must create or update a Known Issue row.
- Any skipped smoke must explain whether it is out of scope, environment blocked, or accepted as a limitation.
- Do not check a related plan item while its known issue remains blocking.
- `PASS_WITH_KNOWN_LIMITS` is acceptable only if the limitation is documented and does not violate the user's requested migration scope.

## Final Guardrail

If in doubt, leave the checkbox unchecked. The migration plan is intended to show actual evidence-backed completion, not optimistic progress.
