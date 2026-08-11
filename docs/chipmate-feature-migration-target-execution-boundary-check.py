#!/usr/bin/env python3
"""Record whether the current machine can satisfy target OS execution gates.

This helper is intentionally conservative. It does not execute the target
runners, install VS Code, run QA, or mark Windows/Linux target evidence as
accepted. It only records whether the current source workstation can be treated
as the requested offline target environment.
"""

from __future__ import annotations

import argparse
import platform
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = (
    ROOT
    / "docs/chipmate-feature-migration-validation-runs/"
    "20260709-163000-target-execution-boundary-check/summary.md"
)


DELIVERY_ARTIFACTS = [
    "packages/chipmate-vscode/out/chipmate-0.0.38-offline-handoff.tar.gz",
    "packages/chipmate-vscode/out/chipmate-0.0.38-offline-target-verify-kit.tar.gz",
    "packages/chipmate-vscode/out/chipmate-0.0.38-offline-delivery-set.tar.gz",
    "packages/chipmate-vscode/out/chipmate-0.0.38-offline-delivery-set.zip",
    "packages/chipmate-vscode/out/CHIPMATE_OFFLINE_DELIVERY_MANIFEST-0.0.38.json",
]


TARGET_RUNNERS = [
    "docs/chipmate-feature-migration-offline-target-run-linux.sh",
    "docs/chipmate-feature-migration-offline-target-run-windows.ps1",
    "docs/chipmate-feature-migration-offline-target-run-windows.cmd",
]


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def yes_no(value: bool) -> str:
    return "yes" if value else "no"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    system = platform.system()
    machine = platform.machine()
    docker = shutil.which("docker")
    python = shutil.which("python3") or shutil.which("python")
    powershell = shutil.which("pwsh") or shutil.which("powershell")

    is_linux_x64 = system == "Linux" and machine in {"x86_64", "AMD64", "amd64"}
    is_windows_x64 = system == "Windows" and machine in {"AMD64", "x86_64", "amd64"}
    can_satisfy_linux_target = is_linux_x64
    can_satisfy_windows_target = is_windows_x64

    missing_artifacts = [path for path in DELIVERY_ARTIFACTS if not (ROOT / path).exists()]
    missing_runners = [path for path in TARGET_RUNNERS if not (ROOT / path).exists()]

    status = "PASS_BOUNDARY_RECORDED"
    lines: list[str] = []
    lines.append("# Target Execution Boundary Check\n\n")
    lines.append(f"- Status: `{status}`\n")
    lines.append(f"- Host system: `{system}`\n")
    lines.append(f"- Host machine: `{machine}`\n")
    lines.append(f"- Python available: `{yes_no(bool(python))}`\n")
    lines.append(f"- Docker command available: `{yes_no(bool(docker))}`\n")
    lines.append(f"- PowerShell command available: `{yes_no(bool(powershell))}`\n")
    lines.append(f"- Can satisfy offline Linux x86-64 target execution on this host directly: `{yes_no(can_satisfy_linux_target)}`\n")
    lines.append(f"- Can satisfy offline Windows x86-64 target execution on this host directly: `{yes_no(can_satisfy_windows_target)}`\n")
    lines.append("- Installed VSIX S1-S16 runtime smoke satisfied by this check: `no`\n")
    lines.append("- Package-only runner may close target runtime blocker: `no`\n")
    lines.append("\n")
    lines.append("## Delivery artifacts present\n\n")
    for artifact in DELIVERY_ARTIFACTS:
        lines.append(f"- `{artifact}`: `{yes_no((ROOT / artifact).exists())}`\n")
    lines.append("\n")
    lines.append("## Target runners present\n\n")
    for runner in TARGET_RUNNERS:
        lines.append(f"- `{runner}`: `{yes_no((ROOT / runner).exists())}`\n")
    lines.append("\n")
    lines.append("## Missing inputs\n\n")
    if missing_artifacts or missing_runners:
        for path in missing_artifacts:
            lines.append(f"- Missing delivery artifact: `{path}`\n")
        for path in missing_runners:
            lines.append(f"- Missing target runner: `{path}`\n")
    else:
        lines.append("- None\n")
    lines.append("\n")
    lines.append("## Interpretation\n\n")
    lines.append(
        "This source workstation can prepare and inspect delivery artifacts, but it cannot by itself "
        "satisfy the offline Windows x86-64 or offline Linux x86-64 target execution gates unless "
        "the host environment actually matches that target OS/architecture and the target runner "
        "evidence is returned through the typed target-evidence intake path.\n\n"
    )
    lines.append(
        "Docker availability alone is not accepted as Windows target evidence, and package-only "
        "integrity checks do not replace installed VSIX S1-S16 runtime smoke, ChipMate native QA "
        "no-regression review, or final M11 review.\n\n"
    )
    lines.append(
        "This helper does not migrate QA, does not run autocomplete, does not execute Document RAG, "
        "does not install VSIX files, and does not reintroduce ChipMate contract/repair/gating "
        "behavior.\n"
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(lines), encoding="utf-8")
    print(f"Status: {status}")
    print(f"Summary: {rel(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
