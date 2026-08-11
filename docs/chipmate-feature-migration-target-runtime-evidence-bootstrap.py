#!/usr/bin/env python3
"""
Bootstrap offline target runtime evidence files for ChipMate migration S1-S16.

This helper does not execute ChipMate, VS Code, QA, Word, Mermaid, autocomplete, or
Agent Terminal flows. It only creates a conservative, machine-readable evidence
skeleton so target operators can fill real results and then run the strict
runtime/target intake verifiers.

Default output is intentionally NOT_RUN/PARTIAL so it cannot be mistaken for
runtime acceptance. The --all-pass-for-fixture switch exists only for verifier
self-check fixtures.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path


VERSION = "0.0.38"
S_CASES = [
    ("S1", "Native C QA call chain", "Expected native ChipMate code understanding; no Word/Mermaid/artifact tools"),
    ("S2", "Macro/register QA", "Expected native search/code understanding tools"),
    ("S3", "Document RAG QA", "Expected document_search path"),
    ("S4", "Artifact create/list", "Expected artifact manifest and open/list behavior"),
    ("S5", "Word create", "Expected .docx artifact"),
    ("S6", "Word edit/add table", "Expected new .docx artifact and source backup"),
    ("S7", "Word delete dry-run", "Expected dry-run impact only before apply"),
    ("S8", "Word template", "Expected style inheritance or scoped warning"),
    ("S9", "Word merge/diff", "Expected bounded summary and artifact paths"),
    ("S10", "Word render", "Expected render artifact or endpoint-unconfigured warning"),
    ("S11", "Mermaid PNG", "Expected .mmd/.png/diagnostics artifact"),
    ("S12", "Mermaid inserted into Word", "Expected new Word artifact with figure"),
    ("S13", "Source-backed detail design", "Expected evidence, diagrams, Word output, quality report"),
    ("S14", "Agent Terminal open", "Expected default-off prompt or enabled terminal open"),
    ("S15", "Agent Terminal dangerous command", "Expected explicit confirmation requirement"),
    ("S16", "Qwen direct autocomplete", "Expected provider still registers and diagnostics/log command works"),
]
VALID_STATUSES = {"PASS", "FAIL", "BLOCKED_AUTH", "BLOCKED_ENV", "PARTIAL", "NOT_RUN"}


def read_template(path: Path) -> str:
    if not path.is_file():
        raise SystemExit(f"target evidence return template not found: {path}")
    return path.read_text(encoding="utf-8", errors="replace")


def replace_table_cell(text: str, field: str, value: str) -> str:
    pattern = re.compile(rf"(?m)^(\|\s*{re.escape(field)}\s*\|\s*)([^|]*)(\|.*)$")
    return pattern.sub(lambda match: f"{match.group(1)}{value} {match.group(3)}", text, count=1)


def update_runtime_rows(text: str, status: str) -> str:
    for sid, _scope, notes in S_CASES:
        pattern = re.compile(rf"(?m)^(\|\s*{sid}\s*\|[^|]*\|)\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|$")
        replacement = rf"\1 {status} | evidence/{sid}.md | {notes} |"
        text = pattern.sub(replacement, text, count=1)
    return text


def write_runtime_tsv(path: Path, status: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["id", "scope", "status", "evidence_path", "notes"], delimiter="\t")
        writer.writeheader()
        for sid, scope, notes in S_CASES:
            writer.writerow(
                {
                    "id": sid,
                    "scope": scope,
                    "status": status,
                    "evidence_path": f"evidence/{sid}.md",
                    "notes": notes,
                }
            )


def write_case_placeholders(evidence_dir: Path, status: str) -> None:
    evidence_dir.mkdir(parents=True, exist_ok=True)
    for sid, scope, notes in S_CASES:
        (evidence_dir / f"{sid}.md").write_text(
            "\n".join(
                [
                    f"# {sid} {scope}",
                    "",
                    f"- Status: `{status}`",
                    "- Evidence: TODO",
                    f"- Expected boundary: {notes}",
                    "",
                    "Replace this placeholder with real target-machine logs, screenshots, artifact paths, or provider/auth errors before final intake.",
                    "",
                ]
            ),
            encoding="utf-8",
        )


def write_summary(path: Path, target: str, status: str, overall: str, output_dir: Path) -> None:
    lines = [
        "# Target Runtime Evidence Bootstrap",
        "",
        f"- Version: `{VERSION}`",
        f"- Target: `{target}`",
        f"- Generated S1-S16 status: `{status}`",
        f"- Generated return-template overall status: `{overall}`",
        f"- Output directory: `{output_dir}`",
        "",
        "## Generated files",
        "",
        "- `runtime-smoke.tsv`",
        "- `chipmate-feature-migration-target-evidence-return-template.md`",
        "- `evidence/S1.md` ... `evidence/S16.md`",
        "",
        "## Next verifier commands",
        "",
        "```bash",
        "python3 chipmate-feature-migration-runtime-smoke-intake-verify.py \\",
        "  --runtime-evidence <this-output-dir> \\",
        "  --output <this-output-dir>/runtime-intake-summary.md",
        "",
        "python3 chipmate-feature-migration-target-evidence-intake-verify.py \\",
        "  --target <linux-x64|win32-x64> \\",
        "  --package-evidence <package-evidence-dir> \\",
        "  --runtime-evidence <this-output-dir> \\",
        "  --output <this-output-dir>/target-intake-summary.md",
        "```",
        "",
        "## Boundary",
        "",
        "This helper only creates evidence files. It does not execute runtime smoke and does not replace M11 review. Default NOT_RUN output must remain incomplete until real target-machine results are filled and verified.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["linux-x64", "win32-x64"], required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--template-source", type=Path)
    parser.add_argument("--status", choices=sorted(VALID_STATUSES), default="NOT_RUN")
    parser.add_argument("--overall-status", choices=["PASS", "PARTIAL", "BLOCKED_AUTH", "BLOCKED_ENV", "FAIL"], default="PARTIAL")
    parser.add_argument("--all-pass-for-fixture", action="store_true", help="Generate PASS statuses for verifier self-check fixtures only.")
    args = parser.parse_args()

    status = "PASS" if args.all_pass_for_fixture else args.status
    overall = "PASS" if args.all_pass_for_fixture else args.overall_status

    template_source = args.template_source or Path(__file__).with_name("chipmate-feature-migration-target-evidence-return-template.md")
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    template = read_template(template_source)
    template = replace_table_cell(template, "Target platform", args.target)
    template = replace_table_cell(template, "Verification date", "TODO")
    template = replace_table_cell(template, "Overall target status", overall)
    template = update_runtime_rows(template, status)

    write_runtime_tsv(output_dir / "runtime-smoke.tsv", status)
    write_case_placeholders(output_dir / "evidence", status)
    (output_dir / "chipmate-feature-migration-target-evidence-return-template.md").write_text(template, encoding="utf-8")
    write_summary(output_dir / "bootstrap-summary.md", args.target, status, overall, output_dir)

    print(f"Wrote target runtime evidence skeleton to {output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
