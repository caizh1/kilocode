#!/usr/bin/env python3
"""Conservative intake for the package refresh boundary decision.

The current source-side evidence can be newer than the already-built offline
delivery artifacts. This helper requires an explicit final-delivery decision
instead of silently treating stale packages as current.
"""

from __future__ import annotations

import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BOUNDARY = (
    ROOT
    / "docs/chipmate-feature-migration-validation-runs/"
    "20260709-164000-package-refresh-boundary-check/summary.md"
)
DEFAULT_OUTPUT = (
    ROOT
    / "docs/chipmate-feature-migration-validation-runs/"
    "20260709-164500-package-refresh-decision-intake/summary.md"
)

ACCEPTED_DECISIONS = {
    "REGENERATE_OFFLINE_PACKAGES",
    "EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT",
}


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def read(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def parse_decision(text: str) -> tuple[str, str, str]:
    decision = "MISSING"
    accepted_by = "MISSING"
    accepted_date = "MISSING"
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("Decision:"):
            decision = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("Accepted by:"):
            accepted_by = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("Accepted date:"):
            accepted_date = stripped.split(":", 1)[1].strip()
    return decision, accepted_by, accepted_date


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--boundary", type=Path, default=DEFAULT_BOUNDARY)
    parser.add_argument("--decision", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    boundary_text = read(args.boundary)
    boundary_status = "MISSING"
    for line in boundary_text.splitlines():
        if line.startswith("- Status:"):
            boundary_status = line.split("`", 2)[1] if "`" in line else line.split(":", 1)[1].strip()
            break

    decision_text = read(args.decision) if args.decision else ""
    decision, accepted_by, accepted_date = parse_decision(decision_text)
    decision_ready = (
        decision in ACCEPTED_DECISIONS
        and accepted_by not in {"", "MISSING", "TODO", "<owner>"}
        and accepted_date not in {"", "MISSING", "TODO", "<YYYY-MM-DD>"}
    )
    boundary_requires_decision = boundary_status == "REFRESH_REQUIRED_FOR_FINAL_DELIVERY"
    ready = decision_ready if boundary_requires_decision else True
    status = "READY_FOR_PACKAGE_REFRESH_SCOPE" if ready else "NEEDS_PACKAGE_REFRESH_DECISION"

    lines: list[str] = []
    lines.append("# Package Refresh Decision Intake\n\n")
    lines.append(f"- Overall status: `{status}`\n")
    lines.append(f"- Boundary summary: `{rel(args.boundary)}`\n")
    lines.append(f"- Boundary status: `{boundary_status}`\n")
    lines.append(f"- Decision file: `{rel(args.decision) if args.decision else 'not provided'}`\n")
    lines.append(f"- Decision: `{decision}`\n")
    lines.append(f"- Accepted by: `{accepted_by}`\n")
    lines.append(f"- Accepted date: `{accepted_date}`\n")
    lines.append("- Accepted decisions: `REGENERATE_OFFLINE_PACKAGES`, `EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT`\n")
    lines.append("- This intake rebuilds packages: `no`\n")
    lines.append("- This intake closes M10 packaging acceptance: `no`\n")
    lines.append("- This intake closes M11 final signoff: `no`\n")
    lines.append("\n")
    lines.append("## Required decision\n\n")
    lines.append(
        "If package refresh boundary remains `REFRESH_REQUIRED_FOR_FINAL_DELIVERY`, final offline "
        "handoff must explicitly choose whether to regenerate offline packages so they contain the "
        "current source-side M11 evidence chain, or to keep those source-side evidence updates outside "
        "the packaged target kit and document that scope in release notes. The decision must include "
        "both an accepted owner and accepted date.\n\n"
    )
    lines.append("## Boundary\n\n")
    lines.append(
        "This helper is decision intake only. It does not package files, does not install VSIX files, "
        "does not run target OS evidence, does not execute S1-S16, and does not migrate ChipMate QA "
        "or contract/repair/gating behavior.\n"
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(lines), encoding="utf-8")
    print(f"Status: {status}")
    print(f"Summary: {rel(args.output)}")
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
