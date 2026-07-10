#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${VALIDATION_RUN_DIR:-${REPO_ROOT}/docs/chipmate-feature-migration-validation-runs/${RUN_STAMP}-package-marker-audit}"

mkdir -p "${RUN_DIR}"

python3 - <<'PY' "${REPO_ROOT}" "${RUN_DIR}"
from __future__ import annotations

import json
import sys
import tarfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

repo = Path(sys.argv[1])
run_dir = Path(sys.argv[2])
out_dir = repo / "packages/kilo-vscode/out"

patterns = [
    "nextToolContract",
    "missingDeliverable",
    "validate_artifacts",
    "missing-required-artifact",
    "missing-mermaid-pngs",
    "建议先渲染缺失图表",
    "缺失文档合同规划",
    "missing-diagram auto-repair",
    "missing diagram auto-repair",
    "missing-document contract planning",
    "missing document contract planning",
    "document-contract planning",
    "auto-render missing diagrams",
    "render missing diagrams first",
    "suggest render missing diagrams",
]

vsix_include_prefixes = (
    "extension/dist/",
    "extension/.kilo/skills/",
    "extension/package.json",
    "extension/extension.vsixmanifest",
)
vsix_exclude_prefixes = (
    "extension/docs/",
    "extension/tests/",
    "extension/readme",
    "extension/changelog",
    "extension/LICENSE",
    "extension/THIRD-PARTY",
)
text_suffixes = (
    ".js",
    ".css",
    ".json",
    ".jsonc",
    ".md",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
)


@dataclass
class Match:
    artifact: str
    member: str
    pattern: str
    line: int
    excerpt: str


def is_probably_text_member(name: str, size: int) -> bool:
    if size > 8 * 1024 * 1024:
        return False
    return name.endswith(text_suffixes)


def should_scan_vsix_member(name: str, size: int) -> bool:
    if any(name.startswith(prefix) for prefix in vsix_exclude_prefixes):
        return False
    if not any(name == prefix or name.startswith(prefix) for prefix in vsix_include_prefixes):
        return False
    return is_probably_text_member(name, size)


def scan_text(artifact: str, member: str, data: bytes) -> list[Match]:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="ignore")
    found: list[Match] = []
    for lineno, line in enumerate(text.splitlines(), 1):
        for pattern in patterns:
            if pattern in line:
                found.append(Match(artifact, member, pattern, lineno, line.strip()[:240]))
    return found


matches: list[Match] = []
scanned: list[dict[str, object]] = []

for path in sorted(out_dir.glob("*.vsix")):
    scanned_members = 0
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            if info.is_dir() or not should_scan_vsix_member(info.filename, info.file_size):
                continue
            scanned_members += 1
            matches.extend(scan_text(path.name, info.filename, zf.read(info)))
    scanned.append({"artifact": path.name, "kind": "vsix-runtime-surface", "scannedMembers": scanned_members})

for path in sorted(out_dir.glob("CHIPMATE_OFFLINE_DELIVERY_MANIFEST-*.json")) + sorted(
    out_dir.glob("CHIPMATE_OFFLINE_DELIVERY_MANIFEST-*.md")
) + sorted(out_dir.glob("OFFLINE_RELEASE_INDEX-*.json")) + sorted(out_dir.glob("OFFLINE_RELEASE_INDEX-*.md")):
    matches.extend(scan_text(path.name, path.name, path.read_bytes()))
    scanned.append({"artifact": path.name, "kind": "delivery-metadata", "scannedMembers": 1})

kit_path = out_dir / "chipmate-0.0.38-offline-target-verify-kit.tar.gz"
kit_boundary: dict[str, object] = {"artifact": kit_path.name, "kind": "target-kit-boundary", "checked": False}
if kit_path.exists():
    forbidden_source_helpers = {
        "chipmate-0.0.38-offline-target-verify-kit/chipmate-feature-migration-runtime-smoke.sh",
        "chipmate-0.0.38-offline-target-verify-kit/chipmate-feature-migration-document-rag-readiness-smoke.sh",
        "chipmate-0.0.38-offline-target-verify-kit/chipmate-feature-migration-document-rag-readiness-smoke-windows.ps1",
        "chipmate-0.0.38-offline-target-verify-kit/chipmate-feature-migration-s16-source-guard.sh",
    }
    with tarfile.open(kit_path, "r:gz") as tar:
        members = set(tar.getnames())
    present = sorted(forbidden_source_helpers & members)
    kit_boundary.update({"checked": True, "forbiddenSourceHelpersPresent": present, "memberCount": len(members)})
    if present:
        for member in present:
            matches.append(Match(kit_path.name, member, "source-checkout-only-helper-packaged", 0, member))
scanned.append(kit_boundary)

matches_path = run_dir / "package-forbidden-marker-matches.json"
matches_path.write_text(
    json.dumps([match.__dict__ for match in matches], indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)

scanned_path = run_dir / "package-marker-scanned-surfaces.json"
scanned_path.write_text(json.dumps(scanned, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

status = "PASS" if not matches else "FAIL"
summary = run_dir / "summary.md"
summary.write_text(
    "\n".join(
        [
            "# Package Contract Marker Audit",
            "",
            f"- Status: `{status}`",
            "- Scope: VSIX runtime surfaces (`extension/dist`, `extension/.kilo/skills`, package manifest), offline delivery manifests, and target-kit source-helper exclusion boundary.",
            "- Excluded: historical docs/tests/readme/changelog/license files inside VSIX; target verification runbooks may document forbidden markers as guardrails and are not treated as product runtime surfaces.",
            f"- Matches file: `{matches_path.name}`",
            f"- Scanned surfaces file: `{scanned_path.name}`",
            "",
            "## Forbidden markers",
            "",
            *[f"- `{pattern}`" for pattern in patterns],
            "",
            "## Scanned surfaces",
            "",
            *[
                f"- `{item['artifact']}` ({item['kind']}): `{item.get('scannedMembers', item.get('memberCount', 'n/a'))}`"
                for item in scanned
            ],
            "",
            "## Result",
            "",
            "No forbidden ChipMate contract/repair/gating markers were found in package runtime surfaces."
            if not matches
            else "Forbidden marker matches were found; inspect package-forbidden-marker-matches.json.",
            "",
            "This audit does not prove installed runtime behavior. It only checks that packaged runtime surfaces do not carry old ChipMate contract/repair/gating markers and that source-checkout-only helpers were not placed in the standalone target kit.",
        ]
    )
    + "\n",
    encoding="utf-8",
)

print(summary.read_text(encoding="utf-8"))
raise SystemExit(0 if status == "PASS" else 1)
PY
