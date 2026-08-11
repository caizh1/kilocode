#!/usr/bin/env python3
"""Generate operator requests for offline Windows/Linux target execution.

This source-workstation helper reads the current offline delivery manifest and
emits concise target-owner instructions.  It does not execute target validation,
does not accept evidence, and does not decide M11.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


VERSION = "0.0.38"


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise SystemExit(f"delivery manifest not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def target_label(target: str) -> str:
    return "Linux x86-64" if target == "linux-x64" else "Windows x86-64"


def command_block(target: str) -> str:
    if target == "linux-x64":
        return """```bash
# In the extracted chipmate-0.0.38-offline-delivery-set directory:
shasum -a 256 -c SHA256SUMS-chipmate-0.0.38-offline-delivery-manifest.txt
shasum -a 256 -c SHA256SUMS-chipmate-0.0.38-offline-delivery.txt
tar -xzf chipmate-0.0.38-offline-target-verify-kit.tar.gz
python3 chipmate-0.0.38-offline-target-verify-kit/chipmate-feature-migration-offline-delivery-set-verify.py . --output evidence-delivery-set.md
bash chipmate-0.0.38-offline-target-verify-kit/chipmate-feature-migration-offline-target-run-linux.sh . evidence-linux-package
code --install-extension chipmate-vscode-linux-x64-baseline.vsix --force

# After package checks and any installed runtime smoke evidence are collected:
python3 chipmate-0.0.38-offline-target-verify-kit/chipmate-feature-migration-target-evidence-return-pack.py \
  --target linux-x64 \
  --evidence-dir evidence-linux-package \
  --output-dir returned-evidence
```"""
    return """```powershell
# In the extracted chipmate-0.0.38-offline-delivery-set directory:
Get-FileHash -Algorithm SHA256 .\\CHIPMATE_OFFLINE_DELIVERY_MANIFEST-0.0.38.json
Get-FileHash -Algorithm SHA256 .\\chipmate-0.0.38-offline-delivery-set.zip
tar -xzf .\\chipmate-0.0.38-offline-target-verify-kit.tar.gz
python .\\chipmate-0.0.38-offline-target-verify-kit\\chipmate-feature-migration-offline-delivery-set-verify.py . --output evidence-delivery-set.md
powershell -ExecutionPolicy Bypass -File .\\chipmate-0.0.38-offline-target-verify-kit\\chipmate-feature-migration-offline-target-run-windows.ps1 -DeliveryDir . -EvidenceDir evidence-windows-package
code --install-extension .\\chipmate-vscode-win32-x64-baseline.vsix --force

# After package checks and any installed runtime smoke evidence are collected:
python .\\chipmate-0.0.38-offline-target-verify-kit\\chipmate-feature-migration-target-evidence-return-pack.py `
  --target win32-x64 `
  --evidence-dir evidence-windows-package `
  --output-dir returned-evidence
```"""


def write_request(target: str, manifest: dict[str, Any], output: Path) -> None:
    primary = manifest.get("primaryBundle") or {}
    kit = manifest.get("targetVerifyKit") or {}
    checksum = manifest.get("deliveryChecksumFile") or {}
    target_order = manifest.get("targetOrder") or []
    lines = [
        f"# ChipMate Offline Target Execution Request: {target_label(target)}",
        "",
        f"- Status: `REQUEST_PENDING_TARGET_EXECUTION`",
        f"- Product: `{manifest.get('product', 'ChipMate')}`",
        f"- Version: `{manifest.get('version', VERSION)}`",
        f"- Target: `{target}`",
        "",
        "## Current delivery artifacts",
        "",
        "| Artifact | Size | SHA256 |",
        "|---|---:|---|",
        f"| `{primary.get('file', 'chipmate-0.0.38-offline-handoff.tar.gz')}` | `{primary.get('size', 'n/a')}` | `{primary.get('sha256', 'n/a')}` |",
        f"| `{kit.get('file', 'chipmate-0.0.38-offline-target-verify-kit.tar.gz')}` | `{kit.get('size', 'n/a')}` | `{kit.get('sha256', 'n/a')}` |",
        f"| `{checksum.get('file', 'SHA256SUMS-chipmate-0.0.38-offline-delivery.txt')}` | checksum file | `{checksum.get('sha256', 'n/a')}` |",
        "",
        "## Target-side commands",
        "",
        command_block(target),
        "",
        "## Evidence to return",
        "",
        "- `evidence-delivery-set.md`",
        "- target package evidence directory, for example `evidence-linux-package` or `evidence-windows-package`",
        "- returned evidence `.tar.gz` or `.zip` plus `*-SHA256SUMS.txt` from `chipmate-feature-migration-target-evidence-return-pack.py`",
        "- screenshots/logs for VS Code install, activation, Agent Terminal UX, and any S1-S16 runtime smoke attempted",
        "- if runtime smoke is attempted, include `runtime-intake-summary.md` and completed `runtime-smoke.tsv`",
        "",
        "## Migration-workstation receiving step",
        "",
        "Before M11 review or target evidence intake, verify the returned archive:",
        "",
        "```bash",
        "python3 docs/chipmate-feature-migration-target-evidence-return-pack.py \\",
        "  --verify-pack <returned-evidence.tar.gz-or.zip> \\",
        "  --checksum-file <returned-evidence-SHA256SUMS.txt> \\",
        "  --output-summary <returned-evidence-verify-summary.md>",
        "```",
        "",
        "## Manifest target order",
        "",
    ]
    lines.extend(f"{index}. {item}" for index, item in enumerate(target_order, 1))
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "This request is an operator handoff only. It does not prove package execution, installed runtime S1-S16, native ChipMate QA preservation, S16 autocomplete behavior, or M11 no-regression until target evidence is returned and accepted.",
            "",
        ]
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("packages/chipmate-vscode/out/CHIPMATE_OFFLINE_DELIVERY_MANIFEST-0.0.38.json"))
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    outputs = {
        "linux-x64": args.output_dir / "linux-x64-target-execution-request.md",
        "win32-x64": args.output_dir / "win32-x64-target-execution-request.md",
    }
    for target, output in outputs.items():
        write_request(target, manifest, output)
        print(f"WROTE: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
