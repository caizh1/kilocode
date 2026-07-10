#!/usr/bin/env python3
"""Conservative final signoff intake for ChipMate feature migration.

This helper is intentionally read-only. It does not execute tests, install
VSIX files, package artifacts, or mark the migration complete. It combines the
latest readiness intake, completion audit, current-state consistency check,
package refresh decision, and final review decision into one final-signoff gate
so M11 cannot be accepted by looking at only one evidence file.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path


DEFAULT_READINESS = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-161000-m11-readiness-after-latest-s3-rerun/"
    "summary.md"
)
DEFAULT_AUDIT = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-151000-completion-audit-after-dashboard-consistency/"
    "completion-audit.md"
)
DEFAULT_CONSISTENCY = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-151500-current-state-consistency-after-dashboard-consistency/"
    "summary.md"
)
DEFAULT_PACKAGE_REFRESH_DECISION = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-164500-package-refresh-decision-intake/"
    "summary.md"
)
DEFAULT_FINAL_REVIEW = Path("docs/chipmate-feature-migration-final-review-template.md")


@dataclass
class Gate:
    name: str
    status: str
    ready: bool
    evidence: str
    note: str


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


def readiness_gate(path: Path) -> Gate:
    text = read_text(path)
    if not text:
        return Gate("M11 readiness intake", "MISSING", False, str(path), "readiness summary missing")
    status = markdown_value(text, "Overall status") or "UNKNOWN"
    ready_gates = markdown_value(text, "Ready gates") or "UNKNOWN"
    total_gates = markdown_value(text, "Total gates") or "UNKNOWN"
    ready = status == "READY_FOR_M11_REVIEW"
    note = f"requires READY_FOR_M11_REVIEW; ready gates {ready_gates} / total gates {total_gates}"
    return Gate("M11 readiness intake", status, ready, str(path), note)


def completion_audit_gate(path: Path) -> Gate:
    text = read_text(path)
    if not text:
        return Gate("Completion audit", "MISSING", False, str(path), "completion audit missing")
    allowed = markdown_value(text, "Completion allowed") or "UNKNOWN"
    blockers = markdown_value(text, "Blockers") or "UNKNOWN"
    review_items = markdown_value(text, "Review items") or "UNKNOWN"
    ready = allowed.lower() == "yes" and blockers == "0"
    note = f"requires completion allowed yes and 0 blockers; blockers {blockers}, review items {review_items}"
    return Gate("Completion audit", f"allowed={allowed}", ready, str(path), note)


def consistency_gate(path: Path) -> Gate:
    text = read_text(path)
    if not text:
        return Gate("Current-state consistency", "MISSING", False, str(path), "consistency summary missing")
    status = markdown_value(text, "Status") or "UNKNOWN"
    failed = markdown_value(text, "Failed checks") or "UNKNOWN"
    ready = status == "PASS" and failed == "0"
    note = f"requires PASS and 0 failed checks; failed checks {failed}"
    return Gate("Current-state consistency", status, ready, str(path), note)


def package_refresh_decision_gate(path: Path) -> Gate:
    text = read_text(path)
    if not text:
        return Gate(
            "Package refresh decision",
            "MISSING",
            False,
            str(path),
            "package refresh decision intake summary missing",
        )
    status = markdown_value(text, "Overall status") or "UNKNOWN"
    decision = markdown_value(text, "Decision") or "UNKNOWN"
    accepted_by = markdown_value(text, "Accepted by") or "UNKNOWN"
    accepted_date = markdown_value(text, "Accepted date") or "UNKNOWN"
    ready = status == "READY_FOR_PACKAGE_REFRESH_SCOPE"
    note = (
        "requires READY_FOR_PACKAGE_REFRESH_SCOPE with accepted decision; "
        f"decision {decision}, accepted by {accepted_by}, accepted date {accepted_date}"
    )
    return Gate("Package refresh decision", status, ready, str(path), note)


def final_review_gate(path: Path, accept_known_limits: bool) -> Gate:
    text = read_text(path)
    if not text:
        return Gate("Final review decision", "MISSING", False, str(path), "final review template missing")
    final_statuses = re.findall(r"(?m)^```text\s*\n([A-Z_]+)\s*\n```", text)
    status = final_statuses[-1] if final_statuses else (markdown_value(text, "Current decision") or "UNKNOWN")
    if status == "PASS":
        return Gate("Final review decision", status, True, str(path), "PASS is acceptable for final signoff")
    if status == "PASS_WITH_KNOWN_LIMITS" and accept_known_limits:
        return Gate(
            "Final review decision",
            status,
            True,
            str(path),
            "PASS_WITH_KNOWN_LIMITS accepted through --accept-pass-with-known-limits",
        )
    if status == "PASS_WITH_KNOWN_LIMITS":
        note = "PASS_WITH_KNOWN_LIMITS requires --accept-pass-with-known-limits"
    else:
        note = "requires final decision PASS, or explicitly accepted PASS_WITH_KNOWN_LIMITS"
    return Gate("Final review decision", status, False, str(path), note)


def write_summary(output: Path, gates: list[Gate]) -> None:
    ready = all(gate.ready for gate in gates)
    lines = [
        "# M11 Final Signoff Intake",
        "",
        f"- Overall status: `{'READY_FOR_FINAL_SIGNOFF' if ready else 'NOT_READY_FOR_FINAL_SIGNOFF'}`",
        f"- Ready gates: `{sum(1 for gate in gates if gate.ready)}`",
        f"- Total gates: `{len(gates)}`",
        "",
        "| Gate | Ready | Status | Evidence | Note |",
        "|---|---:|---:|---|---|",
    ]
    for gate in gates:
        lines.append(
            f"| {gate.name} | `{'yes' if gate.ready else 'no'}` | `{gate.status}` | `{gate.evidence}` | {gate.note} |"
        )
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "This helper is a final signoff intake only. It does not execute tests, does not install or package VSIX files, does not replace manual M11 review, and does not redefine completion scope.",
            "",
        ]
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--readiness", type=Path, default=DEFAULT_READINESS)
    parser.add_argument("--completion-audit", type=Path, default=DEFAULT_AUDIT)
    parser.add_argument("--consistency", type=Path, default=DEFAULT_CONSISTENCY)
    parser.add_argument("--package-refresh-decision", type=Path, default=DEFAULT_PACKAGE_REFRESH_DECISION)
    parser.add_argument("--final-review", type=Path, default=DEFAULT_FINAL_REVIEW)
    parser.add_argument("--accept-pass-with-known-limits", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    gates = [
        readiness_gate(args.readiness),
        completion_audit_gate(args.completion_audit),
        consistency_gate(args.consistency),
        package_refresh_decision_gate(args.package_refresh_decision),
        final_review_gate(args.final_review, args.accept_pass_with_known_limits),
    ]
    write_summary(args.output, gates)
    ready = all(gate.ready for gate in gates)
    print(f"Status: {'READY_FOR_FINAL_SIGNOFF' if ready else 'NOT_READY_FOR_FINAL_SIGNOFF'}")
    print(f"Summary: {args.output}")
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
