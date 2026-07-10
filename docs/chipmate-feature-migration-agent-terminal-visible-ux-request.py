#!/usr/bin/env python3
"""Generate the visible Agent Terminal UX validation request.

This helper creates an operator-facing request for the remaining visible UX
evidence. It does not launch VS Code, run commands, install extensions, mutate
settings, or validate runtime behavior by itself.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = (
    REPO_ROOT
    / "docs/chipmate-feature-migration-validation-runs"
    / "20260709-095000-agent-terminal-visible-ux-request"
    / "agent-terminal-visible-ux-request.md"
)


REQUEST = """# Agent Terminal Visible UX Validation Request

- Purpose: capture installed VS Code visible UX evidence for Agent Terminal.
- Scope: S14/S15 visible UX only.
- Current local rollup: `docs/chipmate-feature-migration-validation-runs/20260709-080000-agent-terminal-acceptance-rollup/summary.md`

## Boundary

- Agent Terminal must remain an additive sidecar.
- Agent Terminal must remain default-off unless the operator explicitly enables it for the workspace.
- Kilo native terminal/session behavior must not be replaced.
- Dangerous command execution must require explicit confirmation.
- This request must not introduce ChipMate QA, planner, question routing, document runtime contract, required-artifact validator, recipe repair loop, skill contract gate, missing-diagram auto-render, missing-document contract planning, `nextToolContract`, `missingDeliverable`, or `validate_artifacts`.

## Required environment

- Installed VSIX: current ChipMate/Kilo offline package under test.
- VS Code profile/workspace: the same profile/workspace used for installed runtime S1-S16 where possible.
- Provider state: not required for the visible terminal-pane checks unless the operator also captures chat-triggered Agent Terminal flow.

## Required visible checks

1. Confirm the Agent Terminal command is present as an additive command-palette entry.
2. Confirm Agent Terminal is default-off and shows a clear disabled/enable prompt before use.
3. Enable Agent Terminal only for the validation workspace.
4. Confirm opening Agent Terminal creates a VS Code terminal pane.
5. Confirm native Kilo terminal/session behavior still exists and is not replaced by Agent Terminal.
6. Trigger or simulate a dangerous command request and confirm explicit confirmation is required.
7. Confirm no destructive command executes without confirmation.
8. Confirm an audit log, terminal transcript, or artifact path is recorded.

## Evidence file template

Create `agent-terminal-visible-ux-evidence.md` in the returned evidence directory:

```md
# Agent Terminal Visible UX Evidence

- Installed VSIX profile: `<profile name/path>`
- VSIX version: `<version>`
- Workspace: `<workspace path/name>`
- Evidence date: `<YYYY-MM-DD>`
- Operator: `<name>`

## Required statuses

- Agent Terminal command visible: PASS
- Default-off prompt visible: PASS
- Workspace enable flow explicit: PASS
- Terminal pane opens after enable: PASS
- Native Kilo terminal unaffected: PASS
- Dangerous command confirmation visible: PASS
- No destructive command executed without confirmation: PASS
- Audit log or artifact path recorded: PASS
- Old ChipMate contract markers absent: PASS

## Attached evidence

- Screenshot command palette: `screenshots/<file>`
- Screenshot default-off prompt: `screenshots/<file>`
- Screenshot terminal pane: `screenshots/<file>`
- Screenshot dangerous confirmation: `screenshots/<file>`
- Log or transcript: `logs/<file>`

## Notes

- Any limitation or mismatch:
```

Return at least two attached files under `screenshots/` or `logs/` so the intake helper can reject empty PASS-only templates.

## Workstation intake command

```bash
python3 docs/chipmate-feature-migration-agent-terminal-visible-ux-intake.py \\
  --evidence-dir <returned-agent-terminal-visible-ux-evidence-dir> \\
  --output <returned-agent-terminal-visible-ux-evidence-dir>/agent-terminal-visible-ux-intake-summary.md
```

Acceptance requires the intake summary to report `PASS`. If it reports `PARTIAL_NEEDS_REVIEW`, keep visible Agent Terminal UX open for M11.
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
    output.write_text(
        REQUEST
        + f"\n\n## Generated\n\n- Generated at: `{generated}`\n- Generator: `docs/chipmate-feature-migration-agent-terminal-visible-ux-request.py`\n",
        encoding="utf-8",
    )
    print(str(output.relative_to(REPO_ROOT)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
