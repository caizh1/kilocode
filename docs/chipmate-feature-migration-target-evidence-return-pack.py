#!/usr/bin/env python3
"""
Pack offline target-machine evidence for return to the migration workstation.

This helper is intentionally evidence-shape only:
- It does not execute runtime smoke.
- It does not decide M11 acceptance.
- It preserves BLOCKED_AUTH/BLOCKED_ENV/PARTIAL/FAIL evidence as-is.
- It creates a manifest with checksums so returned evidence can be audited after
  transfer.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Any


VERSION = "0.0.38"
TEXT_SUFFIXES = {".md", ".txt", ".log", ".json", ".tsv", ".csv"}
RETURN_SUFFIXES = TEXT_SUFFIXES | {".png", ".jpg", ".jpeg", ".webp", ".pdf", ".docx"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def safe_relative(path: Path, root: Path) -> str:
    rel = path.relative_to(root).as_posix()
    if rel.startswith("../") or rel == ".." or "/../" in rel:
        raise SystemExit(f"unsafe returned evidence path: {path}")
    if rel.startswith("._") or "/._" in rel or rel.startswith("__MACOSX") or "/__MACOSX" in rel or rel.endswith(".DS_Store"):
        raise SystemExit(f"macOS metadata file is not allowed in returned evidence: {rel}")
    return rel


def collect_files(evidence_dir: Path) -> list[Path]:
    files: list[Path] = []
    for path in sorted(evidence_dir.rglob("*")):
        if not path.is_file():
            continue
        rel = safe_relative(path, evidence_dir)
        if path.suffix.lower() not in RETURN_SUFFIXES:
            raise SystemExit(f"unsupported returned evidence file type: {rel}")
        files.append(path)
    if not files:
        raise SystemExit(f"no returned evidence files found in {evidence_dir}")
    return files


def first_status_line(path: Path, label: str) -> str | None:
    if not path.is_file():
        return None
    text = read_text(path)
    match = re.search(rf"(?im)^\s*[-*]?\s*{re.escape(label)}\s*:\s*`?([A-Z0-9_]+)`?\s*$", text)
    if match:
        return match.group(1).upper()
    return None


def template_overall_status(evidence_dir: Path) -> str | None:
    candidates = sorted(evidence_dir.rglob("chipmate-feature-migration-target-evidence-return-template.md"))
    for path in candidates:
        text = read_text(path)
        match = re.search(r"(?im)^\|\s*Overall target status\s*\|\s*([^|]+?)\s*\|", text)
        if match:
            return match.group(1).strip().upper()
    return None


def status_signals(evidence_dir: Path) -> dict[str, str | None]:
    return {
        "runnerSummaryStatus": first_status_line(evidence_dir / "summary.md", "Status"),
        "packageIntakeFinalStatus": first_status_line(evidence_dir / "intake-summary.md", "Final status"),
        "runtimeIntakeFinalStatus": first_status_line(evidence_dir / "runtime-evidence-skeleton/runtime-intake-summary.md", "Final status")
        or first_status_line(evidence_dir / "runtime-intake-summary.md", "Final status"),
        "targetEvidenceReturnTemplateOverallStatus": template_overall_status(evidence_dir),
    }


def write_archives(evidence_dir: Path, files: list[Path], output_dir: Path, base_name: str) -> tuple[Path, Path]:
    tar_path = output_dir / f"{base_name}.tar.gz"
    zip_path = output_dir / f"{base_name}.zip"
    with tarfile.open(tar_path, "w:gz") as tar:
        for path in files:
            tar.add(path, arcname=f"{base_name}/{safe_relative(path, evidence_dir)}")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in files:
            zf.write(path, arcname=f"{base_name}/{safe_relative(path, evidence_dir)}")
    return tar_path, zip_path


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


def parse_sha256_lines(path: Path) -> dict[str, str]:
    checksums: dict[str, str] = {}
    for line in read_text(path).splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 2:
            fail(f"invalid checksum line in {path}: {line}")
        checksums[parts[-1]] = parts[0].lower()
    return checksums


def check_archive_member_name(name: str) -> None:
    if name.startswith("../") or name == ".." or "/../" in name:
        fail(f"unsafe archive member path: {name}")
    if name.startswith("._") or "/._" in name or name.startswith("__MACOSX") or "/__MACOSX" in name or name.endswith(".DS_Store"):
        fail(f"macOS metadata file is not allowed in returned evidence archive: {name}")


def extract_archive(archive_path: Path, output_dir: Path) -> None:
    suffixes = archive_path.suffixes
    if suffixes[-2:] == [".tar", ".gz"] or archive_path.name.endswith(".tgz"):
        with tarfile.open(archive_path, "r:gz") as tar:
            for member in tar.getmembers():
                check_archive_member_name(member.name)
            tar.extractall(output_dir)
        return
    if archive_path.suffix.lower() == ".zip":
        with zipfile.ZipFile(archive_path) as zf:
            for name in zf.namelist():
                check_archive_member_name(name)
            zf.extractall(output_dir)
        return
    fail(f"unsupported returned evidence archive type: {archive_path}")


def find_single_manifest(extract_dir: Path) -> Path:
    candidates = sorted(extract_dir.rglob(f"chipmate-{VERSION}-*-manifest.json"))
    if len(candidates) != 1:
        fail(f"expected exactly one returned evidence manifest JSON, found {len(candidates)}")
    return candidates[0]


def verify_manifest_files(manifest: dict[str, Any], manifest_path: Path, root_dir: Path) -> list[str]:
    checks: list[str] = []
    target = manifest.get("target")
    if target not in {"linux-x64", "win32-x64"}:
        fail(f"manifest target invalid: {target}")
    if manifest.get("version") != VERSION:
        fail(f"manifest version mismatch: {manifest.get('version')}")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        fail("manifest files list missing or empty")

    evidence_root = manifest_path.parent / "evidence"
    if not evidence_root.is_dir():
        fail("archive evidence/ directory missing")

    for item in files:
        if not isinstance(item, dict):
            fail("manifest file entry is not an object")
        rel = item.get("path")
        expected_size = item.get("size")
        expected_sha = item.get("sha256")
        if not isinstance(rel, str) or not isinstance(expected_size, int) or not isinstance(expected_sha, str):
            fail(f"manifest file entry invalid: {item}")
        check_archive_member_name(rel)
        actual = evidence_root / rel
        if not actual.is_file():
            fail(f"manifest evidence file missing from archive: {rel}")
        if actual.stat().st_size != expected_size:
            fail(f"manifest evidence file size mismatch for {rel}")
        actual_sha = sha256_file(actual)
        if actual_sha != expected_sha:
            fail(f"manifest evidence file sha256 mismatch for {rel}")
    checks.append(f"manifest verifies {len(files)} evidence files for target {target}")

    archived_files = [path for path in evidence_root.rglob("*") if path.is_file()]
    manifest_paths = {str(item["path"]) for item in files if isinstance(item, dict) and isinstance(item.get("path"), str)}
    extra_files = []
    for path in archived_files:
        rel = path.relative_to(evidence_root).as_posix()
        if rel not in manifest_paths:
            extra_files.append(rel)
    if extra_files:
        fail(f"archive evidence/ contains files not listed in manifest: {', '.join(sorted(extra_files))}")
    checks.append("archive evidence files match manifest exactly")
    return checks


def verify_return_pack(archive_path: Path, checksum_file: Path | None, output_summary: Path | None) -> int:
    archive_path = archive_path.resolve()
    if not archive_path.is_file():
        fail(f"returned evidence archive not found: {archive_path}")
    checks: list[str] = []

    if checksum_file is not None:
        checksum_file = checksum_file.resolve()
        if not checksum_file.is_file():
            fail(f"checksum file not found: {checksum_file}")
        checksums = parse_sha256_lines(checksum_file)
        expected = checksums.get(archive_path.name)
        if expected is None:
            fail(f"checksum file does not include archive: {archive_path.name}")
        actual = sha256_file(archive_path)
        if actual != expected:
            fail(f"archive checksum mismatch: expected {expected} got {actual}")
        checks.append("archive checksum matches SHA256SUMS entry")

    with tempfile.TemporaryDirectory() as tmpdir:
        extract_dir = Path(tmpdir) / "extract"
        extract_dir.mkdir()
        extract_archive(archive_path, extract_dir)
        manifest_path = find_single_manifest(extract_dir)
        manifest = json.loads(read_text(manifest_path))
        checks.append(f"manifest JSON parses: {manifest_path.name}")
        checks.extend(verify_manifest_files(manifest, manifest_path, extract_dir))

    lines = [
        "# ChipMate Target Evidence Return Pack Verify",
        "",
        "- Status: PASS",
        f"- Archive: `{archive_path}`",
        f"- Checksum file: `{checksum_file}`" if checksum_file else "- Checksum file: not provided",
        "",
        "## Checks",
        "",
    ]
    lines.extend(f"- {item}" for item in checks)
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "This verifies returned evidence archive integrity only. It does not execute S1-S16 and does not decide M11 acceptance.",
            "",
        ]
    )
    if output_summary is not None:
        output_summary.parent.mkdir(parents=True, exist_ok=True)
        output_summary.write_text("\n".join(lines), encoding="utf-8")
        print(f"VERIFY: {output_summary}")
    else:
        print("\n".join(lines))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["linux-x64", "win32-x64"])
    parser.add_argument("--evidence-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--label", default="target-evidence")
    parser.add_argument("--verify-pack", type=Path)
    parser.add_argument("--checksum-file", type=Path)
    parser.add_argument("--output-summary", type=Path)
    args = parser.parse_args()

    if args.verify_pack is not None:
        return verify_return_pack(args.verify_pack, args.checksum_file, args.output_summary)
    if args.target is None:
        raise SystemExit("--target is required when packing returned evidence")
    if args.evidence_dir is None:
        raise SystemExit("--evidence-dir is required when packing returned evidence")
    if args.output_dir is None:
        raise SystemExit("--output-dir is required when packing returned evidence")

    evidence_dir = args.evidence_dir.resolve()
    if not evidence_dir.is_dir():
        raise SystemExit(f"evidence directory not found: {evidence_dir}")

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    base_name = f"chipmate-{VERSION}-{args.target}-{args.label}"

    files = collect_files(evidence_dir)
    created_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    manifest = {
        "product": "ChipMate",
        "version": VERSION,
        "target": args.target,
        "createdAt": created_at,
        "sourceEvidenceDir": str(evidence_dir),
        "boundary": "Returned evidence packaging only; this does not execute S1-S16 and does not decide M11 acceptance.",
        "statusSignals": status_signals(evidence_dir),
        "files": [
            {
                "path": safe_relative(path, evidence_dir),
                "size": path.stat().st_size,
                "sha256": sha256_file(path),
            }
            for path in files
        ],
    }

    manifest_json = output_dir / f"{base_name}-manifest.json"
    manifest_md = output_dir / f"{base_name}-manifest.md"
    manifest_json.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    manifest_md.write_text(
        "\n".join(
            [
                f"# ChipMate {VERSION} Target Evidence Return Manifest",
                "",
                f"- Target: `{args.target}`",
                f"- Created at: `{created_at}`",
                f"- Source evidence dir: `{evidence_dir}`",
                f"- Runner summary status: `{manifest['statusSignals']['runnerSummaryStatus']}`",
                f"- Package intake final status: `{manifest['statusSignals']['packageIntakeFinalStatus']}`",
                f"- Runtime intake final status: `{manifest['statusSignals']['runtimeIntakeFinalStatus']}`",
                f"- Return template overall status: `{manifest['statusSignals']['targetEvidenceReturnTemplateOverallStatus']}`",
                f"- File count: `{len(files)}`",
                "",
                "## Boundary",
                "",
                "This manifest records returned target-machine evidence files and checksums only. It does not execute S1-S16 and does not decide M11 acceptance.",
                "",
            ]
        ),
        encoding="utf-8",
    )

    pack_files = files + [manifest_json, manifest_md]
    # Manifest files are outside evidence_dir, so archive them explicitly under the bundle root.
    tar_path = output_dir / f"{base_name}.tar.gz"
    zip_path = output_dir / f"{base_name}.zip"
    with tarfile.open(tar_path, "w:gz") as tar:
        for path in files:
            tar.add(path, arcname=f"{base_name}/evidence/{safe_relative(path, evidence_dir)}")
        tar.add(manifest_json, arcname=f"{base_name}/{manifest_json.name}")
        tar.add(manifest_md, arcname=f"{base_name}/{manifest_md.name}")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in files:
            zf.write(path, arcname=f"{base_name}/evidence/{safe_relative(path, evidence_dir)}")
        zf.write(manifest_json, arcname=f"{base_name}/{manifest_json.name}")
        zf.write(manifest_md, arcname=f"{base_name}/{manifest_md.name}")

    sums = output_dir / f"{base_name}-SHA256SUMS.txt"
    sums.write_text(
        "".join(
            f"{sha256_file(path)}  {path.name}\n"
            for path in [manifest_json, manifest_md, tar_path, zip_path]
        ),
        encoding="utf-8",
    )

    print(f"PACKED: {tar_path}")
    print(f"PACKED: {zip_path}")
    print(f"MANIFEST: {manifest_json}")
    print(f"SHA256SUMS: {sums}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
