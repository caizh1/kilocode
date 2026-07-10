#!/usr/bin/env python3
"""Generate the remaining-blocker unblock packet.

The packet is a handoff aid only. It records owner-facing commands, required
inputs, return evidence, and acceptance gates for the currently open migration
blockers. It intentionally does not run validation, change source files,
install VSIX files, or add any ChipMate contract/repair/gating runtime.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = (
    REPO_ROOT
    / "docs/chipmate-feature-migration-validation-runs"
    / "20260709-093000-remaining-blocker-unblock-packet"
    / "remaining-blocker-unblock-packet.md"
)


def rel(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT))


PACKET = """# Remaining Blocker Unblock Packet

- Status: `ACTIVE_BLOCKERS_REMAIN`
- Source matrix: `docs/chipmate-feature-migration-validation-runs/20260709-091000-remaining-blocker-owner-matrix/remaining-blocker-owner-matrix.md`
- Latest known completion audit before this packet: `docs/chipmate-feature-migration-validation-runs/20260709-145000-completion-audit-after-external-evidence-action-packet/completion-audit.md`
- Current external evidence action packet: `docs/chipmate-feature-migration-m11-external-evidence-action-packet.md`
- Current receive quickstart: `docs/chipmate-feature-migration-m11-returned-evidence-receive-quickstart.md`
- Preferred receive wrapper: `docs/chipmate-feature-migration-m11-returned-evidence-receive.py`
- Purpose: give each blocker owner an exact unblock path without changing Kilo native QA or reintroducing ChipMate contract/repair/gating flows.

## Boundary

- This packet is a handoff artifact only.
- It does not install, package, validate, or mutate runtime source.
- It does not migrate ChipMate QA, planner, question routing, CodeGraph UI, document runtime contract, required-artifact validator, recipe repair loop, skill contract gate, `nextToolContract`, `missingDeliverable`, `validate_artifacts`, missing-diagram auto-repair, or missing-document contract planning.
- It must not be treated as final M11 evidence. It only tells owners how to produce evidence that later gates can accept.

## Preferred returned-evidence workflow

Use this current action packet first:

```text
docs/chipmate-feature-migration-m11-external-evidence-action-packet.md
```

Generate a standard returned-evidence bundle skeleton:

```bash
python3 docs/chipmate-feature-migration-m11-returned-evidence-bundle-template.py \
  --output-dir /tmp/chipmate-m11-returned-evidence-bundle \
  --force
```

Each owner replaces only their placeholder summary with typed verifier output. Do not edit `PENDING` placeholders to `PASS` by hand.

After all returned evidence is filled, package and receive it through the fail-closed receive wrapper:

```bash
cd /tmp
tar -czf chipmate-m11-returned-evidence-bundle.tar.gz chipmate-m11-returned-evidence-bundle

python3 docs/chipmate-feature-migration-m11-returned-evidence-receive.py \
  --bundle /tmp/chipmate-m11-returned-evidence-bundle.tar.gz \
  --output-dir docs/chipmate-feature-migration-validation-runs/<stamp>-m11-returned-evidence-receive \
  --accept-s16-decision
```

The receive wrapper runs archive/structure verification before bundle intake. If the archive still contains placeholders, missing required summaries, unsafe archive paths, or macOS metadata, intake is not accepted. A receive `READY_FOR_M11_REVIEW` result is still not final signoff; M11 final review remains required.


## Owner action matrix

| Blocker | Owner | First action | Return evidence | Acceptance gate |
|---|---|---|---|---|
| S3 Document RAG | Provider/operator | Restore or replace the openai-compatible embedding upstream so readiness no longer returns HTTP 503. | New S3 readiness run directory with summary, provider diagnostics, and runtime log. | `document_search used: yes`, provider/readiness failure `no`, guardrails pass. |
| S16 autocomplete | User/product decision | Record `Decision: keep`, `Decision: revert`, or `Decision: split-review` for protected qwen autocomplete/package source changes. | Decision record plus read-only S16 source guard/smoke evidence. | Decision intake no longer reports `NEEDS_USER_DECISION`; source guard reaches accepted status before S16 acceptance. |
| Installed VSIX S1-S16 | Runtime operator | Run installed VSIX chat/runtime S1-S16 in the agreed VS Code profile/workspace with usable providers. | Runtime evidence directory plus runtime intake summary. | Runtime intake summary `PASS` for required S1-S16 and no old ChipMate contract/repair markers. |
| Offline Windows x86-64 target | Windows target owner | Run the generated Windows target execution request on the real offline Windows x86-64 target. | Returned target evidence pack and extracted evidence directory. | Return-pack verify passes; target intake final status `PASS`; runtime intake `PASS` where required. |
| Offline Linux x86-64 target | Linux target owner | Run the generated Linux target execution request on the real offline Linux x86-64 target. | Returned target evidence pack and extracted evidence directory. | Return-pack verify passes; target intake final status `PASS`; runtime intake `PASS` where required. |
| Internal embedded-C detail design | Internal project owner | Run source-backed-detail-design skill through installed VSIX/chat on a representative internal embedded C module. | Source evidence, Markdown/design doc, diagrams, Word output, quality report, and artifact manifest. | Evidence shows Kilo native QA/document tools plus skill instructions, not ChipMate runtime contract or repair flow. |
| Real company `.docx` template | Document/template owner | Provide a representative company `.docx` or `.dotx` and run the template validator plus S8 Word template flow. | Template validation summary and S8 runtime/template evidence. | Validation `PASS`, or explicitly accepted `PASS_WITH_LIMITS` with documented style inheritance limits. |
| Visible Agent Terminal UX | VS Code UX/manual operator | Run visible installed VS Code checks for command-palette prompt, terminal pane opening, default-off behavior, and dangerous-command confirmation. | Screenshots/logs/manual evidence tied to installed VSIX profile. | M11 accepts visible UX evidence; local service/runtime rollup alone is not enough. |
| M11 final no-regression review | Release reviewer | After all upstream gates return acceptable evidence, rerun readiness, completion audit, current-state consistency, and final signoff intake. | Final review template, readiness summary, completion audit, consistency summary, final signoff summary. | Final signoff intake `READY_FOR_FINAL_SIGNOFF` and final review decision `PASS` or explicitly accepted `PASS_WITH_KNOWN_LIMITS`. |

## S3 Document RAG unblock

Run after the embedding/indexing provider is restored:

```bash
VALIDATION_RUN_DIR=docs/chipmate-feature-migration-validation-runs/<stamp>-document-rag-readiness \\
  bash docs/chipmate-feature-migration-document-rag-readiness-smoke.sh
```

Expected returned evidence:

- `document-rag-readiness-summary.md`
- `document-rag-provider-diagnostics.md`
- S3 runtime log from the same run directory

Acceptance:

- `document_search used: yes`
- `provider/readiness failure detected: no`
- Provider diagnostics do not classify the run as `server_or_upstream_unavailable`, HTTP `503`, or another failing provider state
- Guardrails pass without using Word/Mermaid/artifact repair as a substitute for native Document RAG

## S16 autocomplete unblock

Decision record template:

```md
# S16 decision record

- Decision: `keep|revert|split-review`
- Accepted by: `<name>`
- Date: `<YYYY-MM-DD>`
- Rationale: `<why this is safe for Kilo native autocomplete>`
- Protected files considered: `packages/kilo-vscode/src/services/qwen-autocomplete/smoke.ts`, `packages/kilo-vscode/src/services/qwen-autocomplete/index.ts`, `packages/kilo-vscode/package.json`
```

Intake command after the decision record exists:

```bash
python3 docs/chipmate-feature-migration-s16-decision-intake.py \\
  --decision-record <decision-record.md> \\
  --output docs/chipmate-feature-migration-validation-runs/<stamp>-s16-decision-intake/current-summary.md
```

After that, rerun read-only S16 guard/smoke only. Do not mutate the protected qwen autocomplete/package files from validation.

## Installed VSIX S1-S16 unblock

Operator request:

```text
docs/chipmate-feature-migration-validation-runs/20260709-063000-installed-runtime-smoke-request/installed-runtime-smoke-s1-s16-request.md
```

Intake command for returned evidence:

```bash
python3 docs/chipmate-feature-migration-runtime-smoke-intake-verify.py \\
  --runtime-evidence <returned-runtime-evidence-dir> \\
  --output <returned-runtime-evidence-dir>/runtime-intake-summary.md
```

Acceptance:

- Required S1-S16 statuses are explicit `PASS`
- S3 uses native `document_search`
- S4 uses `declare_artifact` only when artifact output is requested
- S14/S15 prove Agent Terminal remains default-off/additive and dangerous execution is confirmation-gated
- Old ChipMate contract/repair markers remain absent

## Offline Windows x86-64 target unblock

Target owner request:

```text
docs/chipmate-feature-migration-validation-runs/20260709-060000-target-execution-request-generator/win32-x64-target-execution-request.md
```

Workstation receiving sequence:

```bash
python3 docs/chipmate-feature-migration-target-evidence-return-pack.py \\
  --verify-pack <returned-win32-x64-evidence-pack.tar.gz-or.zip>

python3 docs/chipmate-feature-migration-target-evidence-intake-verify.py \\
  --target win32-x64 \\
  --package-evidence <returned-package-evidence-dir> \\
  --runtime-evidence <returned-runtime-evidence-dir> \\
  --output <returned-evidence-dir>/target-intake-summary.md
```

Acceptance:

- Return-pack verification passes
- Package evidence proves the expected Windows VSIX/runner surfaces
- Runtime intake passes when runtime evidence is required
- Target return template is filled and does not contradict intake results

## Offline Linux x86-64 target unblock

Target owner request:

```text
docs/chipmate-feature-migration-validation-runs/20260709-060000-target-execution-request-generator/linux-x64-target-execution-request.md
```

Workstation receiving sequence:

```bash
python3 docs/chipmate-feature-migration-target-evidence-return-pack.py \\
  --verify-pack <returned-linux-x64-evidence-pack.tar.gz-or.zip>

python3 docs/chipmate-feature-migration-target-evidence-intake-verify.py \\
  --target linux-x64 \\
  --package-evidence <returned-package-evidence-dir> \\
  --runtime-evidence <returned-runtime-evidence-dir> \\
  --output <returned-evidence-dir>/target-intake-summary.md
```

Acceptance:

- Return-pack verification passes
- Package evidence proves the expected Linux VSIX/runner surfaces
- Runtime intake passes when runtime evidence is required
- Target return template is filled and does not contradict intake results

## Internal embedded-C detail-design unblock

Project owner request:

```text
docs/chipmate-feature-migration-validation-runs/20260709-061500-internal-embedded-c-validation-request/internal-embedded-c-validation-request.md
```

Expected returned evidence:

- Source evidence bundle or source evidence summary
- Markdown detailed design
- Mermaid diagrams and rendered PNGs where requested
- Word `.docx` output
- Quality/review report
- Artifact manifest

Acceptance:

- The run uses Kilo native evidence tools and the migrated skill instructions
- It does not require ChipMate runtime flow, Word contract, skill contract gate, missing-deliverable repair, or missing-diagram auto-render
- The result is accepted by M11 review as representative internal embedded C evidence

## Real company `.docx` template unblock

Source-workstation validation command:

```bash
python3 docs/chipmate-feature-migration-company-docx-template-validate.py \\
  --template-docx <company-template.docx-or-dotx> \\
  --output-dir docs/chipmate-feature-migration-validation-runs/<stamp>-company-template
```

Acceptance:

- Template validator reports `PASS`, or M11 explicitly accepts `PASS_WITH_LIMITS`
- Style inheritance limitations are documented
- Installed/tool S8 template flow is rerun if the template exposes a new compatibility issue

## Visible Agent Terminal UX unblock

Required visible checks:

- Agent Terminal command appears only as an additive sidecar entry
- Default-off behavior is visible and understandable
- Opening the Agent Terminal creates a VS Code terminal pane rather than replacing Kilo native terminal/session behavior
- Dangerous command flow requires explicit confirmation and preserves an auditable log/artifact path

Acceptance:

- Evidence is tied to an installed VSIX profile/workspace
- M11 accepts the visible UX evidence in addition to the existing local rollup

## M11 final review unblock

Run after all upstream gates have acceptable evidence:

```bash
python3 docs/chipmate-feature-migration-m11-readiness-intake.py \\
  --output docs/chipmate-feature-migration-validation-runs/<stamp>-m11-readiness/summary.md

python3 docs/chipmate-feature-migration-completion-audit.py \\
  --output docs/chipmate-feature-migration-validation-runs/<stamp>-completion-audit/completion-audit.md

python3 docs/chipmate-feature-migration-current-state-consistency-check.py \\
  --output-dir docs/chipmate-feature-migration-validation-runs/<stamp>-current-state-consistency

python3 docs/chipmate-feature-migration-m11-final-signoff-intake.py \\
  --output docs/chipmate-feature-migration-validation-runs/<stamp>-m11-final-signoff/current-signoff-summary.md
```

Final acceptance:

- M11 readiness is `READY_FOR_M11_REVIEW`
- Completion audit reports zero real blockers and `Completion allowed: yes`
- Current-state consistency is `PASS`
- Final signoff intake is `READY_FOR_FINAL_SIGNOFF`
- Final review decision is `PASS` or explicitly accepted `PASS_WITH_KNOWN_LIMITS`
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    output = args.output
    if not output.is_absolute():
        output = REPO_ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)

    generated = datetime.now().isoformat(timespec="seconds")
    content = PACKET + f"\n\n## Generated\n\n- Generated at: `{generated}`\n- Generator: `{rel(Path(__file__).resolve())}`\n"
    output.write_text(content, encoding="utf-8")
    print(rel(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
