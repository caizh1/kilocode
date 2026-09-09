#!/usr/bin/env python3
"""Intake a returned M11 external-evidence bundle.

This helper is intentionally conservative. It does not execute VS Code, run
ChipMate chat, package VSIX files, run target-machine commands, or decide final
signoff. It discovers typed evidence summaries in a returned bundle and then
delegates the actual readiness decision to
chipmate-feature-migration-m11-readiness-intake.py.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
READINESS = REPO_ROOT / "docs/chipmate-feature-migration-m11-readiness-intake.py"

DEFAULT_S3 = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-120000-document-rag-readiness-rerun/"
    "document-rag-readiness-summary.md"
)
DEFAULT_S16_SOURCE_GUARD = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-004500-s16-source-guard/summary.md"
)

BUNDLE_FILES = {
    "s16-decision-intake": ("s16", "current-summary.md"),
    "installed-runtime-intake": ("installed-runtime", "runtime-intake-summary.md"),
    "windows-target-intake": ("windows-target", "target-intake-summary.md"),
    "linux-target-intake": ("linux-target", "target-intake-summary.md"),
    "internal-embedded-c-intake": ("internal-embedded-c", "summary.md"),
    "company-template-summary": ("company-template", "summary.md"),
}


@dataclass(frozen=True)
class EvidenceFile:
    key: str
    path: Path
    exists: bool


def markdown_value(text: str, label: str) -> str | None:
    match = re.search(rf"(?im)^\s*[-*]?\s*{re.escape(label)}\s*:\s*`?([^`\n]+?)`?\s*$", text)
    if match:
        return match.group(1).strip()
    match = re.search(rf"(?im)^\|\s*{re.escape(label)}\s*\|\s*`?([^|`]+?)`?\s*\|", text)
    if match:
        return match.group(1).strip()
    return None


def discover_bundle_files(bundle_dir: Path) -> list[EvidenceFile]:
    found: list[EvidenceFile] = []
    for key, parts in BUNDLE_FILES.items():
        path = bundle_dir.joinpath(*parts)
        found.append(EvidenceFile(key, path, path.is_file()))
    return found


def run_readiness(
    output: Path,
    s3_readiness: Path,
    s16_source_guard: Path,
    evidence_files: list[EvidenceFile],
    accept_s16_decision: bool,
    accept_company_template_pass_with_limits: bool,
) -> subprocess.CompletedProcess[str]:
    by_key = {item.key: item for item in evidence_files if item.exists}
    args = [
        sys.executable,
        str(READINESS),
        "--s3-readiness",
        str(s3_readiness),
        "--s16-source-guard",
        str(s16_source_guard),
        "--output",
        str(output),
    ]
    mapping = [
        ("s16-decision-intake", "--s16-decision-brief"),
        ("installed-runtime-intake", "--installed-runtime-intake"),
        ("windows-target-intake", "--windows-target-intake"),
        ("linux-target-intake", "--linux-target-intake"),
        ("internal-embedded-c-intake", "--internal-embedded-c-summary"),
        ("company-template-summary", "--company-template-summary"),
    ]
    for key, flag in mapping:
        item = by_key.get(key)
        if item:
            args.extend([flag, str(item.path)])
    if accept_s16_decision:
        args.append("--accept-s16-decision")
    if accept_company_template_pass_with_limits:
        args.append("--accept-company-template-pass-with-limits")
    return subprocess.run(
        args,
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )


def write_bundle_summary(
    output: Path,
    bundle_dir: Path,
    evidence_files: list[EvidenceFile],
    readiness_summary: Path,
    readiness_run: subprocess.CompletedProcess[str],
) -> str:
    readiness_text = readiness_summary.read_text(encoding="utf-8", errors="replace") if readiness_summary.is_file() else ""
    overall = markdown_value(readiness_text, "Overall status") or "MISSING"
    ready_gates = markdown_value(readiness_text, "Ready gates") or "UNKNOWN"
    total_gates = markdown_value(readiness_text, "Total gates") or "UNKNOWN"
    missing = [item.key for item in evidence_files if not item.exists]
    status = "READY_FOR_M11_REVIEW" if overall == "READY_FOR_M11_REVIEW" and not missing else "NOT_READY_FOR_M11_REVIEW"

    lines = [
        "# M11 Returned Evidence Bundle Intake",
        "",
        f"- Status: `{status}`",
        f"- Bundle directory: `{bundle_dir}`",
        f"- Readiness summary: `{readiness_summary}`",
        f"- Readiness exit: `{readiness_run.returncode}`",
        f"- Readiness overall status: `{overall}`",
        f"- Ready gates: `{ready_gates}`",
        f"- Total gates: `{total_gates}`",
        f"- Missing evidence files: `{len(missing)}`",
        "",
        "| Evidence | Present | Path |",
        "|---|---:|---|",
    ]
    for item in evidence_files:
        lines.append(f"| {item.key} | `{'yes' if item.exists else 'no'}` | `{item.path}` |")
    lines.extend(
        [
            "",
            "## Missing evidence",
        ]
    )
    lines.extend(f"- {item}" for item in missing) if missing else lines.append("- None")
    lines.extend(
        [
            "",
            "## Readiness command output",
            "",
            "```text",
            readiness_run.stdout.strip(),
            "```",
            "",
            "## Boundary",
            "",
            "This helper only discovers returned typed evidence summaries and delegates readiness to the M11 readiness helper. It does not run ChipMate QA, does not execute target-machine commands, does not install VSIX files, does not run autocomplete, does not generate Word output, and does not mark final signoff complete.",
            "",
        ]
    )
    output.write_text("\n".join(lines), encoding="utf-8")
    return status


def intake(args: argparse.Namespace) -> int:
    bundle_dir = args.bundle_dir.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    readiness_summary = output_dir / "m11-readiness-summary.md"
    bundle_summary = output_dir / "summary.md"

    evidence_files = discover_bundle_files(bundle_dir)
    readiness_run = run_readiness(
        readiness_summary,
        args.s3_readiness.resolve(),
        args.s16_source_guard.resolve(),
        evidence_files,
        args.accept_s16_decision,
        args.accept_company_template_pass_with_limits,
    )
    status = write_bundle_summary(bundle_summary, bundle_dir, evidence_files, readiness_summary, readiness_run)
    print(f"Status: {status}")
    print(f"Summary: {bundle_summary}")
    return 0 if status == "READY_FOR_M11_REVIEW" else 1


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def build_ready_bundle(root: Path) -> tuple[Path, Path, Path]:
    bundle = root / "bundle"
    s3 = write(
        root / "s3.md",
        "\n".join(
            [
                "# S3",
                "",
                "- Status: `PASS`",
                "- document_search used: `yes`",
                "- provider/readiness failure detected: `no`",
                "",
            ]
        ),
    )
    source_guard = write(root / "s16-source-guard.md", "# S16\n\n- Status: `PASS_WITH_LIMITS`\n")
    write(
        bundle / "s16" / "current-summary.md",
        "\n".join(
            [
                "# S16 Autocomplete Decision Intake",
                "",
                "- Status: `READY_FOR_READONLY_S16_SMOKE`",
                "- Ready for read-only S16 smoke: `yes`",
                "- Source guard status: `PASS_WITH_LIMITS`",
                "- Decision record present: `yes`",
                "- Parsed decision: `keep`",
                "",
                "## Boundary",
                "",
                "This helper does not modify protected files.",
                "",
            ]
        ),
    )
    write(
        bundle / "installed-runtime" / "runtime-intake-summary.md",
        "# Runtime Smoke Intake Verify\n\n- Requested ids: `S1,S2,S3,S4,S5,S6,S7,S8,S9,S10,S11,S12,S13,S14,S15,S16`\n- Final status: `PASS`\n\n## Checks\n- S1: PASS\n- S16: PASS\n- S16 source guard: PASS_WITH_LIMITS\n",
    )
    for target, target_name in [("windows-target", "win32-x64"), ("linux-target", "linux-x64")]:
        write(
            bundle / target / "target-intake-summary.md",
            "\n".join(
                [
                    "# ChipMate Offline Target Evidence Intake Verify",
                    "",
                    f"- Target: `{target_name}`",
                    "- Final status: `PASS`",
                    "",
                    "## Package evidence checks",
                    "- package summary status PASS",
                    "",
                    "## Runtime evidence checks",
                    "- runtime intake summary final status PASS: runtime-intake-summary.md",
                    "",
                    "## Target evidence return template checks",
                    "- target evidence return template overall status PASS",
                    "- Overall target status PASS",
                    "",
                ]
            ),
        )
    write(
        bundle / "internal-embedded-c" / "summary.md",
        "\n".join(
            [
                "# Internal Embedded-C Source-Backed Detail Design Intake Summary",
                "",
                "Status: `PASS`",
                "Passed checks: `24`",
                "Failed checks: `0`",
                "",
                "## Passed checks",
                "- evidence file found: internal-embedded-c-detail-design-evidence.md",
                "- context filled: Installed VSIX profile",
                "- context filled: Source workspace",
                "- context filled: Embedded C module",
                "- status PASS: ChipMate native QA preserved",
                "- status PASS: Source-backed detail-design skill selected",
                "- status PASS: Markdown detail design generated",
                "- status PASS: Word detail design generated",
                "- status PASS: At least one diagram generated",
                "- status PASS: Quality report generated",
                "- status PASS: Old ChipMate contract markers absent",
                "- status PASS: No missing-diagram auto-repair triggered",
                "- status PASS: No document-contract planning triggered when skill disabled",
                "- generated Markdown artifacts: 1",
                "- generated Word artifacts: 1",
                "- generated diagram artifacts: 1",
                "- quality report artifacts: 1",
                "",
            ]
        ),
    )
    write(
        bundle / "company-template" / "summary.md",
        "# Company DOCX Template Validation\n\n- Status: `PASS`\n- Template: `/tmp/company.docx`\n- Template size: `1000`\n- Style count: `12`\n\n## Failures\n- None\n\n## Warnings\n- None\n\n## Boundary\n\nThis helper validates a real .docx template or style source as OOXML input evidence only. It does not generate Word output, does not fill placeholders, does not require missing artifacts, does not run recipe repair, and does not decide installed chat/runtime S8 acceptance.\n",
    )
    return bundle, s3, source_guard


def self_check(output_dir: Path) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        bundle, s3, source_guard = build_ready_bundle(root)
        ready_out = root / "ready-out"
        ready_args = argparse.Namespace(
            bundle_dir=bundle,
            output_dir=ready_out,
            s3_readiness=s3,
            s16_source_guard=source_guard,
            accept_s16_decision=True,
            accept_company_template_pass_with_limits=False,
        )
        ready_code = intake(ready_args)
    passed: list[str] = []
    failed: list[str] = []
    if ready_code == 0:
        passed.append("complete returned-evidence bundle reaches READY_FOR_M11_REVIEW")
    else:
        failed.append("complete returned-evidence bundle was not accepted")
    status = "PASS" if not failed else "FAIL"
    output_dir.mkdir(parents=True, exist_ok=True)
    lines = [
        "# M11 Returned Evidence Bundle Intake Self-Check",
        "",
        f"Status: `{status}`",
        f"Passed checks: `{len(passed)}`",
        f"Failed checks: `{len(failed)}`",
        "",
        "## Failed checks",
    ]
    lines.extend(f"- {item}" for item in failed) if failed else lines.append("- None")
    lines.extend(["", "## Passed checks"])
    lines.extend(f"- {item}" for item in passed) if passed else lines.append("- None")
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "This self-check uses synthetic returned-evidence bundles only. It proves bundle intake wiring, not real installed VS Code runtime behavior.",
            "",
        ]
    )
    summary = output_dir / "summary.md"
    summary.write_text("\n".join(lines), encoding="utf-8")
    print(f"Status: {status}")
    print(f"Summary: {summary}")
    return 0 if status == "PASS" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--s3-readiness", type=Path, default=DEFAULT_S3)
    parser.add_argument("--s16-source-guard", type=Path, default=DEFAULT_S16_SOURCE_GUARD)
    parser.add_argument("--accept-s16-decision", action="store_true")
    parser.add_argument("--accept-company-template-pass-with-limits", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if args.self_check:
        return self_check(args.output_dir.resolve())
    if args.bundle_dir is None:
        raise SystemExit("--bundle-dir is required unless --self-check is used")
    return intake(args)


if __name__ == "__main__":
    raise SystemExit(main())
