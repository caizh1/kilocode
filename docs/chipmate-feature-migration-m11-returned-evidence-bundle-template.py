#!/usr/bin/env python3
"""Create a template M11 returned-evidence bundle.

The generated bundle is a skeleton for external evidence return. It is not
acceptance evidence by itself: placeholder summaries are intentionally marked
PENDING so the bundle intake rejects the skeleton until typed verifiers produce
real PASS summaries.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BUNDLE_INTAKE = REPO_ROOT / "docs/chipmate-feature-migration-m11-returned-evidence-bundle-intake.py"

BUNDLE_FILES = {
    "s16-decision-intake": ("s16", "current-summary.md"),
    "installed-runtime-intake": ("installed-runtime", "runtime-intake-summary.md"),
    "windows-target-intake": ("windows-target", "target-intake-summary.md"),
    "linux-target-intake": ("linux-target", "target-intake-summary.md"),
    "internal-embedded-c-intake": ("internal-embedded-c", "summary.md"),
    "company-template-summary": ("company-template", "summary.md"),
    "agent-terminal-visible-ux-intake": ("agent-terminal-visible-ux", "summary.md"),
}


@dataclass(frozen=True)
class TemplateResult:
    status: str
    passed: list[str]
    failed: list[str]


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def placeholder_summary(title: str, command: str, boundary: str) -> str:
    return "\n".join(
        [
            f"# {title}",
            "",
            "- Status: `PENDING`",
            "- This is a returned-evidence bundle template placeholder.",
            "- Replace this file by running the typed verifier command below.",
            "",
            "## Command",
            "",
            "```bash",
            command,
            "```",
            "",
            "## Boundary",
            "",
            boundary,
            "",
        ]
    )


def create_template(output_dir: Path, force: bool = False) -> None:
    if output_dir.exists() and any(output_dir.iterdir()):
        if not force:
            raise SystemExit(f"output directory is not empty: {output_dir}; use --force to replace it")
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    write(
        output_dir / "README.md",
        "\n".join(
            [
                "# M11 Returned Evidence Bundle Template",
                "",
                "Fill this bundle with typed verifier outputs, then run:",
                "",
                "```bash",
                "python3 docs/chipmate-feature-migration-m11-returned-evidence-bundle-intake.py \\",
                "  --bundle-dir <this-bundle> \\",
                "  --output-dir docs/chipmate-feature-migration-validation-runs/<stamp>-m11-returned-evidence-bundle-intake \\",
                "  --accept-s16-decision",
                "```",
                "",
                "Do not edit a placeholder from `PENDING` to `PASS` by hand. Replace placeholders with typed verifier outputs.",
                "",
                "## Expected files",
                "",
                "| Evidence | Required file | Producer |",
                "|---|---|---|",
                "| S16 decision | `s16/current-summary.md` | `chipmate-feature-migration-s16-decision-intake.py` |",
                "| Installed runtime S1-S16 | `installed-runtime/runtime-intake-summary.md` | `chipmate-feature-migration-runtime-smoke-intake-verify.py` |",
                "| Windows target | `windows-target/target-intake-summary.md` | `chipmate-feature-migration-target-evidence-intake-verify.py --target win32-x64` |",
                "| Linux target | `linux-target/target-intake-summary.md` | `chipmate-feature-migration-target-evidence-intake-verify.py --target linux-x64` |",
                "| Internal embedded-C detail design | `internal-embedded-c/summary.md` | `chipmate-feature-migration-internal-embedded-c-intake.py` |",
                "| Company DOCX template | `company-template/summary.md` | `chipmate-feature-migration-company-docx-template-validate.py` |",
                "| Visible Agent Terminal UX | `agent-terminal-visible-ux/summary.md` | `chipmate-feature-migration-agent-terminal-visible-ux-intake.py` |",
                "",
                "## Boundary",
                "",
                "This template does not run Kilo QA, does not execute target-machine commands, does not install VSIX files, does not run autocomplete, does not generate Word output, and does not accept ChipMate document-contract planning or missing-diagram auto-repair as evidence.",
                "",
            ]
        ),
    )

    placeholders = {
        "s16-decision-intake": placeholder_summary(
            "S16 Autocomplete Decision Intake",
            "python3 docs/chipmate-feature-migration-s16-decision-intake.py --decision-record <decision-record.md> --output <bundle>/s16/current-summary.md",
            "Typed S16 decision intake only. Generic Decision: keep files are not accepted by M11 readiness.",
        ),
        "installed-runtime-intake": placeholder_summary(
            "Runtime Smoke Intake Verify",
            "python3 docs/chipmate-feature-migration-runtime-smoke-intake-verify.py --runtime-evidence <runtime-run-dir> --output <bundle>/installed-runtime/runtime-intake-summary.md",
            "Verifier summary only. It does not run S1-S16; it validates returned S1-S16 evidence.",
        ),
        "windows-target-intake": placeholder_summary(
            "ChipMate Offline Target Evidence Intake Verify",
            "python3 docs/chipmate-feature-migration-target-evidence-intake-verify.py --target win32-x64 --package-evidence <package-evidence-dir> --runtime-evidence <runtime-evidence-dir> --output <bundle>/windows-target/target-intake-summary.md",
            "Windows target evidence must come from target-side package/runtime evidence, not local assumptions.",
        ),
        "linux-target-intake": placeholder_summary(
            "ChipMate Offline Target Evidence Intake Verify",
            "python3 docs/chipmate-feature-migration-target-evidence-intake-verify.py --target linux-x64 --package-evidence <package-evidence-dir> --runtime-evidence <runtime-evidence-dir> --output <bundle>/linux-target/target-intake-summary.md",
            "Linux target evidence must come from target-side package/runtime evidence, not local assumptions.",
        ),
        "internal-embedded-c-intake": placeholder_summary(
            "Internal Embedded-C Source-Backed Detail Design Intake Summary",
            "python3 docs/chipmate-feature-migration-internal-embedded-c-intake.py --evidence-dir <internal-evidence-dir> --output <bundle>/internal-embedded-c/summary.md",
            "Returned internal project evidence only. This does not run the source-backed skill or generate artifacts.",
        ),
        "company-template-summary": placeholder_summary(
            "Company DOCX Template Validation",
            "python3 docs/chipmate-feature-migration-company-docx-template-validate.py --template-docx <company-template.docx> --generated-docx <generated.docx> --output <bundle>/company-template/summary.md",
            "Company template OOXML/style evidence only. Placeholder filling is outside this acceptance gate.",
        ),
        "agent-terminal-visible-ux-intake": placeholder_summary(
            "Agent Terminal Visible UX Intake Summary",
            "python3 docs/chipmate-feature-migration-agent-terminal-visible-ux-intake.py --evidence-dir <visible-ux-evidence-dir> --output <bundle>/agent-terminal-visible-ux/summary.md",
            "Returned installed VS Code visible UX evidence only. Self-check summaries are not accepted.",
        ),
    }

    for key, parts in BUNDLE_FILES.items():
        write(output_dir.joinpath(*parts), placeholders[key])


def run_intake(bundle_dir: Path, output_dir: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(BUNDLE_INTAKE),
            "--bundle-dir",
            str(bundle_dir),
            "--output-dir",
            str(output_dir),
            "--accept-s16-decision",
        ],
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )


def self_check(output_dir: Path) -> int:
    passed: list[str] = []
    failed: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        bundle = root / "template"
        intake_out = root / "intake-out"
        create_template(bundle)
        for key, parts in BUNDLE_FILES.items():
            path = bundle.joinpath(*parts)
            if path.is_file() and "Status: `PENDING`" in path.read_text(encoding="utf-8"):
                passed.append(f"placeholder present and pending: {key}")
            else:
                failed.append(f"placeholder missing or not pending: {key}")
        run = run_intake(bundle, intake_out)
        summary = intake_out / "summary.md"
        summary_text = summary.read_text(encoding="utf-8", errors="replace") if summary.is_file() else ""
        if run.returncode != 0 and "Status: `NOT_READY_FOR_M11_REVIEW`" in summary_text:
            passed.append("template skeleton is rejected by returned-evidence bundle intake")
        else:
            failed.append("template skeleton was incorrectly accepted by returned-evidence bundle intake")

    status = "PASS" if not failed else "FAIL"
    output_dir.mkdir(parents=True, exist_ok=True)
    lines = [
        "# M11 Returned Evidence Bundle Template Self-Check",
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
            "This self-check proves the generated template has the required bundle layout and is rejected until placeholders are replaced by typed verifier outputs.",
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
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()

    output_dir = args.output_dir.resolve()
    if args.self_check:
        return self_check(output_dir)
    create_template(output_dir, args.force)
    print(f"Template: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
