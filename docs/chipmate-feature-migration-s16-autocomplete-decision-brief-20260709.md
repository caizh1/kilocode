# S16 Qwen Autocomplete Decision Brief

Status: `NEEDS_USER_DECISION`

This brief is read-only. It does not keep, revert, stage, commit, or otherwise modify the protected autocomplete/package files. It exists to make the S16 decision explicit before any future autocomplete acceptance run.

## Current protected file snapshot

| File | Size | SHA256 |
|---|---:|---|
| `packages/kilo-vscode/src/services/qwen-autocomplete/smoke.ts` | `2973` | `e88d13e24bbc5b74261fe5b89b3dee9d41a511f4e55361d13296804f33e19376` |
| `packages/kilo-vscode/src/services/qwen-autocomplete/index.ts` | `3300` | `888b5f9dc92f1ee9abb24f023d999bb4b394986f7d5ef2148199fc1d7b4d5e35` |
| `packages/kilo-vscode/package.json` | `49636` | `416f7c9ba72ca9f1a9aa46ec931d2d1b2da1fb280cd570e22b4a07c79b35a672` |

## Why S16 is still blocked

Authoritative guard evidence: `docs/chipmate-feature-migration-validation-runs/20260709-004500-s16-source-guard/summary.md`

The guard reports:

- Status: `NEEDS_REVIEW`
- Mutating tool evidence: `yes`
- Protected path reference evidence: `yes`
- Source modification marker evidence: `yes`

Manual review evidence: `docs/chipmate-feature-migration-validation-runs/20260708-213907-runtime-s13-s16-after-current-auth/manual-review.md`

Manual review records S16 as `BLOCKED` because the runtime agent modified source files instead of acting as a read-only autocomplete smoke.

## Decision options

| Option | Meaning | Required follow-up before S16 can be accepted |
|---|---|---|
| Keep current changes | Treat the protected-file changes as intentional qwen autocomplete work. | Review the exact source changes outside this brief, run focused autocomplete tests/build as needed, then rerun a read-only installed S16 smoke with source guard passing or explicitly approved. |
| Revert protected changes | Restore the protected files to the intended baseline. | Requires explicit user approval before any revert. After revert, rerun focused autocomplete tests/build and read-only S16 smoke. |
| Split into separate review | Keep migration acceptance blocked while reviewing autocomplete changes as a separate work item. | Record ownership/status separately; S16 remains blocked for this migration until the separate review resolves and a read-only smoke passes. |

## Acceptance rule

S16 must not be marked PASS from the existing `20260708-213907-runtime-s13-s16-after-current-auth` run. Future S16 acceptance requires evidence that is read-only with respect to the protected autocomplete/package files, plus an explicit decision on the current protected-file state.

## Boundary

This brief does not inspect git history, does not decide whether the source changes are good or bad, and does not modify any source file. It only preserves the current decision state and the evidence needed to unblock a user decision.
