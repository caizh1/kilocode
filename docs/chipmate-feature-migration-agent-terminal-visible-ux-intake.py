#!/usr/bin/env python3
"""Validate returned Agent Terminal visible UX evidence.

This is a conservative evidence-shape intake helper. It does not open VS Code,
run Agent Terminal, execute shell commands, or decide final M11 acceptance.
"""

from __future__ import annotations

import argparse
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

REQUIRED_CONTEXT = [
    "Installed VSIX profile",
    "VSIX version",
    "Workspace",
    "Evidence date",
    "Operator",
]

REQUIRED_PASS_STATUSES = [
    "Agent Terminal command visible",
    "Default-off prompt visible",
    "Workspace enable flow explicit",
    "Terminal pane opens after enable",
    "Native ChipMate terminal unaffected",
    "Dangerous command confirmation visible",
    "No destructive command executed without confirmation",
    "Audit log or artifact path recorded",
    "Old ChipMate contract markers absent",
]

BAD_MARKERS = [
    "TODO",
    "PENDING",
    "FAIL",
    "NEEDS_REVIEW",
    "not run",
    "not executed",
    "not visible",
    "not confirmed",
]

ASSET_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".txt",
    ".log",
    ".md",
}


@dataclass(frozen=True)
class IntakeResult:
    status: str
    passed: list[str]
    failed: list[str]


def find_evidence_file(evidence_dir: Path) -> Path:
    preferred = evidence_dir / "agent-terminal-visible-ux-evidence.md"
    if preferred.exists():
        return preferred
    candidates = sorted(evidence_dir.glob("*agent*terminal*visible*ux*.md"))
    if candidates:
        return candidates[0]
    raise FileNotFoundError("missing agent-terminal-visible-ux-evidence.md")


def has_filled_value(text: str, label: str) -> bool:
    pattern = re.compile(rf"^[-*]\s*{re.escape(label)}:\s*(.+?)\s*$", re.MULTILINE)
    match = pattern.search(text)
    if not match:
        return False
    value = match.group(1).strip()
    if not value or re.fullmatch(r"`?<[^>\n]+>`?", value):
        return False
    return True


def has_pass_status(text: str, label: str) -> bool:
    bullet = re.compile(rf"^[-*]\s*{re.escape(label)}:\s*PASS\s*$", re.MULTILINE)
    table = re.compile(rf"^\|\s*{re.escape(label)}\s*\|\s*PASS\s*\|", re.MULTILINE)
    return bool(bullet.search(text) or table.search(text))


def has_placeholder(text: str) -> bool:
    return bool(re.search(r"`?<[^>\n]+>`?", text))


def count_assets(evidence_dir: Path, evidence_file: Path, output_file: Path | None) -> int:
    count = 0
    for path in evidence_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.resolve() == evidence_file.resolve():
            continue
        if output_file is not None and output_file.exists() and path.resolve() == output_file.resolve():
            continue
        if path.suffix.lower() in ASSET_SUFFIXES:
            count += 1
    return count


def evaluate(evidence_dir: Path, output_file: Path | None = None) -> IntakeResult:
    passed: list[str] = []
    failed: list[str] = []

    try:
        evidence_file = find_evidence_file(evidence_dir)
        text = evidence_file.read_text(encoding="utf-8")
        passed.append(f"evidence file found: {evidence_file.name}")
    except Exception as exc:
        return IntakeResult("PARTIAL_NEEDS_REVIEW", [], [str(exc)])

    for label in REQUIRED_CONTEXT:
        if has_filled_value(text, label):
            passed.append(f"context filled: {label}")
        else:
            failed.append(f"missing or placeholder context: {label}")

    for label in REQUIRED_PASS_STATUSES:
        if has_pass_status(text, label):
            passed.append(f"status PASS: {label}")
        else:
            failed.append(f"missing PASS status: {label}")

    if has_placeholder(text):
        failed.append("placeholder values remain in evidence markdown")
    else:
        passed.append("no placeholder values remain")

    lower_text = text.lower()
    bad_found = [marker for marker in BAD_MARKERS if marker.lower() in lower_text]
    if bad_found:
        failed.append("blocking markers present: " + ", ".join(bad_found))
    else:
        passed.append("no blocking text markers found")

    asset_count = count_assets(evidence_dir, evidence_file, output_file)
    if asset_count >= 2:
        passed.append(f"attached evidence assets: {asset_count}")
    else:
        failed.append(f"attached evidence assets fewer than 2: {asset_count}")

    status = "PASS" if not failed else "PARTIAL_NEEDS_REVIEW"
    return IntakeResult(status, passed, failed)


def write_summary(result: IntakeResult, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Agent Terminal Visible UX Intake Summary",
        "",
        f"Status: `{result.status}`",
        f"Passed checks: `{len(result.passed)}`",
        f"Failed checks: `{len(result.failed)}`",
        "",
        "## Failed checks",
    ]
    if result.failed:
        lines.extend(f"- {item}" for item in result.failed)
    else:
        lines.append("- None")
    lines.extend(["", "## Passed checks"])
    if result.passed:
        lines.extend(f"- {item}" for item in result.passed)
    else:
        lines.append("- None")
    lines.append("")
    output.write_text("\n".join(lines), encoding="utf-8")


def run_self_check(output: Path) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        complete = root / "complete"
        incomplete = root / "incomplete"
        (complete / "screenshots").mkdir(parents=True)
        (complete / "logs").mkdir(parents=True)
        (incomplete / "screenshots").mkdir(parents=True)

        complete_text = """# Agent Terminal Visible UX Evidence

- Installed VSIX profile: isolated-profile
- VSIX version: 0.0.38
- Workspace: /tmp/chipmate-visible-ux
- Evidence date: 2026-07-09
- Operator: validation-owner

## Required statuses

- Agent Terminal command visible: PASS
- Default-off prompt visible: PASS
- Workspace enable flow explicit: PASS
- Terminal pane opens after enable: PASS
- Native ChipMate terminal unaffected: PASS
- Dangerous command confirmation visible: PASS
- No destructive command executed without confirmation: PASS
- Audit log or artifact path recorded: PASS
- Old ChipMate contract markers absent: PASS
"""
        incomplete_text = """# Agent Terminal Visible UX Evidence

- Installed VSIX profile: <profile name/path>
- VSIX version: 0.0.38
- Workspace: /tmp/chipmate-visible-ux
- Evidence date: 2026-07-09
- Operator: validation-owner

## Required statuses

- Agent Terminal command visible: PASS
- Default-off prompt visible: TODO
"""
        (complete / "agent-terminal-visible-ux-evidence.md").write_text(complete_text, encoding="utf-8")
        (complete / "screenshots" / "command-palette.png").write_bytes(b"fake png")
        (complete / "logs" / "terminal.log").write_text("fake log", encoding="utf-8")
        (incomplete / "agent-terminal-visible-ux-evidence.md").write_text(incomplete_text, encoding="utf-8")

        complete_result = evaluate(complete)
        incomplete_result = evaluate(incomplete)

    passed = []
    failed = []
    if complete_result.status == "PASS":
        passed.append("complete fixture accepted")
    else:
        failed.append("complete fixture was not accepted")
    if incomplete_result.status != "PASS":
        passed.append("incomplete fixture rejected")
    else:
        failed.append("incomplete fixture was accepted")

    result = IntakeResult("PASS" if not failed else "FAIL", passed, failed)
    write_summary(result, output)
    return 0 if result.status == "PASS" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()

    output = args.output
    if not output.is_absolute():
        output = REPO_ROOT / output

    if args.self_check:
        return run_self_check(output)

    if args.evidence_dir is None:
        raise SystemExit("--evidence-dir is required unless --self-check is used")
    evidence_dir = args.evidence_dir
    if not evidence_dir.is_absolute():
        evidence_dir = REPO_ROOT / evidence_dir
    result = evaluate(evidence_dir, output)
    write_summary(result, output)
    return 0 if result.status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
