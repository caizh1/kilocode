#!/usr/bin/env python3
"""Validate returned internal embedded-C source-backed detail-design evidence.

This is a conservative evidence-shape intake helper. It does not open VS Code,
run ChipMate chat, execute the source-backed skill, generate Word files, render
diagrams, or decide final M11 acceptance.
"""

from __future__ import annotations

import argparse
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path


REQUIRED_CONTEXT = [
    "Installed VSIX profile",
    "VSIX version",
    "Source workspace",
    "Embedded C module",
    "Evidence date",
    "Operator",
]

REQUIRED_PASS_STATUSES = [
    "ChipMate native QA preserved",
    "Source-backed detail-design skill selected",
    "Current source evidence collected",
    "Markdown detail design generated",
    "Word detail design generated",
    "At least one diagram generated",
    "Quality report generated",
    "Source evidence references present",
    "Old ChipMate contract markers absent",
    "No missing-diagram auto-repair triggered",
    "No document-contract planning triggered when skill disabled",
]

BAD_MARKERS = [
    "TODO",
    "PENDING",
    "FAIL",
    "NEEDS_REVIEW",
    "not run",
    "not executed",
    "not generated",
    "not confirmed",
    "placeholder",
]

ARTIFACT_SUFFIXES = {
    ".md",
    ".docx",
    ".mmd",
    ".drawio",
    ".png",
    ".svg",
    ".json",
    ".log",
}


@dataclass(frozen=True)
class IntakeResult:
    status: str
    passed: list[str]
    failed: list[str]


def find_evidence_file(evidence_dir: Path) -> Path:
    preferred = evidence_dir / "internal-embedded-c-detail-design-evidence.md"
    if preferred.exists():
        return preferred
    candidates = sorted(evidence_dir.glob("*embedded*c*detail*design*evidence*.md"))
    if candidates:
        return candidates[0]
    raise FileNotFoundError("missing internal-embedded-c-detail-design-evidence.md")


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


def count_artifacts(evidence_dir: Path, evidence_file: Path, output_file: Path | None) -> dict[str, int]:
    counts = {
        "markdown": 0,
        "word": 0,
        "diagram": 0,
        "quality": 0,
        "all": 0,
    }
    for path in evidence_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.resolve() == evidence_file.resolve():
            continue
        if output_file is not None and output_file.exists() and path.resolve() == output_file.resolve():
            continue
        suffix = path.suffix.lower()
        if suffix not in ARTIFACT_SUFFIXES:
            continue
        counts["all"] += 1
        lower_name = path.name.lower()
        if suffix == ".docx":
            counts["word"] += 1
        if suffix == ".md":
            counts["markdown"] += 1
        if suffix in {".mmd", ".drawio", ".png", ".svg"}:
            counts["diagram"] += 1
        if "quality" in lower_name or "review" in lower_name or "report" in lower_name:
            counts["quality"] += 1
    return counts


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

    artifacts = count_artifacts(evidence_dir, evidence_file, output_file)
    if artifacts["markdown"] >= 1:
        passed.append(f"generated Markdown artifacts: {artifacts['markdown']}")
    else:
        failed.append("generated Markdown artifacts missing")
    if artifacts["word"] >= 1:
        passed.append(f"generated Word artifacts: {artifacts['word']}")
    else:
        failed.append("generated Word artifacts missing")
    if artifacts["diagram"] >= 1:
        passed.append(f"generated diagram artifacts: {artifacts['diagram']}")
    else:
        failed.append("generated diagram artifacts missing")
    if artifacts["quality"] >= 1:
        passed.append(f"quality report artifacts: {artifacts['quality']}")
    else:
        failed.append("quality report artifacts missing")

    status = "PASS" if not failed else "PARTIAL_NEEDS_REVIEW"
    return IntakeResult(status, passed, failed)


def write_summary(result: IntakeResult, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Internal Embedded-C Source-Backed Detail Design Intake Summary",
        "",
        f"Status: `{result.status}`",
        f"Passed checks: `{len(result.passed)}`",
        f"Failed checks: `{len(result.failed)}`",
        "",
        "## Failed checks",
    ]
    lines.extend(f"- {item}" for item in result.failed) if result.failed else lines.append("- None")
    lines.extend(["", "## Passed checks"])
    lines.extend(f"- {item}" for item in result.passed) if result.passed else lines.append("- None")
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "This helper validates returned internal embedded-C detail-design evidence only. It does not run ChipMate QA, does not execute the source-backed skill, does not generate Word output, does not require missing artifacts, does not run recipe repair, and does not accept ChipMate document-contract planning or missing-diagram auto-repair as completion evidence.",
            "",
        ]
    )
    output.write_text("\n".join(lines), encoding="utf-8")


def run_self_check(output: Path) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        complete = root / "complete"
        incomplete = root / "incomplete"
        for subdir in [complete, incomplete]:
            (subdir / "artifacts").mkdir(parents=True)

        complete_text = """# Internal Embedded-C Source-Backed Detail Design Evidence

- Installed VSIX profile: isolated-profile
- VSIX version: 0.0.38
- Source workspace: /tmp/internal-firmware
- Embedded C module: drivers/storage/foo.c
- Evidence date: 2026-07-09
- Operator: validation-owner

## Required statuses

- ChipMate native QA preserved: PASS
- Source-backed detail-design skill selected: PASS
- Current source evidence collected: PASS
- Markdown detail design generated: PASS
- Word detail design generated: PASS
- At least one diagram generated: PASS
- Quality report generated: PASS
- Source evidence references present: PASS
- Old ChipMate contract markers absent: PASS
- No missing-diagram auto-repair triggered: PASS
- No document-contract planning triggered when skill disabled: PASS
"""
        incomplete_text = """# Internal Embedded-C Source-Backed Detail Design Evidence

- Installed VSIX profile: <profile name/path>
- VSIX version: 0.0.38
- Source workspace: /tmp/internal-firmware
- Embedded C module: drivers/storage/foo.c
- Evidence date: 2026-07-09
- Operator: validation-owner

## Required statuses

- ChipMate native QA preserved: PASS
- Source-backed detail-design skill selected: TODO
"""
        (complete / "internal-embedded-c-detail-design-evidence.md").write_text(complete_text, encoding="utf-8")
        (complete / "artifacts" / "detail-design.md").write_text("detail design", encoding="utf-8")
        (complete / "artifacts" / "detail-design.docx").write_bytes(b"fake docx")
        (complete / "artifacts" / "flow.mmd").write_text("graph TD", encoding="utf-8")
        (complete / "artifacts" / "quality-report.md").write_text("quality report", encoding="utf-8")
        (incomplete / "internal-embedded-c-detail-design-evidence.md").write_text(incomplete_text, encoding="utf-8")

        complete_result = evaluate(complete)
        incomplete_result = evaluate(incomplete)

    passed: list[str] = []
    failed: list[str] = []
    if complete_result.status == "PASS":
        passed.append("complete fixture accepted")
    else:
        failed.append("complete fixture was not accepted")
    if incomplete_result.status != "PASS":
        passed.append("incomplete fixture rejected")
    else:
        failed.append("incomplete fixture was incorrectly accepted")

    status = "PASS" if not failed else "FAIL"
    result = IntakeResult(status, passed, failed)
    write_summary(result, output)
    print(f"Status: {status}")
    print(f"Summary: {output}")
    return 0 if status == "PASS" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()

    output = args.output.resolve()
    if args.self_check:
        return run_self_check(output)
    if args.evidence_dir is None:
        raise SystemExit("--evidence-dir is required unless --self-check is used")
    result = evaluate(args.evidence_dir.resolve(), output)
    write_summary(result, output)
    print(f"Status: {result.status}")
    print(f"Summary: {output}")
    return 0 if result.status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
