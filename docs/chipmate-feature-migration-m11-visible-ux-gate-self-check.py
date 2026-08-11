#!/usr/bin/env python3
"""Self-check the M11 readiness visible Agent Terminal UX gate.

This helper uses synthetic evidence to verify the readiness intake logic:

- all eight gates satisfied -> READY_FOR_M11_REVIEW
- visible Agent Terminal UX missing -> NOT_READY_FOR_M11_REVIEW

It does not install VSIX files, run VS Code, execute terminal commands, or
decide final M11 acceptance.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
READINESS = REPO_ROOT / "docs/chipmate-feature-migration-m11-readiness-intake.py"


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def run_readiness(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(READINESS), *args],
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )


def contains(path: Path, needle: str) -> bool:
    return needle in path.read_text(encoding="utf-8", errors="replace")


def build_fixture(root: Path) -> dict[str, Path]:
    return {
        "s3": write(
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
        ),
        "s16": write(root / "s16-source-guard.md", "# S16\n\n- Status: `PASS_WITH_LIMITS`\n"),
        "decision": write(
            root / "s16-decision.md",
            "\n".join(
                [
                    "# S16 Autocomplete Decision Intake",
                    "",
                    "- Status: `READY_FOR_READONLY_S16_SMOKE`",
                    "- Ready for read-only S16 smoke: `yes`",
                    "- Source guard: `/tmp/s16-source-guard.md`",
                    "- Source guard status: `PASS_WITH_LIMITS`",
                    "- Decision brief: `/tmp/decision-brief.md`",
                    "- Decision brief present: `yes`",
                    "- Decision record: `/tmp/decision-record.md`",
                    "- Decision record present: `yes`",
                    "- Parsed decision: `keep`",
                    "",
                    "## Boundary",
                    "",
                    "This helper does not modify protected files, does not run autocomplete smoke, and does not decide whether existing source changes should be kept or reverted.",
                    "",
                ]
            ),
        ),
        "runtime": write(
            root / "runtime-intake.md",
            "\n".join(
                [
                    "# Runtime Smoke Intake Verify",
                    "",
                    "- Evidence directory: `/tmp/runtime`",
                    "- Requested ids: `S1,S2,S3,S4,S5,S6,S7,S8,S9,S10,S11,S12,S13,S14,S15,S16`",
                    "- Final status: `PASS`",
                    "",
                    "## Checks",
                    "- S1: PASS",
                    "- S16: PASS",
                    "- S16 source guard: PASS_WITH_LIMITS",
                    "",
                ]
            ),
        ),
        "windows": write(
            root / "windows-target-intake.md",
            "\n".join(
                [
                    "# ChipMate Offline Target Evidence Intake Verify",
                    "",
                    "- Target: `win32-x64`",
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
        ),
        "linux": write(
            root / "linux-target-intake.md",
            "\n".join(
                [
                    "# ChipMate Offline Target Evidence Intake Verify",
                    "",
                    "- Target: `linux-x64`",
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
        ),
        "internal": write(
            root / "internal-embedded-c.md",
            "\n".join(
                [
                    "# Internal Embedded-C Source-Backed Detail Design Intake Summary",
                    "",
                    "Status: `PASS`",
                    "Passed checks: `24`",
                    "Failed checks: `0`",
                    "",
                    "## Failed checks",
                    "- None",
                    "",
                    "## Passed checks",
                    "- evidence file found: internal-embedded-c-detail-design-evidence.md",
                    "- context filled: Installed VSIX profile",
                    "- context filled: VSIX version",
                    "- context filled: Source workspace",
                    "- context filled: Embedded C module",
                    "- context filled: Evidence date",
                    "- context filled: Operator",
                    "- status PASS: ChipMate native QA preserved",
                    "- status PASS: Source-backed detail-design skill selected",
                    "- status PASS: Current source evidence collected",
                    "- status PASS: Markdown detail design generated",
                    "- status PASS: Word detail design generated",
                    "- status PASS: At least one diagram generated",
                    "- status PASS: Quality report generated",
                    "- status PASS: Source evidence references present",
                    "- status PASS: Old ChipMate contract markers absent",
                    "- status PASS: No missing-diagram auto-repair triggered",
                    "- status PASS: No document-contract planning triggered when skill disabled",
                    "- no placeholder values remain",
                    "- no blocking text markers found",
                    "- generated Markdown artifacts: 1",
                    "- generated Word artifacts: 1",
                    "- generated diagram artifacts: 1",
                    "- quality report artifacts: 1",
                    "",
                ]
            ),
        ),
        "template": write(
            root / "company-template.md",
            "\n".join(
                [
                    "# Company DOCX Template Validation",
                    "",
                    "- Status: `PASS`",
                    "- Template: `/tmp/company-template.docx`",
                    "- Template size: `12345`",
                    "- Style count: `12`",
                    "",
                    "## Failures",
                    "- None",
                    "",
                    "## Warnings",
                    "- None",
                    "",
                    "## Boundary",
                    "",
                    "This helper validates a real .docx template or style source as OOXML input evidence only. It does not generate Word output, does not fill placeholders, does not require missing artifacts, does not run recipe repair, and does not decide installed chat/runtime S8 acceptance.",
                    "",
                ]
            ),
        ),
        "visible": write(
            root / "agent-terminal-visible-ux.md",
            "\n".join(
                [
                    "# Agent Terminal Visible UX Intake Summary",
                    "",
                    "Status: `PASS`",
                    "Passed checks: `18`",
                    "Failed checks: `0`",
                    "",
                    "## Failed checks",
                    "- None",
                    "",
                    "## Passed checks",
                    "- evidence file found: agent-terminal-visible-ux-evidence.md",
                    "- context filled: Installed VSIX profile",
                    "- context filled: VSIX version",
                    "- context filled: Workspace",
                    "- context filled: Evidence date",
                    "- context filled: Operator",
                    "- status PASS: Agent Terminal command visible",
                    "- status PASS: Default-off prompt visible",
                    "- status PASS: Workspace enable flow explicit",
                    "- status PASS: Terminal pane opens after enable",
                    "- status PASS: Native ChipMate terminal unaffected",
                    "- status PASS: Dangerous command confirmation visible",
                    "- status PASS: No destructive command executed without confirmation",
                    "- status PASS: Audit log or artifact path recorded",
                    "- status PASS: Old ChipMate contract markers absent",
                    "- no placeholder values remain",
                    "- no blocking text markers found",
                    "- attached evidence assets: 2",
                    "",
                ]
            ),
        ),
        "visible_self_check": write(
            root / "agent-terminal-visible-ux-self-check.md",
            "\n".join(
                [
                    "# M11 Visible Agent Terminal UX Gate Self-Check",
                    "",
                    "Status: `PASS`",
                    "Passed checks: `2`",
                    "Failed checks: `0`",
                    "",
                    "## Boundary",
                    "",
                    "This self-check uses synthetic evidence only. It proves readiness gate wiring, not real installed VS Code runtime behavior.",
                    "",
                ]
            ),
        ),
    }


def self_check(output: Path) -> int:
    passed: list[str] = []
    failed: list[str] = []

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        fixture = build_fixture(root)
        ready_summary = root / "ready-summary.md"
        missing_visible_summary = root / "missing-visible-summary.md"

        common = [
            "--s3-readiness",
            str(fixture["s3"]),
            "--s16-source-guard",
            str(fixture["s16"]),
            "--s16-decision-brief",
            str(fixture["decision"]),
            "--accept-s16-decision",
            "--installed-runtime-intake",
            str(fixture["runtime"]),
            "--windows-target-intake",
            str(fixture["windows"]),
            "--linux-target-intake",
            str(fixture["linux"]),
            "--internal-embedded-c-summary",
            str(fixture["internal"]),
            "--company-template-summary",
            str(fixture["template"]),
        ]

        ready_run = run_readiness(
            [
                *common,
                "--agent-terminal-visible-ux-intake",
                str(fixture["visible"]),
                "--output",
                str(ready_summary),
            ]
        )
        if ready_run.returncode == 0 and contains(ready_summary, "READY_FOR_M11_REVIEW") and contains(ready_summary, "Total gates: `8`"):
            passed.append("synthetic 8-gate PASS fixture reaches READY_FOR_M11_REVIEW")
        else:
            failed.append("synthetic 8-gate PASS fixture did not reach READY_FOR_M11_REVIEW")

        missing_run = run_readiness([*common, "--output", str(missing_visible_summary)])
        if missing_run.returncode != 0 and contains(missing_visible_summary, "NOT_READY_FOR_M11_REVIEW") and contains(
            missing_visible_summary, "Visible Agent Terminal UX"
        ):
            passed.append("missing visible Agent Terminal UX fixture is rejected")
        else:
            failed.append("missing visible Agent Terminal UX fixture was not rejected")

        self_check_summary = root / "self-check-visible-summary.md"
        self_check_run = run_readiness(
            [
                *common,
                "--agent-terminal-visible-ux-intake",
                str(fixture["visible_self_check"]),
                "--output",
                str(self_check_summary),
            ]
        )
        if self_check_run.returncode != 0 and contains(self_check_summary, "PASS_NEEDS_REVIEW"):
            passed.append("visible UX self-check summary is not accepted as real installed UX evidence")
        else:
            failed.append("visible UX self-check summary was incorrectly accepted")

        generic_runtime = write(root / "generic-runtime-pass.md", "# Runtime\n\n- Status: `PASS`\n")
        generic_runtime_summary = root / "generic-runtime-summary.md"
        generic_runtime_run = run_readiness(
            [
                "--s3-readiness",
                str(fixture["s3"]),
                "--s16-source-guard",
                str(fixture["s16"]),
                "--s16-decision-brief",
                str(fixture["decision"]),
                "--accept-s16-decision",
                "--installed-runtime-intake",
                str(generic_runtime),
                "--windows-target-intake",
                str(fixture["windows"]),
                "--linux-target-intake",
                str(fixture["linux"]),
                "--internal-embedded-c-summary",
                str(fixture["internal"]),
                "--company-template-summary",
                str(fixture["template"]),
                "--agent-terminal-visible-ux-intake",
                str(fixture["visible"]),
                "--output",
                str(generic_runtime_summary),
            ]
        )
        if generic_runtime_run.returncode != 0 and contains(generic_runtime_summary, "PASS_NEEDS_REVIEW"):
            passed.append("generic runtime PASS summary is not accepted as installed S1-S16 evidence")
        else:
            failed.append("generic runtime PASS summary was incorrectly accepted")

        generic_decision = write(root / "generic-s16-decision.md", "# Decision\n\n- Decision: keep\n")
        generic_decision_summary = root / "generic-decision-summary.md"
        generic_decision_run = run_readiness(
            [
                "--s3-readiness",
                str(fixture["s3"]),
                "--s16-source-guard",
                str(fixture["s16"]),
                "--s16-decision-brief",
                str(generic_decision),
                "--accept-s16-decision",
                "--installed-runtime-intake",
                str(fixture["runtime"]),
                "--windows-target-intake",
                str(fixture["windows"]),
                "--linux-target-intake",
                str(fixture["linux"]),
                "--internal-embedded-c-summary",
                str(fixture["internal"]),
                "--company-template-summary",
                str(fixture["template"]),
                "--agent-terminal-visible-ux-intake",
                str(fixture["visible"]),
                "--output",
                str(generic_decision_summary),
            ]
        )
        if generic_decision_run.returncode != 0 and contains(generic_decision_summary, "PASS_WITH_LIMITS_NEEDS_DECISION_REVIEW"):
            passed.append("generic S16 decision file is not accepted as typed autocomplete decision intake")
        else:
            failed.append("generic S16 decision file was incorrectly accepted")

    status = "PASS" if not failed else "FAIL"
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# M11 Visible Agent Terminal UX Gate Self-Check",
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
            "This self-check uses synthetic evidence only. It proves readiness gate wiring, not real installed VS Code runtime behavior.",
            "",
        ]
    )
    output.write_text("\n".join(lines), encoding="utf-8")
    print(f"Status: {status}")
    print(f"Summary: {output}")
    return 0 if status == "PASS" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output
    if not output.is_absolute():
        output = REPO_ROOT / output
    return self_check(output)


if __name__ == "__main__":
    raise SystemExit(main())
