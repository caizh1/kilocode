#!/usr/bin/env python3
"""Conservative S16 autocomplete decision intake.

This helper is read-only. It does not modify protected autocomplete files and
does not run autocomplete smoke. It records whether S16 has an explicit product
decision and whether the source guard is clean enough to proceed to a future
read-only autocomplete validation run.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


DEFAULT_SOURCE_GUARD = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-004500-s16-source-guard/"
    "summary.md"
)
DEFAULT_DECISION_BRIEF = Path("docs/chipmate-feature-migration-s16-autocomplete-decision-brief-20260709.md")

VALID_DECISIONS = {"keep", "revert", "split-review"}


def read_text(path: Path | None) -> str:
    if path is None or not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def markdown_value(text: str, label: str) -> str | None:
    match = re.search(rf"(?im)^\s*[-*]?\s*{re.escape(label)}\s*:\s*`?([^`\n]+?)`?\s*$", text)
    if match:
        return match.group(1).strip()
    match = re.search(rf"(?im)^\|\s*{re.escape(label)}\s*\|\s*`?([^|`]+?)`?\s*\|", text)
    if match:
        return match.group(1).strip()
    return None


def decision_from_record(path: Path | None) -> str | None:
    text = read_text(path)
    if not text:
        return None
    value = markdown_value(text, "Decision")
    if value:
        normalized = value.strip().lower()
        return normalized if normalized in VALID_DECISIONS else None
    for decision in sorted(VALID_DECISIONS):
        if re.search(rf"(?im)^\s*[-*]?\s*decision\s*=\s*{re.escape(decision)}\s*$", text):
            return decision
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-guard", type=Path, default=DEFAULT_SOURCE_GUARD)
    parser.add_argument("--decision-brief", type=Path, default=DEFAULT_DECISION_BRIEF)
    parser.add_argument("--decision-record", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    guard_text = read_text(args.source_guard)
    guard_status = markdown_value(guard_text, "Status") or "MISSING"
    brief_present = args.decision_brief.is_file()
    decision = decision_from_record(args.decision_record)
    decision_record_present = bool(args.decision_record and args.decision_record.is_file())

    if not decision_record_present:
        status = "NEEDS_USER_DECISION"
        ready = False
        note = "requires explicit decision record with Decision: keep, revert, or split-review"
    elif decision is None:
        status = "INVALID_DECISION_RECORD"
        ready = False
        note = "decision record exists but does not contain a valid Decision field"
    elif guard_status == "PASS_WITH_LIMITS":
        status = "READY_FOR_READONLY_S16_SMOKE"
        ready = True
        note = "decision recorded and source guard is pass-with-limits; proceed to read-only S16 smoke"
    else:
        status = "DECISION_RECORDED_NEEDS_READONLY_RERUN"
        ready = False
        note = "decision recorded, but source guard is not pass-with-limits; rerun read-only S16 guard/smoke after applying decision"

    lines = [
        "# S16 Autocomplete Decision Intake",
        "",
        f"- Status: `{status}`",
        f"- Ready for read-only S16 smoke: `{'yes' if ready else 'no'}`",
        f"- Source guard: `{args.source_guard}`",
        f"- Source guard status: `{guard_status}`",
        f"- Decision brief: `{args.decision_brief}`",
        f"- Decision brief present: `{'yes' if brief_present else 'no'}`",
        f"- Decision record: `{args.decision_record if args.decision_record else 'not provided'}`",
        f"- Decision record present: `{'yes' if decision_record_present else 'no'}`",
        f"- Parsed decision: `{decision or 'none'}`",
        f"- Note: {note}",
        "",
        "## Accepted decisions",
        "",
        "- `keep`: keep current protected autocomplete/package source changes, then rerun a read-only S16 validation.",
        "- `revert`: revert current protected autocomplete/package source changes outside this helper, then rerun a read-only S16 validation.",
        "- `split-review`: keep decision open as a separate review branch, then rerun only after that review is complete.",
        "",
        "## Boundary",
        "",
        "This helper does not modify protected files, does not run autocomplete smoke, and does not decide whether existing source changes should be kept or reverted.",
        "",
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(f"Status: {status}")
    print(f"Summary: {args.output}")
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
