#!/usr/bin/env python3
"""Self-check the conservative M11 final signoff intake.

This helper uses synthetic evidence to verify the final signoff intake logic:

- readiness READY + audit allowed yes/0 blockers + consistency PASS/0 failed
  + final review PASS -> READY_FOR_FINAL_SIGNOFF
- any critical gate not ready -> NOT_READY_FOR_FINAL_SIGNOFF

It does not execute tests, install VSIX files, package artifacts, or decide
real release acceptance.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SIGNOFF = REPO_ROOT / "docs/chipmate-feature-migration-m11-final-signoff-intake.py"


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def run_signoff(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SIGNOFF), *args],
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )


def contains(path: Path, needle: str) -> bool:
    return needle in path.read_text(encoding="utf-8", errors="replace")


def build_positive_fixture(root: Path) -> dict[str, Path]:
    return {
        "readiness": write(
            root / "readiness.md",
            "\n".join(
                [
                    "# M11 Readiness Intake",
                    "",
                    "- Overall status: `READY_FOR_M11_REVIEW`",
                    "- Ready gates: `8`",
                    "- Total gates: `8`",
                    "",
                ]
            ),
        ),
        "audit": write(
            root / "completion-audit.md",
            "\n".join(
                [
                    "# Completion Audit",
                    "",
                    "- Blockers: `0`",
                    "- Review items: `0`",
                    "- Completion allowed: `yes`",
                    "",
                ]
            ),
        ),
        "consistency": write(
            root / "consistency.md",
            "\n".join(
                [
                    "# Current State Consistency Check",
                    "",
                    "Status: `PASS`",
                    "Passed checks: `26`",
                    "Failed checks: `0`",
                    "",
                ]
            ),
        ),
        "review": write(
            root / "final-review.md",
            "\n".join(
                [
                    "# Final Review",
                    "",
                    "```text",
                    "PASS",
                    "```",
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
        fixture = build_positive_fixture(root)
        ready_summary = root / "ready-signoff.md"
        not_ready_summary = root / "not-ready-signoff.md"

        positive = run_signoff(
            [
                "--readiness",
                str(fixture["readiness"]),
                "--completion-audit",
                str(fixture["audit"]),
                "--consistency",
                str(fixture["consistency"]),
                "--final-review",
                str(fixture["review"]),
                "--output",
                str(ready_summary),
            ]
        )
        if positive.returncode == 0 and contains(ready_summary, "READY_FOR_FINAL_SIGNOFF"):
            passed.append("synthetic all-pass fixture reaches READY_FOR_FINAL_SIGNOFF")
        else:
            failed.append("synthetic all-pass fixture did not reach READY_FOR_FINAL_SIGNOFF")

        bad_audit = write(
            root / "bad-completion-audit.md",
            "\n".join(
                [
                    "# Completion Audit",
                    "",
                    "- Blockers: `1`",
                    "- Review items: `1`",
                    "- Completion allowed: `no`",
                    "",
                ]
            ),
        )
        negative = run_signoff(
            [
                "--readiness",
                str(fixture["readiness"]),
                "--completion-audit",
                str(bad_audit),
                "--consistency",
                str(fixture["consistency"]),
                "--final-review",
                str(fixture["review"]),
                "--output",
                str(not_ready_summary),
            ]
        )
        if negative.returncode != 0 and contains(not_ready_summary, "NOT_READY_FOR_FINAL_SIGNOFF"):
            passed.append("completion-audit blocker fixture is rejected")
        else:
            failed.append("completion-audit blocker fixture was not rejected")

    status = "PASS" if not failed else "FAIL"
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# M11 Final Signoff Self-Check",
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
            "This self-check uses synthetic evidence only. It proves final signoff gate wiring, not real installed VS Code runtime behavior or release acceptance.",
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
