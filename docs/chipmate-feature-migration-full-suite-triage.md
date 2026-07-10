# ChipMate Feature Migration Full-Suite Failure Triage

This document triages the broad C1/C3 failures captured during M10 validation.
It does not convert failing full-suite runs into PASS. It exists so M11 can
separate migrated sidecar risk from pre-existing or unrelated full-suite risk.

Authoritative run:

- `docs/chipmate-feature-migration-validation-runs/20260708-080354/status.tsv`
- `docs/chipmate-feature-migration-validation-runs/20260708-080354/C1.log`
- `docs/chipmate-feature-migration-validation-runs/20260708-080354/C3.log`

Latest refresh:

- `docs/chipmate-feature-migration-validation-runs/20260708-131846-full-suite-refresh/status.tsv`
- `docs/chipmate-feature-migration-validation-runs/20260708-131846-full-suite-refresh/C1-opencode-bun-run-test.log`
- `docs/chipmate-feature-migration-validation-runs/20260708-131846-full-suite-refresh/C3-kilo-vscode-bun-run-test-unit.log`
- `docs/chipmate-feature-migration-validation-runs/20260708-131846-full-suite-refresh/C3b-agent-terminal-focused.log`

Latest refresh result:

- C1 `bun run test` did not reach a final suite summary; it hit the controlled `600s` timeout after reaching `460/461`. The visible failed clusters before timeout remained outside the migrated Word/Mermaid/artifact/source-backed sidecars: `server/workspace-proxy.test.ts`, `session/retry.test.ts`, `plugin/xai.test.ts`, `kilocode/session-prompt-queue.test.ts`, `tool/webfetch.test.ts`, and `skill/discovery.test.ts`.
- C3 `bun run test:unit` completed with `2780 pass`, `62 fail`, and `1 error` across `2842` tests. The failure clusters still center on qwen autocomplete diagnostics/context injection/cache/provider behavior, backend/session/worktree/provider mocks, code action provider expectations, legacy migration mocks, and one broad-suite `agent terminal service` failure.
- The migration-related Agent Terminal failure was isolated with a focused rerun, `bun test tests/unit/agent-terminal-runtime.test.ts tests/unit/agent-terminal-package-contribution.test.ts --timeout 60000`, which passed `6/6`. This supports treating the broad C3 Agent Terminal row as a broad-suite/mock-order risk, not as proof that the Agent Terminal sidecar is broken.
- The refresh does not convert C1 or C3 into PASS and does not close S1-S16 installed runtime acceptance.

## C1: opencode tool tests

Command:

```bash
cd /Users/archer/Work/kilocode/packages/opencode && bun run test
```

Result:

- Status: `FAIL`
- Summary: `461 files | 453 passed | 8 failed`

Migration-relevant tests that passed inside C1:

| Area | Evidence from C1 log | M11 interpretation |
|---|---|---|
| Artifact manager | `PASS kilocode/document-artifacts.test.ts` | Supports migrated artifact tool contract. |
| Mermaid document tools | `PASS kilocode/mermaid-documents.test.ts` | Supports migrated Mermaid validate/render/save/insert contract. |
| Source-backed detail-design skill fixture | `PASS kilocode/source-backed-detail-design-skill.test.ts` | Supports skill contract, not installed runtime quality. |
| Word document tools | `PASS kilocode/word-documents.test.ts` | Supports Word create/edit/template/diff/render warning contracts. |
| Kilo session LLM fixture under `kilocode/` | `PASS kilocode/session/llm.test.ts` | Supports migrated Kilo-specific LLM fixture coverage, but does not clear global `session/llm.test.ts` failures. |

Failed C1 areas:

| Failed area | Observed failure shape | Migration relation | M11 status |
|---|---|---|---|
| `kilocode/global-config-refresh.test.ts` | Timeout after `60000ms`. | Not directly caused by Word/Mermaid/artifact sidecars in the captured log. | Keep as full-suite blocker until separately rerun or accepted as known baseline. |
| `server/workspace-proxy.test.ts` | Expected `500`, received `503` for unreachable remote behavior. | Server/proxy behavior, not a migrated document sidecar path. | Keep as full-suite known issue. |
| `session/retry.test.ts` | Failed in full-suite run; details not classified from the current excerpt. | Session retry path, not enough evidence to clear. | Keep as full-suite blocker. |
| `plugin/xai.test.ts` | Multiple refresh/device-code tests hit `503` or captured header mismatches. | Provider/plugin auth surface, not migrated document sidecars. | Keep as full-suite known issue. |
| `kilocode/session-prompt-queue.test.ts` | Multiple prompt queue tests timed out after `60000ms`. | Kilo session queue behavior; not enough evidence to clear. | Keep as full-suite blocker. |
| `tool/webfetch.test.ts` | Local image/text fetch cases returned `503` instead of expected content/format errors. | Existing webfetch/tool behavior, not migrated document sidecars. | Keep as full-suite known issue. |
| `skill/discovery.test.ts` | Cloudflare/reference download expectations received empty or missing files. | Skill discovery/download surface, not source-backed local skill contract itself. | Keep as full-suite known issue. |
| `session/llm.test.ts` | One stream test timed out; one ECONNRESET conversion expectation failed. | Core LLM/session behavior, not enough evidence to clear. | Keep as full-suite blocker. |

M11 conclusion for C1:

- C1 cannot be marked PASS.
- C1 does not currently prove that the migrated Word/Mermaid/artifact/source-backed sidecars broke the opencode tool suite, because the migrated sidecar tests passed in the same run.
- The latest C1 refresh strengthens the known-risk classification: broad suite execution can now timeout before final summary, so C1 is not a reliable green gate until the non-sidecar slow/failing clusters are fixed or explicitly accepted.
- C1 still blocks a broad "full-suite green" release claim.

## C3: VS Code extension unit tests

Command:

```bash
cd /Users/archer/Work/kilocode/packages/kilo-vscode && bun run test:unit
```

Result:

- Status: `FAIL`
- Summary: `2782 pass`, `58 fail`, `2840 tests across 227 files`

Failure clusters observed in C3:

| Cluster | Examples from C3 log | Migration relation | M11 status |
|---|---|---|---|
| Webview font-size architecture | `font-size-arch.test.ts` flagged raw pixel font sizes in `document-artifacts.css` and `prompt-input.css`. | Partly migration-related for `document-artifacts.css`; later targeted font-size architecture evidence is recorded separately, so this early full-suite row remains historical but not enough for final sign-off by itself. | Keep C3 FAIL; rely on later targeted pass only for the scoped font-size fix. |
| Qwen autocomplete diagnostics and context injection | `qwen-autocomplete-diagnostics`, `recently-edited`, `import-definitions`, `snippets`, cache integration, provider rendering, root path, multiline classifier. | Existing autocomplete pipeline surface. It matters for Kilo no-regression, but is not caused by Word/Mermaid/document sidecars in the captured evidence. | Keep K7 open until full suite rerun or S16 installed autocomplete smoke passes. |
| Backend/session/worktree/provider mocks | `KiloProvider.handleLoadMessages`, pending session refresh, `KiloConnectionService backend crash`, `WorktreeManager.resolveStartPoint`, `nativeTitle`. | Existing Kilo provider/session/worktree behavior. | Keep as broad unit-suite known issue. |
| Code action provider | `KiloCodeActionProvider` Add/Explain/Improve/Fix action expectations. | Existing VS Code command/action behavior. | Keep as broad unit-suite known issue. |
| Autocomplete model selector | Expected grouped model catalog differed from current selector output. | Existing autocomplete UI/model catalog behavior. | Keep K7 open. |
| Legacy migration | `legacy-migration/migrate.test.ts` failed because `vscode.Uri.joinPath` is undefined in the unit mock. | Legacy migration/mock compatibility, not migrated document sidecars. | Keep as broad unit-suite known issue. |

M11 conclusion for C3:

- C3 cannot be marked PASS.
- C3 does not currently prove that Word/Mermaid/artifact/source-backed migration broke Kilo QA.
- The latest C3 refresh still blocks a broad unit-suite green claim. Focused Agent Terminal isolation passed after the broad C3 failure, and focused qwen-direct smoke remains the scoped evidence for autocomplete preservation.
- C3 does keep autocomplete preservation and broad VS Code unit health in a non-final state until a full rerun passes or the remaining failures are separately accepted.

## Release-signoff impact

| Requirement | Current triage result |
|---|---|
| Claim full opencode suite green | Not allowed. C1 remains `FAIL`. |
| Claim full VS Code unit suite green | Not allowed. C3 remains `FAIL`. |
| Claim migrated document sidecars have targeted automated coverage | Allowed with scope. C1/T1/T3/T5 support the targeted sidecar tests, but installed runtime smoke is still required. |
| Claim Kilo native QA no-regression | Not allowed yet. S1-S3 are still blocked by provider auth. |
| Claim Kilo autocomplete no-regression | Not allowed yet. C3 has autocomplete failures and S16 has not run. |
| Claim offline Windows/Linux VSIX packaging exists | Allowed with scope. Packaging, checksum, installability, extension-host contribution, and handoff verifiers are recorded separately. |

## Next actions

- Keep K6 and K7 open until full-suite failures are rerun, fixed, or explicitly accepted as known release limits.
- Do not use targeted sidecar test PASS rows to claim full-suite health.
- Use S1-S3 and S16 installed runtime smoke as the stronger no-regression evidence once a working chat/autocomplete provider is available.
