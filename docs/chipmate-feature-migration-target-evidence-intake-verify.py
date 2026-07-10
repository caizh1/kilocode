#!/usr/bin/env python3
"""
Validate returned offline target-machine evidence for ChipMate migration release
0.0.38.

This verifier is intentionally conservative:
- Package-integrity evidence can prove transfer/package correctness only.
- Runtime S1-S16 evidence is required before installed behavior can be accepted.
- PARTIAL_PACKAGE_ONLY exits non-zero unless --allow-package-only is provided.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path


EXPECTED_VERSION = "0.0.38"
EXPECTED_BUNDLE_SHA = "97a70108ae648a1998168d679c3c65638ea7756926860fad113cd06c31d2dba5"
EXPECTED_LINUX_VSIX_SHA = "95218162b0d0a09c6425c80a10e9745569c1b021edd9d666a5f43278d31458ad"
EXPECTED_WINDOWS_VSIX_SHA = "3c6b9943ecf8259379c6f75b1ff321bb83677c092aac3974584524fcd90e489d"

PASS_TOKEN = "PASS"
REVIEW_ONLY_STATUSES = {"PASS_WITH_LIMITS", "PASS_WITH_REVIEW", "PARTIAL_PACKAGE_ONLY"}
BLOCKING_STATUSES = {
    "FAIL",
    "ERROR",
    "BLOCKED",
    "BLOCKED_AUTH",
    "BLOCKED_ENV",
    "PENDING",
    "PARTIAL",
    "NOT_RUN",
    "TODO",
    "TIMEOUT",
}


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def first_markdown_status(text: str) -> str | None:
    match = re.search(r"(?im)^\s*[-*]?\s*Status\s*:\s*`?([A-Z0-9_]+)`?\s*$", text)
    if match:
        return match.group(1).upper()
    return None


def collect_evidence_text(directory: Path) -> str:
    chunks: list[str] = []
    for path in sorted(directory.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".md", ".txt", ".json", ".log", ".tsv"}:
            continue
        try:
            chunks.append(f"\n\n--- {path.relative_to(directory)} ---\n")
            chunks.append(read_text(path))
        except OSError:
            chunks.append(f"\n\n--- {path.relative_to(directory)} unreadable ---\n")
    return "".join(chunks)


def discover_delivery_manifest(package_dir: Path) -> Path | None:
    manifest_name = f"CHIPMATE_OFFLINE_DELIVERY_MANIFEST-{EXPECTED_VERSION}.json"
    if package_dir.is_dir():
        candidates = sorted(path for path in package_dir.rglob(manifest_name) if path.is_file())
        if candidates:
            return candidates[0]
    parent_manifest = package_dir.parent / manifest_name
    if parent_manifest.is_file():
        return parent_manifest
    return None


def delivery_manifest_s16_source_guard_check(package_dir: Path) -> tuple[bool, list[str]]:
    manifest_path = discover_delivery_manifest(package_dir)
    if manifest_path is None:
        return True, ["delivery manifest S16 source guard support flag not checked: manifest JSON not returned with package evidence"]
    try:
        manifest = json.loads(read_text(manifest_path))
    except json.JSONDecodeError as exc:
        return False, [f"delivery manifest JSON parse failed: {manifest_path}: {exc}"]
    target_kit = manifest.get("targetVerifyKit")
    if not isinstance(target_kit, dict):
        return False, [f"delivery manifest targetVerifyKit missing or invalid: {manifest_path}"]
    if target_kit.get("runtimeSmokeIntakeSupportsS16SourceGuard") is True:
        return True, [f"delivery manifest runtimeSmokeIntakeSupportsS16SourceGuard true: {manifest_path}"]
    return False, [f"delivery manifest runtimeSmokeIntakeSupportsS16SourceGuard missing/false: {manifest_path}"]


def runtime_intake_summary_status(directory: Path) -> tuple[str | None, Path | None]:
    candidates = sorted(directory.rglob("runtime-intake-summary.md"))
    if not candidates:
        return None, None
    for path in candidates:
        text = read_text(path)
        match = re.search(r"(?im)^\s*[-*]?\s*Final status\s*:\s*`?([A-Z0-9_]+)`?\s*$", text)
        if match:
            return match.group(1).upper(), path
    return None, candidates[0]


def return_template_status(package_dir: Path, runtime_dir: Path | None, target: str) -> tuple[str | None, Path | None, list[str]]:
    search_root_groups: list[list[Path]] = []
    if runtime_dir is not None:
        search_root_groups.append([runtime_dir])
    search_root_groups.append([package_dir])
    parent_roots: list[Path] = []
    if runtime_dir is not None:
        parent_roots.append(runtime_dir.parent)
    parent_roots.append(package_dir.parent)
    search_root_groups.append(parent_roots)

    unique_candidates: list[Path] = []
    for search_roots in search_root_groups:
        candidates: list[Path] = []
        for root in search_roots:
            if not root.is_dir():
                continue
            candidates.extend(sorted(root.rglob("chipmate-feature-migration-target-evidence-return-template.md")))
        unique_candidates = sorted(set(candidates))
        if unique_candidates:
            break

    checks: list[str] = []
    if not unique_candidates:
        return None, None, ["target evidence return template missing"]

    parsed: list[tuple[str | None, Path]] = []
    for path in unique_candidates:
        text = read_text(path)
        match = re.search(r"(?im)^\|\s*Overall target status\s*\|\s*([^|]+?)\s*\|", text)
        status = match.group(1).strip().upper() if match else None
        if status == PASS_TOKEN:
            unfilled_markers: list[str] = []
            if re.search(r"\bTODO\b", text):
                unfilled_markers.append("TODO placeholders remain")
            platform_match = re.search(r"(?im)^\|\s*Target platform\s*\|\s*([^|]+?)\s*\|", text)
            platform = platform_match.group(1).strip() if platform_match else ""
            if platform != target:
                unfilled_markers.append(f"target platform is {platform or 'missing'}, expected {target}")
            if "/" in platform:
                unfilled_markers.append(f"target platform still looks like a placeholder: {platform}")
            if unfilled_markers:
                checks.append(
                    f"target evidence return template overall status PASS but template is not fully filled: {path}; "
                    + "; ".join(unfilled_markers)
                )
                parsed.append(("PARTIAL", path))
                continue
        parsed.append((status, path))

    for status, path in parsed:
        if status == PASS_TOKEN:
            checks.append(f"target evidence return template overall status PASS: {path}")
            return status, path, checks

    status, path = parsed[0]
    if status is None:
        checks.append(f"target evidence return template overall status missing: {path}")
    else:
        checks.append(f"target evidence return template overall status {status}: {path}")
    return status, path, checks


def reconcile_return_template_status(
    package_status: str,
    runtime_status: str,
    template_status: str | None,
    template_path: Path | None,
    template_checks: list[str],
) -> str:
    if template_status != PASS_TOKEN:
        return template_status or "PARTIAL"

    contradictions: list[str] = []
    if package_status != PASS_TOKEN:
        contradictions.append(f"package evidence status is {package_status}")
    if runtime_status != PASS_TOKEN:
        contradictions.append(f"runtime evidence status is {runtime_status}")
    if not contradictions:
        return PASS_TOKEN

    template_checks.append(
        "target evidence return template overall status PASS contradicts intake results"
        + (f" at {template_path}" if template_path else "")
        + ": "
        + "; ".join(contradictions)
    )
    return "PARTIAL"


def validate_package_evidence(package_dir: Path) -> tuple[str, list[str]]:
    checks: list[str] = []
    summary = package_dir / "summary.md"
    if not summary.is_file():
        return "FAIL", ["missing package evidence summary.md"]

    text = read_text(summary)
    all_text = collect_evidence_text(package_dir)
    status = first_markdown_status(text)
    if status != PASS_TOKEN:
        checks.append(f"package summary status is {status or 'missing'}, expected PASS")
    else:
        checks.append("package summary status PASS")

    required_hashes = {
        "main handoff bundle": EXPECTED_BUNDLE_SHA,
        "linux vsix": EXPECTED_LINUX_VSIX_SHA,
        "windows vsix": EXPECTED_WINDOWS_VSIX_SHA,
    }
    for label, expected in required_hashes.items():
        if expected in text:
            checks.append(f"{label} SHA256 present")
        else:
            checks.append(f"{label} SHA256 missing: {expected}")

    marker_evidence = (
        "VSIX CLI marker boundary" in all_text
        or "CLI marker boundary OK" in all_text
    )
    if marker_evidence:
        checks.append("VSIX CLI marker boundary evidence present")
    else:
        checks.append("VSIX CLI marker boundary evidence missing")

    manifest_ok, manifest_checks = delivery_manifest_s16_source_guard_check(package_dir)
    checks.extend(manifest_checks)

    failed = any("missing" in item or "expected" in item for item in checks)
    failed = failed or not manifest_ok
    return ("FAIL" if failed else PASS_TOKEN), checks


def runtime_line_status(line: str) -> str | None:
    upper = line.upper()
    for status in sorted(BLOCKING_STATUSES | REVIEW_ONLY_STATUSES | {PASS_TOKEN}, key=len, reverse=True):
        if re.search(rf"\b{re.escape(status)}\b", upper):
            return status
    return None


def collect_runtime_tsv_statuses(directory: Path) -> dict[str, list[str]]:
    collected: dict[str, list[str]] = {}
    for path in sorted(directory.rglob("runtime-smoke.tsv")):
        try:
            with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
                reader = csv.DictReader(handle, delimiter="\t")
                for row in reader:
                    sid = (row.get("id") or "").strip().upper()
                    status = runtime_line_status(row.get("status") or "")
                    if re.fullmatch(r"S(?:[1-9]|1[0-6])", sid) and status:
                        collected.setdefault(sid, []).append(status)
        except OSError:
            continue
    return collected


def validate_runtime_evidence(runtime_dir: Path | None) -> tuple[str, list[str]]:
    if runtime_dir is None:
        return "PARTIAL_PACKAGE_ONLY", ["runtime S1-S16 evidence directory not provided"]
    if not runtime_dir.is_dir():
        return "FAIL", [f"runtime evidence directory not found: {runtime_dir}"]

    text = collect_evidence_text(runtime_dir)
    if not text.strip():
        return "FAIL", ["runtime evidence directory contains no readable evidence files"]

    checks: list[str] = []
    runtime_intake_status, runtime_intake_path = runtime_intake_summary_status(runtime_dir)
    if runtime_intake_path is None:
        checks.append("runtime intake summary missing: runtime-intake-summary.md")
    elif runtime_intake_status is None:
        checks.append(f"runtime intake summary final status missing: {runtime_intake_path}")
    elif runtime_intake_status == PASS_TOKEN:
        checks.append(f"runtime intake summary final status PASS: {runtime_intake_path}")
    else:
        checks.append(f"runtime intake summary final status {runtime_intake_status}: {runtime_intake_path}")

    tsv_statuses = collect_runtime_tsv_statuses(runtime_dir)
    statuses: dict[str, str] = {}
    for index in range(1, 17):
        sid = f"S{index}"
        if sid in tsv_statuses:
            line_statuses = tsv_statuses[sid]
        else:
            matching_lines = [line for line in text.splitlines() if re.search(rf"\b{sid}\b", line, re.IGNORECASE)]
            line_statuses = [runtime_line_status(line) for line in matching_lines]
            line_statuses = [status for status in line_statuses if status]
        if not line_statuses:
            statuses[sid] = "PENDING"
            checks.append(f"{sid}: missing status")
            continue
        if any(status in BLOCKING_STATUSES for status in line_statuses):
            blocking = next(status for status in line_statuses if status in BLOCKING_STATUSES)
            statuses[sid] = blocking
            checks.append(f"{sid}: {blocking}")
            continue
        if all(status == PASS_TOKEN for status in line_statuses):
            statuses[sid] = PASS_TOKEN
            checks.append(f"{sid}: PASS")
            continue
        statuses[sid] = "PARTIAL"
        checks.append(f"{sid}: partial/review status {', '.join(line_statuses)}")

    if runtime_intake_status != PASS_TOKEN:
        if runtime_intake_status == "BLOCKED_AUTH":
            return "BLOCKED_AUTH", checks
        if runtime_intake_status == "TIMEOUT":
            return "TIMEOUT", checks
        if runtime_intake_status in {"FAIL", "ERROR", "ERROR_NEEDS_REVIEW", "BLOCKED", "BLOCKED_ENV"}:
            return "FAIL", checks
        if runtime_intake_status == "PARTIAL_NEEDS_REVIEW":
            return "PARTIAL_NEEDS_REVIEW", checks
        return "PARTIAL", checks
    if all(status == PASS_TOKEN for status in statuses.values()):
        return PASS_TOKEN, checks
    if any(status == "BLOCKED_AUTH" for status in statuses.values()):
        return "BLOCKED_AUTH", checks
    if any(status in BLOCKING_STATUSES for status in statuses.values()):
        return "FAIL", checks
    return "PARTIAL", checks


def final_status(package_status: str, runtime_status: str, template_status: str | None) -> str:
    if package_status != PASS_TOKEN:
        return "FAIL"
    if runtime_status == PASS_TOKEN:
        if template_status != PASS_TOKEN:
            return "PARTIAL"
        return PASS_TOKEN
    return runtime_status


def write_summary(output: Path, target: str, package_status: str, package_checks: list[str], runtime_status: str, runtime_checks: list[str], template_status: str, template_checks: list[str], final: str) -> None:
    lines = [
        "# ChipMate Offline Target Evidence Intake Verify",
        "",
        f"- Target: `{target}`",
        f"- Version: `{EXPECTED_VERSION}`",
        f"- Package evidence status: `{package_status}`",
        f"- Runtime evidence status: `{runtime_status}`",
        f"- Target evidence return template status: `{template_status}`",
        f"- Final status: `{final}`",
        "",
        "## Package evidence checks",
        "",
    ]
    lines.extend(f"- {item}" for item in package_checks)
    lines.extend(["", "## Runtime evidence checks", ""])
    lines.extend(f"- {item}" for item in runtime_checks)
    lines.extend(["", "## Target evidence return template checks", ""])
    lines.extend(f"- {item}" for item in template_checks)
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "This intake verifier is a guardrail for returned target-machine evidence. It does not replace manual M11 review and does not prove Kilo native QA preservation unless S1-S16 runtime evidence is present and passing.",
            "Runtime evidence must also include `runtime-intake-summary.md` with final status `PASS`; a manually filled S1-S16 table alone is not sufficient.",
            "Full runtime evidence must also include a filled target evidence return template whose `Overall target status` is `PASS`.",
            "",
        ]
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["linux-x64", "win32-x64"], required=True)
    parser.add_argument("--package-evidence", type=Path, required=True)
    parser.add_argument("--runtime-evidence", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--allow-package-only", action="store_true")
    args = parser.parse_args()

    package_status, package_checks = validate_package_evidence(args.package_evidence)
    runtime_status, runtime_checks = validate_runtime_evidence(args.runtime_evidence)
    if args.runtime_evidence is None:
        template_status = "PARTIAL_PACKAGE_ONLY"
        template_checks = ["target evidence return template not required for package-only intake"]
    else:
        detected_template_status, template_path, template_checks = return_template_status(args.package_evidence, args.runtime_evidence, args.target)
        template_status = reconcile_return_template_status(
            package_status,
            runtime_status,
            detected_template_status,
            template_path,
            template_checks,
        )
    final = final_status(package_status, runtime_status, template_status)
    write_summary(args.output, args.target, package_status, package_checks, runtime_status, runtime_checks, template_status, template_checks, final)

    if final == PASS_TOKEN:
        return 0
    if final == "PARTIAL_PACKAGE_ONLY" and args.allow_package_only:
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
