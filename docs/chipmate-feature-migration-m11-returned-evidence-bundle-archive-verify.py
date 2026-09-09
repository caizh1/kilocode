#!/usr/bin/env python3
"""Verify a returned M11 evidence bundle archive or directory.

This helper checks bundle transport/structure before the bundle is handed to
chipmate-feature-migration-m11-returned-evidence-bundle-intake.py. It does not
run ChipMate QA, install VSIX files, execute target commands, run autocomplete, or
decide M11 readiness/final signoff.
"""

from __future__ import annotations

import argparse
import shutil
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path


BUNDLE_FILES = {
    "s16-decision-intake": ("s16", "current-summary.md"),
    "installed-runtime-intake": ("installed-runtime", "runtime-intake-summary.md"),
    "windows-target-intake": ("windows-target", "target-intake-summary.md"),
    "linux-target-intake": ("linux-target", "target-intake-summary.md"),
    "internal-embedded-c-intake": ("internal-embedded-c", "summary.md"),
    "company-template-summary": ("company-template", "summary.md"),
}

BAD_MARKERS = [
    "Status: `PENDING`",
    "TODO",
    "<bundle>",
    "<runtime-run-dir>",
    "<package-evidence-dir>",
    "<company-template.docx>",
    "<visible-ux-evidence-dir>",
    "returned-evidence bundle template placeholder",
]


@dataclass(frozen=True)
class VerifyResult:
    status: str
    passed: list[str]
    failed: list[str]
    extracted_root: Path


def safe_member_name(name: str) -> bool:
    path = Path(name)
    return not path.is_absolute() and ".." not in path.parts


def extract_bundle(bundle: Path, work_dir: Path) -> Path:
    if bundle.is_dir():
        return bundle
    extract_dir = work_dir / "extracted"
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
        raise SystemExit(f"unsupported bundle path, expected directory, .zip, .tar, .tar.gz, or .tgz: {bundle}")

    children = [child for child in extract_dir.iterdir() if child.name not in {"__MACOSX", ".DS_Store"}]
    if len(children) == 1 and children[0].is_dir():
        return children[0]
    return extract_dir


def has_macos_metadata(root: Path) -> bool:
    for path in root.rglob("*"):
        parts = path.parts
        if "__MACOSX" in parts or path.name == ".DS_Store" or path.name.startswith("._"):
            return True
    return False


def verify_root(root: Path) -> VerifyResult:
    passed: list[str] = []
    failed: list[str] = []

    if has_macos_metadata(root):
        failed.append("macOS metadata found in returned bundle")
    else:
        passed.append("no macOS metadata found")

    for key, parts in BUNDLE_FILES.items():
        path = root.joinpath(*parts)
        if not path.is_file():
            failed.append(f"missing required evidence file: {key}: {path.relative_to(root)}")
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        passed.append(f"required evidence file present: {key}: {path.relative_to(root)}")
        bad_found = [marker for marker in BAD_MARKERS if marker in text]
        if bad_found:
            failed.append(f"placeholder/blocking marker in {key}: {', '.join(bad_found)}")
        else:
            passed.append(f"no placeholder markers: {key}")

    status = "PASS" if not failed else "FAIL"
    return VerifyResult(status, passed, failed, root)


def write_summary(output: Path, bundle: Path, result: VerifyResult) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# M11 Returned Evidence Bundle Archive Verify",
        "",
        f"Status: `{result.status}`",
        f"Bundle: `{bundle}`",
        f"Extracted/root directory: `{result.extracted_root}`",
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
            "This helper verifies returned bundle transport/structure only. PASS means the bundle is structurally ready to feed into the returned-evidence bundle intake; it does not mean M11 readiness or final signoff is complete.",
            "",
        ]
    )
    output.write_text("\n".join(lines), encoding="utf-8")


def verify_bundle(bundle: Path, output: Path) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = extract_bundle(bundle.resolve(), Path(tmp))
        result = verify_root(root)
        write_summary(output.resolve(), bundle.resolve(), result)
    print(f"Status: {result.status}")
    print(f"Summary: {output.resolve()}")
    return 0 if result.status == "PASS" else 1


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def create_complete_fixture(root: Path) -> Path:
    bundle = root / "complete"
    write(bundle / "s16" / "current-summary.md", "# S16 Autocomplete Decision Intake\n\n- Status: `READY_FOR_READONLY_S16_SMOKE`\n")
    write(bundle / "installed-runtime" / "runtime-intake-summary.md", "# Runtime Smoke Intake Verify\n\n- Final status: `PASS`\n")
    write(bundle / "windows-target" / "target-intake-summary.md", "# ChipMate Offline Target Evidence Intake Verify\n\n- Final status: `PASS`\n")
    write(bundle / "linux-target" / "target-intake-summary.md", "# ChipMate Offline Target Evidence Intake Verify\n\n- Final status: `PASS`\n")
    write(bundle / "internal-embedded-c" / "summary.md", "# Internal Embedded-C Source-Backed Detail Design Intake Summary\n\nStatus: `PASS`\n")
    write(bundle / "company-template" / "summary.md", "# Company DOCX Template Validation\n\n- Status: `PASS`\n")
    return bundle


def create_template_fixture(root: Path) -> Path:
    bundle = root / "template"
    for _, parts in BUNDLE_FILES.items():
        write(bundle.joinpath(*parts), "# Placeholder\n\n- Status: `PENDING`\n- Replace <bundle> with real typed verifier output.\n")
    return bundle


def self_check(output: Path) -> int:
    passed: list[str] = []
    failed: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        complete = create_complete_fixture(root)
        template = create_template_fixture(root)
        missing = root / "missing"
        shutil.copytree(complete, missing)
        (missing / "company-template" / "summary.md").unlink()

        complete_result = verify_root(complete)
        template_result = verify_root(template)
        missing_result = verify_root(missing)

    if complete_result.status == "PASS":
        passed.append("complete fixture accepted")
    else:
        failed.append("complete fixture was not accepted")
    if template_result.status == "FAIL":
        passed.append("template placeholder fixture rejected")
    else:
        failed.append("template placeholder fixture was incorrectly accepted")
    if missing_result.status == "FAIL":
        passed.append("missing required evidence fixture rejected")
    else:
        failed.append("missing required evidence fixture was incorrectly accepted")

    status = "PASS" if not failed else "FAIL"
    result = VerifyResult(status, passed, failed, Path("<self-check>"))
    write_summary(output.resolve(), Path("<self-check>"), result)
    print(f"Status: {status}")
    print(f"Summary: {output.resolve()}")
    return 0 if status == "PASS" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if args.self_check:
        return self_check(args.output)
    if args.bundle is None:
        raise SystemExit("--bundle is required unless --self-check is used")
    return verify_bundle(args.bundle, args.output)


if __name__ == "__main__":
    raise SystemExit(main())
