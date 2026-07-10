#!/usr/bin/env python3
"""Summarize a ChipMate feature migration validation run directory.

This helper is intentionally read-only with respect to the repository state. It
does not run tests, package VSIX files, install extensions, or update the main
evidence document. It only reads files produced by
chipmate-feature-migration-validation-capture.sh and emits a Markdown summary
that can be manually reviewed and copied into the evidence log.
"""

from __future__ import annotations

import argparse
import csv
import pathlib
from dataclasses import dataclass


@dataclass
class StatusRow:
    id: str
    area: str
    status: str
    exit_code: str
    cwd: str
    command: str
    log: str


def read_status(run_dir: pathlib.Path) -> list[StatusRow]:
    status_file = run_dir / "status.tsv"
    if not status_file.exists():
        return []
    with status_file.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        return [
            StatusRow(
                id=row.get("id", ""),
                area=row.get("area", ""),
                status=row.get("status", ""),
                exit_code=row.get("exit_code", ""),
                cwd=row.get("cwd", ""),
                command=row.get("command", ""),
                log=row.get("log", ""),
            )
            for row in reader
        ]


def read_optional(path: pathlib.Path, max_lines: int = 80) -> list[str]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    if len(lines) <= max_lines:
        return lines
    return [*lines[:max_lines], f"... truncated {len(lines) - max_lines} more line(s)"]


def md_cell(value: str) -> str:
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ")


def md_code_cell(value: str) -> str:
    return f"`{md_cell(value).replace('`', '&#96;')}`"


def summarize(run_dir: pathlib.Path) -> str:
    rows = read_status(run_dir)
    smoke_path = run_dir / "installed-vscode-smoke.md"
    vsix_path = run_dir / "vsix-inspection.md"

    counts: dict[str, int] = {}
    for row in rows:
        counts[row.status or "UNKNOWN"] = counts.get(row.status or "UNKNOWN", 0) + 1

    output: list[str] = []
    output.append("# ChipMate Feature Migration Validation Run Summary")
    output.append("")
    output.append(f"- Run directory: `{run_dir}`")
    output.append(f"- Status rows: `{len(rows)}`")
    for status in sorted(counts):
        output.append(f"- {status}: `{counts[status]}`")
    output.append("")

    output.append("## Command / Inspection Status")
    output.append("")
    if not rows:
        output.append("No `status.tsv` rows found.")
    else:
        output.append("| ID | Area | Status | Exit code | Command | Log |")
        output.append("|---|---|---|---|---|---|")
        for row in rows:
            output.append(
                f"| {md_cell(row.id)} | {md_cell(row.area)} | {md_cell(row.status)} | {md_cell(row.exit_code)} | {md_code_cell(row.command)} | {md_code_cell(row.log)} |"
            )
    output.append("")

    output.append("## VSIX Inspection")
    output.append("")
    vsix_lines = read_optional(vsix_path)
    if vsix_lines:
        output.extend(vsix_lines)
    else:
        output.append("No VSIX inspection report found.")
    output.append("")

    output.append("## Installed VS Code Smoke Checklist")
    output.append("")
    if smoke_path.exists():
        output.append(f"- Smoke checklist: `{smoke_path}`")
        output.append("- Review S1-S16 manually before checking M10/M11.")
    else:
        output.append("No installed smoke checklist found.")
    output.append("")

    output.append("## Manual Evidence Update Checklist")
    output.append("")
    output.append("- Copy command pass/fail summaries into `chipmate-feature-migration-validation-evidence.md`.")
    output.append("- Copy VSIX version, size, filename, and inspection status into Packaging Evidence.")
    output.append("- Record installed smoke S1-S16 results after manual VS Code validation.")
    output.append("- Add or close Known Issues before checking M10/M11.")
    output.append("- Do not mark the active goal complete from this summary alone.")
    output.append("")

    return "\n".join(output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=pathlib.Path, help="Validation run directory produced by the capture helper.")
    parser.add_argument("--output", type=pathlib.Path, help="Optional Markdown output path. Defaults to stdout.")
    args = parser.parse_args()

    run_dir = args.run_dir.resolve()
    summary = summarize(run_dir)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(summary + "\n", encoding="utf-8")
    else:
        print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
