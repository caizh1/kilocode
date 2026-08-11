#!/usr/bin/env python3
"""Generate a quickstart for receiving M11 returned evidence.

The quickstart is operator-facing documentation. It does not run ChipMate QA,
install VSIX files, execute target commands, run autocomplete, generate Word
output, or decide M11 readiness/final signoff.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class SelfCheckResult:
    status: str
    passed: list[str]
    failed: list[str]


def quickstart_text() -> str:
    return """# M11 Returned Evidence Receive Quickstart

This quickstart standardizes how external evidence is returned and received for
the ChipMate non-QA migration to ChipMate-code.

## 1. Generate a skeleton bundle

```bash
python3 docs/chipmate-feature-migration-m11-returned-evidence-bundle-template.py \\
  --output-dir /tmp/chipmate-m11-returned-evidence-bundle \\
  --force
```

The generated bundle is a template only. Do not change `PENDING` placeholders to
`PASS` by hand.

## 2. Replace placeholders with typed verifier outputs

Use these producer commands to replace the placeholder summary files:

```bash
python3 docs/chipmate-feature-migration-s16-decision-intake.py \\
  --decision-record <decision-record.md> \\
  --output /tmp/chipmate-m11-returned-evidence-bundle/s16/current-summary.md

python3 docs/chipmate-feature-migration-runtime-smoke-intake-verify.py \\
  --runtime-evidence <runtime-run-dir> \\
  --output /tmp/chipmate-m11-returned-evidence-bundle/installed-runtime/runtime-intake-summary.md

python3 docs/chipmate-feature-migration-target-evidence-intake-verify.py \\
  --target win32-x64 \\
  --package-evidence <windows-package-evidence-dir> \\
  --runtime-evidence <windows-runtime-evidence-dir> \\
  --output /tmp/chipmate-m11-returned-evidence-bundle/windows-target/target-intake-summary.md

python3 docs/chipmate-feature-migration-target-evidence-intake-verify.py \\
  --target linux-x64 \\
  --package-evidence <linux-package-evidence-dir> \\
  --runtime-evidence <linux-runtime-evidence-dir> \\
  --output /tmp/chipmate-m11-returned-evidence-bundle/linux-target/target-intake-summary.md

python3 docs/chipmate-feature-migration-internal-embedded-c-intake.py \\
  --evidence-dir <internal-embedded-c-evidence-dir> \\
  --output /tmp/chipmate-m11-returned-evidence-bundle/internal-embedded-c/summary.md

python3 docs/chipmate-feature-migration-company-docx-template-validate.py \\
  --template-docx <company-template.docx> \\
  --generated-docx <generated-docx-from-chipmate.docx> \\
  --output /tmp/chipmate-m11-returned-evidence-bundle/company-template/summary.md

python3 docs/chipmate-feature-migration-agent-terminal-visible-ux-intake.py \\
  --evidence-dir <agent-terminal-visible-ux-evidence-dir> \\
  --output /tmp/chipmate-m11-returned-evidence-bundle/agent-terminal-visible-ux/summary.md
```

## 3. Package the bundle for return

```bash
cd /tmp
tar -czf chipmate-m11-returned-evidence-bundle.tar.gz chipmate-m11-returned-evidence-bundle
```

## 4. Receive the returned bundle

```bash
python3 docs/chipmate-feature-migration-m11-returned-evidence-receive.py \\
  --bundle /tmp/chipmate-m11-returned-evidence-bundle.tar.gz \\
  --output-dir docs/chipmate-feature-migration-validation-runs/<stamp>-m11-returned-evidence-receive \\
  --accept-s16-decision
```

Only use `--accept-s16-decision` after the typed S16 decision intake shows a
real accepted decision. If the company template summary is `PASS_WITH_LIMITS`,
add `--accept-company-template-pass-with-limits` only after manual acceptance.

## 5. Continue M11 signoff only after receive passes

The receive helper runs archive verification first and then delegates to bundle
intake. A receive `PASS` means the returned evidence is ready for M11 readiness
review; it is not final signoff.

## Boundary

This quickstart does not migrate QA, does not run ChipMate QA, does not execute
target-machine commands, does not run autocomplete, does not generate Word
output, does not run missing-diagram repair, does not trigger document-contract planning,
and does not accept `nextToolContract`, `missingDeliverable`, or
`validate_artifacts` as migration evidence.
"""


def write_quickstart(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(quickstart_text(), encoding="utf-8")


def evaluate(text: str) -> SelfCheckResult:
    passed: list[str] = []
    failed: list[str] = []
    required = [
        "chipmate-feature-migration-m11-returned-evidence-bundle-template.py",
        "chipmate-feature-migration-s16-decision-intake.py",
        "chipmate-feature-migration-runtime-smoke-intake-verify.py",
        "chipmate-feature-migration-target-evidence-intake-verify.py",
        "chipmate-feature-migration-internal-embedded-c-intake.py",
        "chipmate-feature-migration-company-docx-template-validate.py",
        "chipmate-feature-migration-agent-terminal-visible-ux-intake.py",
        "chipmate-feature-migration-m11-returned-evidence-receive.py",
        "--accept-s16-decision",
        "not final signoff",
        "does not migrate QA",
        "does not run missing-diagram repair",
        "does not trigger document-contract planning",
        "nextToolContract",
        "missingDeliverable",
        "validate_artifacts",
    ]
    for needle in required:
        if needle in text:
            passed.append(f"required text present: {needle}")
        else:
            failed.append(f"required text missing: {needle}")
    status = "PASS" if not failed else "FAIL"
    return SelfCheckResult(status, passed, failed)


def write_summary(result: SelfCheckResult, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# M11 Returned Evidence Receive Quickstart Self-Check",
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
            "This self-check validates quickstart text only. It does not execute the returned-evidence receive flow and does not decide M11 readiness or final signoff.",
            "",
        ]
    )
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-check-output", type=Path)
    args = parser.parse_args()

    output = args.output or Path("docs/chipmate-feature-migration-m11-returned-evidence-receive-quickstart.md")
    if not output.is_absolute():
        output = REPO_ROOT / output
    write_quickstart(output)
    print(f"Quickstart: {output}")

    if args.self_check_output:
        summary = args.self_check_output
        if not summary.is_absolute():
            summary = REPO_ROOT / summary
        result = evaluate(output.read_text(encoding="utf-8"))
        write_summary(result, summary)
        print(f"Status: {result.status}")
        print(f"Summary: {summary}")
        return 0 if result.status == "PASS" else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
