#!/usr/bin/env python3
"""Read-only completion audit for the ChipMate feature migration plan.

This helper does not execute tests, package VSIX files, install extensions, or
change checklist state. It reads the plan/evidence/final-review files and emits
a Markdown report listing items that still block final completion.
"""

from __future__ import annotations

import argparse
import pathlib
import re
from dataclasses import dataclass


DEFAULT_PLAN = pathlib.Path("docs/chipmate-feature-migration-plan.md")
DEFAULT_EVIDENCE = pathlib.Path("docs/chipmate-feature-migration-validation-evidence.md")
DEFAULT_FINAL_REVIEW = pathlib.Path("docs/chipmate-feature-migration-final-review-template.md")

BLOCKING_STATUSES = {
    "TODO",
    "FAIL",
    "REVIEW",
    "OPEN",
    "PENDING",
    "PARTIAL",
    "BLOCKED",
    "BLOCKED_AUTH",
    "BLOCKED_BY_AUTH",
    "NOT_RUN",
    "TIMEOUT",
    "ERROR_NEEDS_REVIEW",
    "NEEDS_REVIEW",
}
REVIEW_STATUSES = {
    "SKIPPED",
    "PASS_WITH_LIMITS",
    "PASS_WITH_REVIEW",
}
STATUS_HEADER_NAMES = {
    "STATUS",
    "RESULT",
    "STATE",
    "状态",
    "结果",
}


@dataclass
class Finding:
    source: str
    line: int
    severity: str
    text: str


def read_lines(path: pathlib.Path) -> list[str]:
    if not path.exists():
        return []
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def unchecked_plan_items(path: pathlib.Path) -> list[Finding]:
    findings: list[Finding] = []
    for index, line in enumerate(read_lines(path), start=1):
        if line.startswith("- [ ] "):
            findings.append(Finding(str(path), index, "BLOCKER", line[6:]))
    return findings


def evidence_open_items(path: pathlib.Path) -> list[Finding]:
    return markdown_status_table_items(path)


def final_review_todos(path: pathlib.Path) -> list[Finding]:
    return markdown_status_table_items(path)


def markdown_status_table_items(path: pathlib.Path) -> list[Finding]:
    findings: list[Finding] = []
    lines = read_lines(path)
    status_columns: list[int] = []
    for index, line in enumerate(lines, start=1):
        if not is_table_row(line):
            status_columns = []
            continue
        cells = parse_table_cells(line)
        next_line = lines[index] if index < len(lines) else ""
        if is_table_separator(next_line):
            status_columns = [
                cell_index
                for cell_index, cell in enumerate(cells)
                if normalize_status_cell(cell) in STATUS_HEADER_NAMES
            ]
            continue
        if is_table_separator(line):
            continue
        if not status_columns:
            continue
        for cell_index in status_columns:
            if cell_index >= len(cells):
                continue
            status = normalize_status_cell(cells[cell_index])
            if status in BLOCKING_STATUSES:
                findings.append(Finding(str(path), index, "BLOCKER", line))
                break
            if status in REVIEW_STATUSES:
                findings.append(Finding(str(path), index, "REVIEW", line))
                break
    return findings


def is_table_row(line: str) -> bool:
    return line.startswith("|") and line.endswith("|")


def is_table_separator(line: str) -> bool:
    if not is_table_row(line):
        return False
    cells = parse_table_cells(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in cells)


def parse_table_cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def normalize_status_cell(cell: str) -> str:
    normalized = cell.strip().strip("`").strip()
    normalized = re.sub(r"<[^>]+>", "", normalized)
    normalized = normalized.replace(" ", "_").replace("-", "_")
    return normalized.upper()


def summarize(findings: list[Finding]) -> str:
    blockers = [finding for finding in findings if finding.severity == "BLOCKER"]
    review_items = [finding for finding in findings if finding.severity != "BLOCKER"]
    output: list[str] = []
    output.append("# ChipMate Feature Migration Completion Audit")
    output.append("")
    output.append("This report is read-only. It is not proof of validation success and does not change checklist state.")
    output.append("")
    output.append(f"- Blockers: `{len(blockers)}`")
    output.append(f"- Review items: `{len(review_items)}`")
    output.append(f"- Completion allowed: `{'no' if blockers else 'yes'}`")
    output.append("")
    output.append("## Blocking items")
    output.append("")
    if blockers:
        output.append("| Source | Line | Item |")
        output.append("|---|---:|---|")
        for finding in blockers:
            output.append(f"| `{escape_md(finding.source)}` | {finding.line} | {escape_md(finding.text)} |")
    else:
        output.append("No blocking items found by this static audit.")
    output.append("")
    output.append("## Review items")
    output.append("")
    if review_items:
        output.append("| Source | Line | Item |")
        output.append("|---|---:|---|")
        for finding in review_items:
            output.append(f"| `{escape_md(finding.source)}` | {finding.line} | {escape_md(finding.text)} |")
    else:
        output.append("No non-blocking review items found.")
    output.append("")
    output.append("## Completion rule")
    output.append("")
    output.append("- The active goal cannot be marked complete while blockers remain.")
    output.append("- Runtime evidence must still be inspected manually; this helper checks unchecked plan items plus Markdown table status/result columns with values such as TODO, FAIL, REVIEW, OPEN, PENDING, PARTIAL, BLOCKED_AUTH, TIMEOUT, ERROR_NEEDS_REVIEW, NEEDS_REVIEW, SKIPPED, PASS_WITH_REVIEW, and PASS_WITH_LIMITS.")
    output.append("- If this report says completion is allowed, still perform the requirement-by-requirement M11 review before final sign-off.")
    output.append("")
    return "\n".join(output)


def escape_md(value: str) -> str:
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=pathlib.Path, default=DEFAULT_PLAN)
    parser.add_argument("--evidence", type=pathlib.Path, default=DEFAULT_EVIDENCE)
    parser.add_argument("--final-review", type=pathlib.Path, default=DEFAULT_FINAL_REVIEW)
    parser.add_argument("--output", type=pathlib.Path, help="Optional Markdown output path. Defaults to stdout.")
    args = parser.parse_args()

    findings: list[Finding] = []
    findings.extend(unchecked_plan_items(args.plan))
    findings.extend(evidence_open_items(args.evidence))
    findings.extend(final_review_todos(args.final_review))
    report = summarize(findings)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report + "\n", encoding="utf-8")
    else:
        print(report)
    return 1 if any(finding.severity == "BLOCKER" for finding in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
