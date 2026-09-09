#!/usr/bin/env python3
"""Generate the current M11 external-evidence action packet.

The packet tells external evidence owners what remains to return and which
typed verifier/receive commands to use. It does not run validations, install
VSIX files, execute target commands, modify autocomplete source, or decide M11
readiness/final signoff.
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


def packet_text() -> str:
    return """# M11 External Evidence Action Packet

This packet is the current execution checklist for the remaining ChipMate
non-QA migration evidence. It keeps ChipMate native QA intact and routes all
returned evidence through typed intake helpers before M11 review.

## Current status

- Current M11 readiness: `NOT_READY_FOR_M11_REVIEW`
- Current final signoff: `NOT_READY_FOR_FINAL_SIGNOFF`
- Current completion audit: `Completion allowed: no`
- Current external evidence receive quickstart: `docs/chipmate-feature-migration-m11-returned-evidence-receive-quickstart.md`

## Required returned evidence

| Gate | Owner action | Required output |
|---|---|---|
| S3 Document RAG | Restore embedding/indexing provider readiness, then rerun S3 readiness smoke. | `document-rag-readiness-summary.md` with `Status: PASS`, `document_search used: yes`, and `provider/readiness failure detected: no`. |
| S16 autocomplete | Make an explicit product decision through the typed decision intake. Do not edit protected Qwen autocomplete files in this packet. | `s16/current-summary.md` with `READY_FOR_READONLY_S16_SMOKE`, then run read-only S16 smoke. |
| Installed runtime S1-S16 | Run installed VSIX runtime smoke, manually accept answer/tool/artifact quality, then run runtime smoke intake. | `installed-runtime/runtime-intake-summary.md` with `Final status: PASS`. |
| Offline Windows x86-64 | Run target-side Windows package/runtime evidence and target intake. | `windows-target/target-intake-summary.md` with `Final status: PASS`. |
| Offline Linux x86-64 | Run target-side Linux package/runtime evidence and target intake. | `linux-target/target-intake-summary.md` with `Final status: PASS`. |
| Internal embedded-C detail design | Run installed source-backed detail-design flow on one representative internal embedded-C module, then run internal intake. | `internal-embedded-c/summary.md` with `Status: PASS`. |
| Company DOCX template | Validate a real company `.docx` style/template source and generated ChipMate output. | `company-template/summary.md` with `Status: PASS`, or explicitly accepted `PASS_WITH_LIMITS`. |

## Standard return workflow

```bash
python3 docs/chipmate-feature-migration-m11-returned-evidence-bundle-template.py \\
  --output-dir /tmp/chipmate-m11-returned-evidence-bundle \\
  --force

# Replace all PENDING placeholders with typed verifier outputs.

cd /tmp
tar -czf chipmate-m11-returned-evidence-bundle.tar.gz chipmate-m11-returned-evidence-bundle

python3 docs/chipmate-feature-migration-m11-returned-evidence-receive.py \\
  --bundle /tmp/chipmate-m11-returned-evidence-bundle.tar.gz \\
  --output-dir docs/chipmate-feature-migration-validation-runs/<stamp>-m11-returned-evidence-receive \\
  --accept-s16-decision
```

Only add `--accept-company-template-pass-with-limits` after manual review
accepts the company template limitation.

## Source-side receiving order

1. Generate the returned-evidence bundle template.
2. Replace placeholders with typed verifier outputs.
3. Package the bundle.
4. Run the receive wrapper.
5. Use the generated readiness summary as input to M11 final review.
6. Run final signoff intake only after readiness, completion audit,
   current-state consistency, and manual final review are all ready.

## Boundary

This packet does not migrate QA, does not replace ChipMate native code
understanding, does not run target-machine commands, does not modify protected
Qwen autocomplete files, does not generate Word output, does not trigger missing-diagram repair,
does not trigger document-contract planning, and does
not accept `nextToolContract`, `missingDeliverable`, or `validate_artifacts` as
migration evidence.
"""


def write_packet(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(packet_text(), encoding="utf-8")


def evaluate(text: str) -> SelfCheckResult:
    required = [
        "S3 Document RAG",
        "document_search used: yes",
        "S16 autocomplete",
        "READY_FOR_READONLY_S16_SMOKE",
        "Installed runtime S1-S16",
        "Offline Windows x86-64",
        "Offline Linux x86-64",
        "Internal embedded-C detail design",
        "Company DOCX template",
        "chipmate-feature-migration-m11-returned-evidence-bundle-template.py",
        "chipmate-feature-migration-m11-returned-evidence-receive.py",
        "--accept-s16-decision",
        "does not migrate QA",
        "does not modify protected",
        "does not trigger missing-diagram repair",
        "does not trigger document-contract planning",
        "nextToolContract",
        "missingDeliverable",
        "validate_artifacts",
    ]
    passed: list[str] = []
    failed: list[str] = []
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
        "# M11 External Evidence Action Packet Self-Check",
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
            "This self-check validates action-packet text only. It does not execute validations and does not decide M11 readiness or final signoff.",
            "",
        ]
    )
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-check-output", type=Path)
    args = parser.parse_args()

    output = args.output or Path("docs/chipmate-feature-migration-m11-external-evidence-action-packet.md")
    if not output.is_absolute():
        output = REPO_ROOT / output
    write_packet(output)
    print(f"Action packet: {output}")

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
