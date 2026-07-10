#!/usr/bin/env python3
"""Self-check that M11 final signoff enforces package refresh decision."""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SIGNOFF = ROOT / "docs/chipmate-feature-migration-m11-final-signoff-intake.py"
DEFAULT_OUTPUT = (
    ROOT
    / "docs/chipmate-feature-migration-validation-runs/"
    "20260709-171500-m11-final-signoff-package-gate-self-check/"
    "summary.md"
)


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def run_signoff(tmp: Path, name: str, package_summary: Path | None) -> tuple[str, int, str]:
    readiness = write(
        tmp / f"{name}-readiness.md",
        "# M11 Readiness Intake\n\n"
        "- Overall status: `READY_FOR_M11_REVIEW`\n"
        "- Ready gates: `8`\n"
        "- Total gates: `8`\n",
    )
    audit = write(
        tmp / f"{name}-audit.md",
        "# Completion Audit\n\n"
        "- Blockers: `0`\n"
        "- Review items: `0`\n"
        "- Completion allowed: `yes`\n",
    )
    consistency = write(
        tmp / f"{name}-consistency.md",
        "# Current State Consistency Check\n\n"
        "Status: `PASS`\n"
        "Failed checks: `0`\n",
    )
    final_review = write(
        tmp / f"{name}-final-review.md",
        "# Final Review\n\n"
        "```text\n"
        "PASS\n"
        "```\n",
    )
    output = tmp / f"{name}-signoff.md"
    cmd = [
        sys.executable,
        str(SIGNOFF),
        "--readiness",
        str(readiness),
        "--completion-audit",
        str(audit),
        "--consistency",
        str(consistency),
        "--final-review",
        str(final_review),
        "--output",
        str(output),
    ]
    if package_summary is not None:
        cmd.extend(["--package-refresh-decision", str(package_summary)])
    proc = subprocess.run(cmd, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    text = output.read_text(encoding="utf-8") if output.exists() else ""
    status = "UNKNOWN"
    for line in text.splitlines():
        if line.startswith("- Overall status:"):
            status = line.split("`", 2)[1] if "`" in line else line.split(":", 1)[1].strip()
            break
    return status, proc.returncode, text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    passed: list[str] = []
    failed: list[str] = []
    with tempfile.TemporaryDirectory(prefix="m11-final-signoff-package-gate-") as tmpdir:
        tmp = Path(tmpdir)
        needs_decision = write(
            tmp / "package-needs-decision.md",
            "# Package Refresh Decision Intake\n\n"
            "- Overall status: `NEEDS_PACKAGE_REFRESH_DECISION`\n"
            "- Decision: `MISSING`\n"
            "- Accepted by: `MISSING`\n",
        )
        ready_decision = write(
            tmp / "package-ready.md",
            "# Package Refresh Decision Intake\n\n"
            "- Overall status: `READY_FOR_PACKAGE_REFRESH_SCOPE`\n"
            "- Decision: `REGENERATE_OFFLINE_PACKAGES`\n"
            "- Accepted by: `release-owner`\n",
        )

        cases = [
            ("missing-package-decision", None, "NOT_READY_FOR_FINAL_SIGNOFF", 1),
            ("needs-package-decision", needs_decision, "NOT_READY_FOR_FINAL_SIGNOFF", 1),
            ("ready-package-decision", ready_decision, "READY_FOR_FINAL_SIGNOFF", 0),
        ]
        for name, package_summary, expected_status, expected_rc in cases:
            status, rc, summary = run_signoff(tmp, name, package_summary)
            has_package_gate = "Package refresh decision" in summary
            if status == expected_status and rc == expected_rc and has_package_gate:
                passed.append(f"{name}: status {status}, rc {rc}, package gate present")
            else:
                failed.append(
                    f"{name}: expected status {expected_status} rc {expected_rc} with package gate, got status {status} rc {rc}, package gate {has_package_gate}"
                )

    overall = "PASS" if not failed else "FAIL"
    lines = [
        "# M11 Final Signoff Package Gate Self-Check\n\n",
        f"- Status: `{overall}`\n",
        f"- Passed cases: `{len(passed)}`\n",
        f"- Failed cases: `{len(failed)}`\n",
        "- Missing package refresh decision blocks final signoff: `yes`\n"
        if any(item.startswith("missing-package-decision:") for item in passed)
        else "- Missing package refresh decision blocks final signoff: `no`\n",
        "- NEEDS_PACKAGE_REFRESH_DECISION blocks final signoff: `yes`\n"
        if any(item.startswith("needs-package-decision:") for item in passed)
        else "- NEEDS_PACKAGE_REFRESH_DECISION blocks final signoff: `no`\n",
        "- READY_FOR_PACKAGE_REFRESH_SCOPE can pass final signoff when other gates pass: `yes`\n"
        if any(item.startswith("ready-package-decision:") for item in passed)
        else "- READY_FOR_PACKAGE_REFRESH_SCOPE can pass final signoff when other gates pass: `no`\n",
        "\n",
        "## Passed cases\n\n",
    ]
    lines.extend(f"- {item}\n" for item in passed)
    lines.append("\n## Failed cases\n\n")
    if failed:
        lines.extend(f"- {item}\n" for item in failed)
    else:
        lines.append("- None\n")
    lines.append("\n## Boundary\n\n")
    lines.append(
        "This self-check validates final signoff gate behavior only. It uses synthetic evidence, does not rebuild packages, does not install VSIX files, does not run target OS evidence, does not execute S1-S16, and does not migrate ChipMate QA or contract/repair/gating behavior.\n"
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(lines), encoding="utf-8")
    print(f"Status: {overall}")
    print(f"Summary: {args.output}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
