#!/usr/bin/env python3
"""
Cross-platform verifier for the ChipMate 0.0.38 offline delivery directory.

This verifier checks delivery metadata and package-transfer integrity before a
target machine extracts/installs the VSIX files:
- delivery manifest JSON/Markdown checksum sidecar
- delivery checksum list
- main handoff bundle SHA256/size
- target verify kit SHA256/size
- expected helper files inside the target verify kit

Boundary: this does not install VS Code extensions and does not prove runtime
S1-S16 behavior.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tarfile
from pathlib import Path


VERSION = "0.0.38"
MAIN_BUNDLE = f"chipmate-{VERSION}-offline-handoff.tar.gz"
MAIN_BUNDLE_SHA = f"{MAIN_BUNDLE}.sha256"
VERIFY_KIT = f"chipmate-{VERSION}-offline-target-verify-kit.tar.gz"
VERIFY_KIT_SHA = f"{VERIFY_KIT}.sha256"
DELIVERY_MANIFEST_JSON = f"CHIPMATE_OFFLINE_DELIVERY_MANIFEST-{VERSION}.json"
DELIVERY_MANIFEST_MD = f"CHIPMATE_OFFLINE_DELIVERY_MANIFEST-{VERSION}.md"
DELIVERY_SUMS = f"SHA256SUMS-chipmate-{VERSION}-offline-delivery.txt"
MANIFEST_SUMS = f"SHA256SUMS-chipmate-{VERSION}-offline-delivery-manifest.txt"

EXPECTED_KIT_MEMBERS = {
    f"chipmate-{VERSION}-offline-target-verify-kit/README.md",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-offline-target-validation-runbook.md",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-offline-target-run-linux.sh",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-offline-target-run-windows.cmd",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-offline-target-run-windows.ps1",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-offline-target-verify-linux.sh",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-offline-target-verify-windows.ps1",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-offline-target-verify.py",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-offline-delivery-set-verify.py",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-target-evidence-intake-verify.py",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-target-evidence-return-pack.py",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-runtime-smoke-intake-verify.py",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-target-runtime-evidence-bootstrap.py",
    f"chipmate-{VERSION}-offline-target-verify-kit/chipmate-feature-migration-target-evidence-return-template.md",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def parse_sha256_lines(path: Path) -> dict[str, str]:
    checksums: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 2:
            fail(f"invalid checksum line in {path.name}: {line}")
        checksums[parts[-1]] = parts[0].lower()
    return checksums


def verify_checksum_file(base_dir: Path, checksum_file: str, expected_names: set[str]) -> list[str]:
    path = base_dir / checksum_file
    if not path.is_file():
        fail(f"missing checksum file: {checksum_file}")
    checksums = parse_sha256_lines(path)
    missing = expected_names - set(checksums)
    if missing:
        fail(f"{checksum_file} missing entries: {', '.join(sorted(missing))}")
    extra = set(checksums) - expected_names
    if extra:
        fail(f"{checksum_file} has unexpected entries: {', '.join(sorted(extra))}")
    checks: list[str] = []
    for name in sorted(expected_names):
        target = base_dir / name
        if not target.is_file():
            fail(f"missing file referenced by {checksum_file}: {name}")
        actual = sha256_file(target)
        expected = checksums[name]
        if actual != expected:
            fail(f"checksum mismatch for {name}: expected {expected} got {actual}")
        checks.append(f"{checksum_file}: {name} OK")
    return checks


def check_no_macos_metadata(names: list[str], label: str) -> None:
    for name in names:
        if name.startswith("._") or "/._" in name or name.startswith("__MACOSX") or "/__MACOSX" in name or name.endswith(".DS_Store"):
            fail(f"macOS metadata found in {label}: {name}")


def verify_kit_contents(base_dir: Path) -> list[str]:
    kit = base_dir / VERIFY_KIT
    if not kit.is_file():
        fail(f"missing target verify kit: {VERIFY_KIT}")
    with tarfile.open(kit, mode="r:gz") as tar:
        names = sorted(member.name for member in tar.getmembers())
    check_no_macos_metadata(names, VERIFY_KIT)
    missing = EXPECTED_KIT_MEMBERS - set(names)
    if missing:
        fail(f"target verify kit missing expected members: {', '.join(sorted(missing))}")
    return [f"target verify kit contains {len(EXPECTED_KIT_MEMBERS)} expected helper files"]


def write_summary(output: Path, checks: list[str]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# ChipMate Offline Delivery Set Verify",
        "",
        "- Status: PASS",
        f"- Version: `{VERSION}`",
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
            "This verifies offline delivery metadata and package-transfer integrity only. It does not replace target-machine VS Code install/runtime smoke S1-S16 or M11 no-regression review.",
            "",
        ]
    )
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("delivery_dir", type=Path)
    parser.add_argument("--output", type=Path, default=Path(f"chipmate-{VERSION}-offline-delivery-set-verify-summary.md"))
    args = parser.parse_args()

    base_dir = args.delivery_dir
    if not base_dir.is_dir():
        fail(f"delivery directory not found: {base_dir}")

    required_files = {
        MAIN_BUNDLE,
        MAIN_BUNDLE_SHA,
        VERIFY_KIT,
        VERIFY_KIT_SHA,
        DELIVERY_MANIFEST_JSON,
        DELIVERY_MANIFEST_MD,
        DELIVERY_SUMS,
        MANIFEST_SUMS,
    }
    for name in sorted(required_files):
        if not (base_dir / name).is_file():
            fail(f"missing delivery file: {name}")

    checks: list[str] = []
    manifest = json.loads((base_dir / DELIVERY_MANIFEST_JSON).read_text(encoding="utf-8"))
    if manifest.get("version") != VERSION:
        fail(f"manifest version mismatch: {manifest.get('version')}")
    checks.append("manifest JSON parses and version matches")

    checks.extend(verify_checksum_file(base_dir, MANIFEST_SUMS, {DELIVERY_MANIFEST_JSON, DELIVERY_MANIFEST_MD}))
    checks.extend(verify_checksum_file(base_dir, DELIVERY_SUMS, {MAIN_BUNDLE, MAIN_BUNDLE_SHA, VERIFY_KIT, VERIFY_KIT_SHA}))

    main_sha = sha256_file(base_dir / MAIN_BUNDLE)
    kit_sha = sha256_file(base_dir / VERIFY_KIT)
    main_size = (base_dir / MAIN_BUNDLE).stat().st_size
    kit_size = (base_dir / VERIFY_KIT).stat().st_size

    primary = manifest.get("primaryBundle") or {}
    target_kit = manifest.get("targetVerifyKit") or {}
    if primary.get("sha256") != main_sha:
        fail("manifest primary bundle SHA does not match actual file")
    if primary.get("size") != main_size:
        fail("manifest primary bundle size does not match actual file")
    if target_kit.get("sha256") != kit_sha:
        fail("manifest target verify kit SHA does not match actual file")
    if target_kit.get("size") != kit_size:
        fail("manifest target verify kit size does not match actual file")
    if not target_kit.get("containsPythonVerifier"):
        fail("manifest does not record containsPythonVerifier=true")
    if not target_kit.get("containsCliMarkerBoundaryChecks"):
        fail("manifest does not record containsCliMarkerBoundaryChecks=true")
    if not target_kit.get("containsTargetEvidenceIntakeVerifier"):
        fail("manifest does not record containsTargetEvidenceIntakeVerifier=true")
    if not target_kit.get("containsTargetEvidenceReturnPackHelper"):
        fail("manifest does not record containsTargetEvidenceReturnPackHelper=true")
    if not target_kit.get("targetEvidenceReturnPackSupportsVerify"):
        fail("manifest does not record targetEvidenceReturnPackSupportsVerify=true")
    if not target_kit.get("containsRuntimeSmokeIntakeVerifier"):
        fail("manifest does not record containsRuntimeSmokeIntakeVerifier=true")
    if not target_kit.get("runtimeSmokeIntakeSupportsS16SourceGuard"):
        fail("manifest does not record runtimeSmokeIntakeSupportsS16SourceGuard=true")
    if not target_kit.get("targetEvidenceTemplateRequiresRuntimeIntakeSummary"):
        fail("manifest does not record targetEvidenceTemplateRequiresRuntimeIntakeSummary=true")
    if not target_kit.get("targetEvidenceIntakeReadsRuntimeSmokeTsv"):
        fail("manifest does not record targetEvidenceIntakeReadsRuntimeSmokeTsv=true")
    if not target_kit.get("targetEvidenceIntakeRequiresReturnTemplate"):
        fail("manifest does not record targetEvidenceIntakeRequiresReturnTemplate=true")
    if not target_kit.get("targetEvidenceIntakeRejectsTemplateContradictions"):
        fail("manifest does not record targetEvidenceIntakeRejectsTemplateContradictions=true")
    if not target_kit.get("containsTargetRuntimeEvidenceBootstrap"):
        fail("manifest does not record containsTargetRuntimeEvidenceBootstrap=true")
    if not target_kit.get("targetPackageRunnersGenerateRuntimeEvidenceSkeleton"):
        fail("manifest does not record targetPackageRunnersGenerateRuntimeEvidenceSkeleton=true")
    if not target_kit.get("targetPackageRunnersCaptureOptionalWordRenderer"):
        fail("manifest does not record targetPackageRunnersCaptureOptionalWordRenderer=true")
    if not target_kit.get("targetPackageRunnersReturnDeliveryManifest"):
        fail("manifest does not record targetPackageRunnersReturnDeliveryManifest=true")
    if not target_kit.get("runbookDocumentsOptionalWordRenderer"):
        fail("manifest does not record runbookDocumentsOptionalWordRenderer=true")
    checks.append("manifest bundle and target verify kit metadata match actual files")

    delivery_checksum_sha = sha256_file(base_dir / DELIVERY_SUMS)
    delivery_checksum_info = manifest.get("deliveryChecksumFile") or {}
    if delivery_checksum_info.get("sha256") != delivery_checksum_sha:
        fail("manifest delivery checksum file SHA does not match actual file")
    checks.append("manifest delivery checksum file SHA matches actual file")

    checks.extend(verify_kit_contents(base_dir))

    write_summary(args.output, checks)
    print(f"PASS: wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
