#!/usr/bin/env python3
"""Receive a returned M11 evidence bundle.

The receive flow is intentionally fail-closed:

1. verify bundle archive/directory structure and placeholders
2. extract archives into the run directory when needed
3. run returned-evidence bundle intake only after structure verification passes

This helper does not run ChipMate QA, install VSIX files, execute target-machine
commands, run autocomplete, generate Word output, or decide final signoff.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_VERIFY = REPO_ROOT / "docs/chipmate-feature-migration-m11-returned-evidence-bundle-archive-verify.py"
BUNDLE_INTAKE = REPO_ROOT / "docs/chipmate-feature-migration-m11-returned-evidence-bundle-intake.py"


def markdown_value(text: str, label: str) -> str | None:
    match = re.search(rf"(?im)^\s*[-*]?\s*{re.escape(label)}\s*:\s*`?([^`\n]+?)`?\s*$", text)
    if match:
        return match.group(1).strip()
    return None


def safe_member_name(name: str) -> bool:
    path = Path(name)
    return not path.is_absolute() and ".." not in path.parts


def extract_bundle(bundle: Path, extract_dir: Path) -> Path:
    if bundle.is_dir():
        return bundle.resolve()
    if extract_dir.exists():
        shutil.rmtree(extract_dir)
    extract_dir.mkdir(parents=True, exist_ok=True)
    lower = bundle.name.lower()
    if lower.endswith(".zip"):
        with zipfile.ZipFile(bundle) as archive:
            bad = [name for name in archive.namelist() if not safe_member_name(name)]
            if bad:
                raise SystemExit(f"unsafe zip member(s): {bad[:3]}")
            archive.extractall(extract_dir)
    elif lower.endswith((".tar", ".tar.gz", ".tgz")):
        with tarfile.open(bundle) as archive:
            bad = [member.name for member in archive.getmembers() if not safe_member_name(member.name)]
            if bad:
                raise SystemExit(f"unsafe tar member(s): {bad[:3]}")
            archive.extractall(extract_dir)
    else:
        raise SystemExit(f"unsupported bundle path: {bundle}")

    children = [child for child in extract_dir.iterdir() if child.name not in {"__MACOSX", ".DS_Store"}]
    if len(children) == 1 and children[0].is_dir():
        return children[0]
    return extract_dir


def run_command(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )


def run_receive(args: argparse.Namespace) -> int:
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    bundle = args.bundle.resolve()
    archive_summary = output_dir / "archive-verify-summary.md"
    intake_dir = output_dir / "bundle-intake"
    intake_summary = intake_dir / "summary.md"
    extracted_bundle = output_dir / "extracted-bundle"

    archive_run = run_command(
        [
            sys.executable,
            str(ARCHIVE_VERIFY),
            "--bundle",
            str(bundle),
            "--output",
            str(archive_summary),
        ]
    )
    archive_text = archive_summary.read_text(encoding="utf-8", errors="replace") if archive_summary.is_file() else ""
    archive_status = markdown_value(archive_text, "Status") or "MISSING"

    intake_run: subprocess.CompletedProcess[str] | None = None
    intake_status = "SKIPPED"
    intake_bundle = ""
    if archive_status == "PASS":
        intake_bundle_path = extract_bundle(bundle, extracted_bundle)
        intake_bundle = str(intake_bundle_path)
        intake_args = [
            sys.executable,
            str(BUNDLE_INTAKE),
            "--bundle-dir",
            intake_bundle,
            "--output-dir",
            str(intake_dir),
            "--s3-readiness",
            str(args.s3_readiness.resolve()),
            "--s16-source-guard",
            str(args.s16_source_guard.resolve()),
        ]
        if args.accept_s16_decision:
            intake_args.append("--accept-s16-decision")
        if args.accept_company_template_pass_with_limits:
            intake_args.append("--accept-company-template-pass-with-limits")
        intake_run = run_command(intake_args)
        intake_text = intake_summary.read_text(encoding="utf-8", errors="replace") if intake_summary.is_file() else ""
        intake_status = markdown_value(intake_text, "Status") or "MISSING"

    final_status = "READY_FOR_M11_REVIEW" if archive_status == "PASS" and intake_status == "READY_FOR_M11_REVIEW" else "NOT_READY_FOR_M11_REVIEW"
    summary = output_dir / "summary.md"
    lines = [
        "# M11 Returned Evidence Receive",
        "",
        f"Status: `{final_status}`",
        f"Bundle: `{bundle}`",
        f"Archive verify status: `{archive_status}`",
        f"Archive verify summary: `{archive_summary}`",
        f"Bundle intake status: `{intake_status}`",
        f"Bundle intake summary: `{intake_summary if intake_run else 'not run'}`",
        f"Intake bundle directory: `{intake_bundle or 'not extracted'}`",
        f"Archive verify exit: `{archive_run.returncode}`",
        f"Bundle intake exit: `{intake_run.returncode if intake_run else 'not run'}`",
        "",
        "## Archive verify output",
        "",
        "```text",
        archive_run.stdout.strip(),
        "```",
        "",
        "## Bundle intake output",
        "",
        "```text",
        intake_run.stdout.strip() if intake_run else "not run because archive verify did not PASS",
        "```",
        "",
        "## Boundary",
        "",
        "This helper receives returned evidence only. It verifies bundle transport/structure and delegates readiness to returned-evidence bundle intake. It does not run runtime smoke, target-machine commands, autocomplete, Word generation, or final M11 review.",
        "",
    ]
    summary.write_text("\n".join(lines), encoding="utf-8")
    print(f"Status: {final_status}")
    print(f"Summary: {summary}")
    return 0 if final_status == "READY_FOR_M11_REVIEW" else 1


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def build_complete_bundle(root: Path) -> tuple[Path, Path, Path]:
    bundle = root / "complete-bundle"
    s3 = write(root / "s3.md", "# S3\n\n- Status: `PASS`\n- document_search used: `yes`\n- provider/readiness failure detected: `no`\n")
    source_guard = write(root / "s16-source-guard.md", "# S16\n\n- Status: `PASS_WITH_LIMITS`\n")
    write(bundle / "s16" / "current-summary.md", "# S16 Autocomplete Decision Intake\n\n- Status: `READY_FOR_READONLY_S16_SMOKE`\n- Ready for read-only S16 smoke: `yes`\n- Source guard status: `PASS_WITH_LIMITS`\n- Decision record present: `yes`\n- Parsed decision: `keep`\n\n## Boundary\n\nThis helper does not modify protected files.\n")
    write(bundle / "installed-runtime" / "runtime-intake-summary.md", "# Runtime Smoke Intake Verify\n\n- Requested IDs: `S1,S2,S3,S4,S5,S6,S7,S8,S9,S10,S11,S12,S13,S14,S15,S16`\n- Final status: `PASS`\n\n## Checks\n- S1: PASS\n- S16: PASS\n- S16 source guard: PASS_WITH_LIMITS\n")
    for target, target_name in [("windows-target", "win32-x64"), ("linux-target", "linux-x64")]:
        write(bundle / target / "target-intake-summary.md", f"# ChipMate Offline Target Evidence Intake Verify\n\n- Target: `{target_name}`\n- Final status: `PASS`\n\n## Package evidence checks\n- package summary status PASS\n\n## Runtime evidence checks\n- runtime intake summary final status PASS: runtime-intake-summary.md\n\n## Target evidence return template checks\n- target evidence return template overall status PASS\n- Overall target status PASS\n")
    write(bundle / "internal-embedded-c" / "summary.md", "# Internal Embedded-C Source-Backed Detail Design Intake Summary\n\nStatus: `PASS`\nPassed checks: `24`\nFailed checks: `0`\n\n## Passed checks\n- evidence file found: internal-embedded-c-detail-design-evidence.md\n- context filled: Installed VSIX profile\n- context filled: Source workspace\n- context filled: Embedded C module\n- status PASS: ChipMate native QA preserved\n- status PASS: Source-backed detail-design skill selected\n- status PASS: Markdown detail design generated\n- status PASS: Word detail design generated\n- status PASS: At least one diagram generated\n- status PASS: Quality report generated\n- status PASS: Old ChipMate contract markers absent\n- status PASS: No missing-diagram auto-repair triggered\n- status PASS: No document-contract planning triggered when skill disabled\n- generated Markdown artifacts: 1\n- generated Word artifacts: 1\n- generated diagram artifacts: 1\n- quality report artifacts: 1\n")
    write(bundle / "company-template" / "summary.md", "# Company DOCX Template Validation\n\n- Status: `PASS`\n- Template: `/tmp/company.docx`\n- Template size: `1000`\n- Style count: `12`\n\n## Failures\n- None\n\n## Warnings\n- None\n\n## Boundary\n\nThis helper validates a real .docx template or style source as OOXML input evidence only. It does not generate Word output, does not fill placeholders, does not require missing artifacts, does not run recipe repair, and does not decide installed chat/runtime S8 acceptance.\n")
    write(bundle / "agent-terminal-visible-ux" / "summary.md", "# Agent Terminal Visible UX Intake Summary\n\nStatus: `PASS`\nPassed checks: `18`\nFailed checks: `0`\n\n## Passed checks\n- evidence file found: agent-terminal-visible-ux-evidence.md\n- context filled: Installed VSIX profile\n- status PASS: Agent Terminal command visible\n- status PASS: Terminal pane opens after enable\n- status PASS: Native ChipMate terminal unaffected\n- status PASS: Dangerous command confirmation visible\n- attached evidence assets: 2\n")
    return bundle, s3, source_guard


def build_placeholder_bundle(root: Path) -> Path:
    bundle = root / "placeholder-bundle"
    required = {
        ("s16", "current-summary.md"),
        ("installed-runtime", "runtime-intake-summary.md"),
        ("windows-target", "target-intake-summary.md"),
        ("linux-target", "target-intake-summary.md"),
        ("internal-embedded-c", "summary.md"),
        ("company-template", "summary.md"),
        ("agent-terminal-visible-ux", "summary.md"),
    }
    for parts in required:
        write(bundle.joinpath(*parts), "# Placeholder\n\n- Status: `PENDING`\n")
    return bundle


def self_check(output_dir: Path) -> int:
    passed: list[str] = []
    failed: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        complete_bundle, s3, source_guard = build_complete_bundle(root)
        complete_out = root / "complete-out"
        complete_args = argparse.Namespace(
            bundle=complete_bundle,
            output_dir=complete_out,
            s3_readiness=s3,
            s16_source_guard=source_guard,
            accept_s16_decision=True,
            accept_company_template_pass_with_limits=False,
        )
        complete_code = run_receive(complete_args)
        placeholder_bundle = build_placeholder_bundle(root)
        placeholder_out = root / "placeholder-out"
        placeholder_args = argparse.Namespace(
            bundle=placeholder_bundle,
            output_dir=placeholder_out,
            s3_readiness=s3,
            s16_source_guard=source_guard,
            accept_s16_decision=True,
            accept_company_template_pass_with_limits=False,
        )
        placeholder_code = run_receive(placeholder_args)

    if complete_code == 0:
        passed.append("complete bundle receive reaches READY_FOR_M11_REVIEW")
    else:
        failed.append("complete bundle receive did not reach READY_FOR_M11_REVIEW")
    if placeholder_code != 0:
        passed.append("placeholder bundle receive is rejected before intake")
    else:
        failed.append("placeholder bundle receive was incorrectly accepted")

    status = "PASS" if not failed else "FAIL"
    output_dir.mkdir(parents=True, exist_ok=True)
    summary = output_dir / "summary.md"
    lines = [
        "# M11 Returned Evidence Receive Self-Check",
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
            "This self-check uses synthetic evidence bundles only. It proves receive-flow wiring, not real installed VS Code runtime behavior.",
            "",
        ]
    )
    summary.write_text("\n".join(lines), encoding="utf-8")
    print(f"Status: {status}")
    print(f"Summary: {summary}")
    return 0 if status == "PASS" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--s3-readiness", type=Path, default=REPO_ROOT / "docs/chipmate-feature-migration-validation-runs/20260709-120000-document-rag-readiness-rerun/document-rag-readiness-summary.md")
    parser.add_argument("--s16-source-guard", type=Path, default=REPO_ROOT / "docs/chipmate-feature-migration-validation-runs/20260709-004500-s16-source-guard/summary.md")
    parser.add_argument("--accept-s16-decision", action="store_true")
    parser.add_argument("--accept-company-template-pass-with-limits", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if args.self_check:
        return self_check(args.output_dir.resolve())
    if args.bundle is None:
        raise SystemExit("--bundle is required unless --self-check is used")
    return run_receive(args)


if __name__ == "__main__":
    raise SystemExit(main())
