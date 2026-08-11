#!/usr/bin/env python3
"""
Cross-platform package-integrity verifier for the ChipMate 0.0.38 offline
handoff bundle.

This is a target-machine fallback/alternative to the Linux bash and Windows
PowerShell verifiers. It uses only Python standard library modules.

Boundary: this verifies package transfer integrity only. It does not prove
installed VS Code runtime behavior, S1-S16 smoke, provider/auth, Document RAG,
autocomplete, Agent Terminal, Word/Mermaid, or source-backed detail-design
behavior.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import tarfile
import zipfile
from pathlib import Path


EXPECTED_VERSION = "0.0.38"
EXPECTED_BUNDLE_SHA = "97a70108ae648a1998168d679c3c65638ea7756926860fad113cd06c31d2dba5"
EXPECTED_BUNDLE_SIZE = 317784738
EXPECTED_LINUX_VSIX = "chipmate-vscode-linux-x64-baseline.vsix"
EXPECTED_LINUX_SHA = "95218162b0d0a09c6425c80a10e9745569c1b021edd9d666a5f43278d31458ad"
EXPECTED_WINDOWS_VSIX = "chipmate-vscode-win32-x64-baseline.vsix"
EXPECTED_WINDOWS_SHA = "3c6b9943ecf8259379c6f75b1ff321bb83677c092aac3974584524fcd90e489d"

EXPECTED_CONTENTS = sorted(
    [
        f"OFFLINE_RELEASE_INDEX-chipmate-{EXPECTED_VERSION}.json",
        f"OFFLINE_RELEASE_INDEX-chipmate-{EXPECTED_VERSION}.md",
        f"OFFLINE_RELEASE_NOTES-chipmate-{EXPECTED_VERSION}.md",
        f"SHA256SUMS-chipmate-{EXPECTED_VERSION}-offline.txt",
        EXPECTED_LINUX_VSIX,
        EXPECTED_WINDOWS_VSIX,
    ]
)

REQUIRED_CLI_MARKERS = [
    ("source-backed-detail-design", b"source-backed-detail-design"),
    ("generic Word/Mermaid/artifact guidance", b"generic Word/Mermaid/artifact guidance"),
    ("not a migrated Word/document contract", b"not a migrated Word/document contract"),
]

FORBIDDEN_CLI_MARKERS = [
    ("validate_artifacts", b"validate_artifacts"),
    ("nextToolContract", b"nextToolContract"),
    ("missingDeliverable", b"missingDeliverable"),
    ("missing-required-artifact", b"missing-required-artifact"),
    ("missing-mermaid-pngs", b"missing-mermaid-pngs"),
    ("先渲染缺失图表", "先渲染缺失图表".encode()),
    ("缺失文档合同规划", "缺失文档合同规划".encode()),
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def read_tar_member(tar: tarfile.TarFile, name: str) -> bytes:
    try:
        member = tar.getmember(name)
    except KeyError:
        fail(f"missing tar member: {name}")
    extracted = tar.extractfile(member)
    if extracted is None:
        fail(f"tar member is not a regular file: {name}")
    return extracted.read()


def verify_vsix_cli_markers(vsix_data: bytes, cli_member: str, label: str) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(vsix_data)) as zf:
            cli_data = zf.read(cli_member)
    except Exception as exc:
        fail(f"{label} VSIX CLI marker read failed for {cli_member}: {exc}")

    for marker_label, marker in REQUIRED_CLI_MARKERS:
        if marker not in cli_data:
            fail(f"{label} VSIX missing required CLI marker: {marker_label}")
    for marker_label, marker in FORBIDDEN_CLI_MARKERS:
        if marker in cli_data:
            fail(f"{label} VSIX contains forbidden old ChipMate contract marker: {marker_label}")


def write_summary(
    evidence_dir: Path,
    bundle_path: Path,
    bundle_sha: str,
    bundle_size: int,
    linux_sha: str,
    windows_sha: str,
) -> None:
    summary = evidence_dir / "summary.md"
    summary.write_text(
        "\n".join(
            [
                "# ChipMate Offline Target Python Verification",
                "",
                "- Status: PASS",
                "- Target kind: cross-platform python",
                f"- Bundle: `{bundle_path}`",
                f"- Bundle SHA256: `{bundle_sha}`",
                f"- Bundle size: `{bundle_size}`",
                f"- Version: `{EXPECTED_VERSION}`",
                f"- Linux VSIX SHA256: `{linux_sha}`",
                f"- Windows VSIX SHA256: `{windows_sha}`",
                "- VSIX CLI marker boundary: `PASS`",
                "- Tar contents evidence: `tar-contents.actual.txt`",
                "- Tar contents expected: `tar-contents.expected.txt`",
                "",
                "This verifies transfer/package integrity only. It does not prove installed VS Code chat QA, Document RAG, autocomplete, Agent Terminal, Word, Mermaid, or source-backed detail-design runtime behavior.",
                "",
            ]
        ),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path)
    parser.add_argument("evidence_dir", nargs="?", type=Path, default=Path(f"chipmate-{EXPECTED_VERSION}-offline-target-python-evidence"))
    args = parser.parse_args()

    bundle_path = args.bundle
    evidence_dir = args.evidence_dir

    if not bundle_path.is_file():
        fail(f"bundle not found: {bundle_path}")
    evidence_dir.mkdir(parents=True, exist_ok=True)

    bundle_sha = sha256_file(bundle_path)
    bundle_size = bundle_path.stat().st_size
    if bundle_sha != EXPECTED_BUNDLE_SHA:
        fail(f"bundle sha mismatch: expected {EXPECTED_BUNDLE_SHA} got {bundle_sha}")
    if bundle_size != EXPECTED_BUNDLE_SIZE:
        fail(f"bundle size mismatch: expected {EXPECTED_BUNDLE_SIZE} got {bundle_size}")

    with tarfile.open(bundle_path, mode="r:gz") as tar:
        names = sorted(member.name for member in tar.getmembers())
        (evidence_dir / "tar-contents.actual.txt").write_text("\n".join(names) + "\n", encoding="utf-8")
        (evidence_dir / "tar-contents.expected.txt").write_text("\n".join(EXPECTED_CONTENTS) + "\n", encoding="utf-8")
        if names != EXPECTED_CONTENTS:
            fail("tar contents differ from expected six-file bundle")
        if any(name.startswith("._") or "/._" in name or name.startswith("__MACOSX") or "/__MACOSX" in name or name.endswith(".DS_Store") for name in names):
            fail("macOS metadata found in tar contents")

        linux_vsix_data = read_tar_member(tar, EXPECTED_LINUX_VSIX)
        windows_vsix_data = read_tar_member(tar, EXPECTED_WINDOWS_VSIX)
        linux_sha = hashlib.sha256(linux_vsix_data).hexdigest()
        windows_sha = hashlib.sha256(windows_vsix_data).hexdigest()
        if linux_sha != EXPECTED_LINUX_SHA:
            fail(f"linux vsix sha mismatch: expected {EXPECTED_LINUX_SHA} got {linux_sha}")
        if windows_sha != EXPECTED_WINDOWS_SHA:
            fail(f"windows vsix sha mismatch: expected {EXPECTED_WINDOWS_SHA} got {windows_sha}")
        verify_vsix_cli_markers(linux_vsix_data, "extension/bin/chipmate", "linux")
        verify_vsix_cli_markers(windows_vsix_data, "extension/bin/chipmate.exe", "windows")

        release_index = json.loads(read_tar_member(tar, f"OFFLINE_RELEASE_INDEX-chipmate-{EXPECTED_VERSION}.json").decode("utf-8"))
        if release_index.get("version") != EXPECTED_VERSION:
            fail(f"release index version mismatch: {release_index.get('version')}")

        sha_sums = read_tar_member(tar, f"SHA256SUMS-chipmate-{EXPECTED_VERSION}-offline.txt").decode("utf-8", errors="replace")
        if EXPECTED_LINUX_SHA not in sha_sums:
            fail("sha256 sums file missing linux vsix hash")
        if EXPECTED_WINDOWS_SHA not in sha_sums:
            fail("sha256 sums file missing windows vsix hash")

    write_summary(evidence_dir, bundle_path, bundle_sha, bundle_size, linux_sha, windows_sha)
    print(f"PASS: wrote {evidence_dir / 'summary.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
