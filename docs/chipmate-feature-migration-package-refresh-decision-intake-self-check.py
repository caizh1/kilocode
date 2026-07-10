#!/usr/bin/env python3
"""Self-check package refresh decision intake behavior."""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INTAKE = ROOT / "docs/chipmate-feature-migration-package-refresh-decision-intake.py"
BOUNDARY = (
    ROOT
    / "docs/chipmate-feature-migration-validation-runs/"
    "20260709-164000-package-refresh-boundary-check/"
    "summary.md"
)
DEFAULT_OUTPUT = (
    ROOT
    / "docs/chipmate-feature-migration-validation-runs/"
    "20260709-170500-package-refresh-decision-intake-self-check/"
    "summary.md"
)


def run_case(name: str, output_dir: Path, decision_text: str | None) -> tuple[str, int, str]:
    decision_path: Path | None = None
    if decision_text is not None:
        decision_path = output_dir / f"{name}-decision.md"
        decision_path.write_text(decision_text, encoding="utf-8")
    output = output_dir / f"{name}-summary.md"
    cmd = [
        sys.executable,
        str(INTAKE),
        "--boundary",
        str(BOUNDARY),
        "--output",
        str(output),
    ]
    if decision_path is not None:
        cmd.extend(["--decision", str(decision_path)])
    proc = subprocess.run(cmd, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    text = output.read_text(encoding="utf-8") if output.exists() else ""
    status = "UNKNOWN"
    for line in text.splitlines():
        if line.startswith("- Overall status:"):
            status = line.split("`", 2)[1] if "`" in line else line.split(":", 1)[1].strip()
            break
    return status, proc.returncode, proc.stdout + proc.stderr


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    cases = [
        ("missing-decision", None, "NEEDS_PACKAGE_REFRESH_DECISION", 1),
        (
            "missing-accepted-date",
            "Decision: REGENERATE_OFFLINE_PACKAGES\nAccepted by: migration-owner\n",
            "NEEDS_PACKAGE_REFRESH_DECISION",
            1,
        ),
        (
            "regenerate",
            "Decision: REGENERATE_OFFLINE_PACKAGES\nAccepted by: migration-owner\nAccepted date: 2026-07-09\n",
            "READY_FOR_PACKAGE_REFRESH_SCOPE",
            0,
        ),
        (
            "exclude-source-side",
            "Decision: EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT\nAccepted by: release-owner\nAccepted date: 2026-07-09\n",
            "READY_FOR_PACKAGE_REFRESH_SCOPE",
            0,
        ),
    ]

    passed: list[str] = []
    failed: list[str] = []
    with tempfile.TemporaryDirectory(prefix="package-refresh-decision-self-check-") as tmp:
        tmp_path = Path(tmp)
        for name, decision_text, expected_status, expected_rc in cases:
            status, rc, combined_output = run_case(name, tmp_path, decision_text)
            if status == expected_status and rc == expected_rc:
                passed.append(f"{name}: status {status}, rc {rc}")
            else:
                failed.append(
                    f"{name}: expected status {expected_status} rc {expected_rc}, got status {status} rc {rc}; output {combined_output[:400]}"
                )

    overall = "PASS" if not failed else "FAIL"
    lines = [
        "# Package Refresh Decision Intake Self-Check\n\n",
        f"- Status: `{overall}`\n",
        f"- Passed cases: `{len(passed)}`\n",
        f"- Failed cases: `{len(failed)}`\n",
        "- Missing decision returns NEEDS_PACKAGE_REFRESH_DECISION: `yes`\n"
        if any(item.startswith("missing-decision:") for item in passed)
        else "- Missing decision returns NEEDS_PACKAGE_REFRESH_DECISION: `no`\n",
        "- Missing accepted date returns NEEDS_PACKAGE_REFRESH_DECISION: `yes`\n"
        if any(item.startswith("missing-accepted-date:") for item in passed)
        else "- Missing accepted date returns NEEDS_PACKAGE_REFRESH_DECISION: `no`\n",
        "- REGENERATE_OFFLINE_PACKAGES accepted decision can pass: `yes`\n"
        if any(item.startswith("regenerate:") for item in passed)
        else "- REGENERATE_OFFLINE_PACKAGES accepted decision can pass: `no`\n",
        "- EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT accepted decision can pass: `yes`\n"
        if any(item.startswith("exclude-source-side:") for item in passed)
        else "- EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT accepted decision can pass: `no`\n",
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
        "This self-check validates decision intake behavior only. It does not rebuild packages, install VSIX files, run target OS evidence, execute S1-S16, or migrate ChipMate QA/contract/repair/gating behavior.\n"
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(lines), encoding="utf-8")
    print(f"Status: {overall}")
    print(f"Summary: {args.output}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
