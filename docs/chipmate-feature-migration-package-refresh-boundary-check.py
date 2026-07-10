#!/usr/bin/env python3
"""Check whether existing offline packages include latest source-side evidence.

This helper does not rebuild packages and does not mark target execution ready.
It records whether the current offline artifacts contain selected latest
source-side validation helpers/evidence that were added after the earlier
offline package snapshot.
"""

from __future__ import annotations

import argparse
import tarfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = (
    ROOT
    / "docs/chipmate-feature-migration-validation-runs/"
    "20260709-164000-package-refresh-boundary-check/summary.md"
)

ARTIFACTS = [
    "packages/kilo-vscode/out/chipmate-0.0.38-offline-handoff.tar.gz",
    "packages/kilo-vscode/out/chipmate-0.0.38-offline-delivery-set.tar.gz",
    "packages/kilo-vscode/out/chipmate-0.0.38-offline-delivery-set.zip",
    "packages/kilo-vscode/out/chipmate-0.0.38-offline-target-verify-kit.tar.gz",
]

LATEST_SOURCE_SIDE_NEEDLES = [
    "chipmate-feature-migration-target-execution-boundary-check.py",
    "20260709-163000-target-execution-boundary-check/summary.md",
    "chipmate-feature-migration-m11-current-status-dashboard.py",
    "20260709-161000-m11-readiness-after-latest-s3-rerun/summary.md",
    "20260709-160500-document-rag-readiness-rerun-after-marker-guards/document-rag-readiness-summary.md",
]


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def artifact_names(path: Path) -> list[str]:
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as zf:
            return zf.namelist()
    with tarfile.open(path, "r:*") as tf:
        return tf.getnames()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    results: list[tuple[str, str, int, list[str]]] = []
    missing_artifacts: list[str] = []
    any_latest_present = False
    for artifact in ARTIFACTS:
        path = ROOT / artifact
        if not path.exists():
            missing_artifacts.append(artifact)
            continue
        names = artifact_names(path)
        for needle in LATEST_SOURCE_SIDE_NEEDLES:
            hits = [name for name in names if needle in name]
            if hits:
                any_latest_present = True
            results.append((artifact, needle, len(hits), hits[:5]))

    refresh_required = not any_latest_present
    status = "REFRESH_REQUIRED_FOR_FINAL_DELIVERY" if refresh_required else "LATEST_SOURCE_EVIDENCE_PRESENT"

    lines: list[str] = []
    lines.append("# Package Refresh Boundary Check\n\n")
    lines.append(f"- Status: `{status}`\n")
    lines.append(f"- Existing offline artifacts checked: `{len(ARTIFACTS) - len(missing_artifacts)}`\n")
    lines.append(f"- Missing offline artifacts: `{len(missing_artifacts)}`\n")
    lines.append(f"- Latest source-side evidence present in any checked package: `{'yes' if any_latest_present else 'no'}`\n")
    lines.append("- This check rebuilds packages: `no`\n")
    lines.append("- This check closes M10 packaging acceptance: `no`\n")
    lines.append("- This check closes Windows/Linux target execution: `no`\n")
    lines.append("- This check closes installed VSIX S1-S16 runtime smoke: `no`\n")
    lines.append("\n")
    lines.append("## Checked latest source-side needles\n\n")
    for needle in LATEST_SOURCE_SIDE_NEEDLES:
        lines.append(f"- `{needle}`\n")
    lines.append("\n")
    lines.append("## Missing artifacts\n\n")
    if missing_artifacts:
        for artifact in missing_artifacts:
            lines.append(f"- `{artifact}`\n")
    else:
        lines.append("- None\n")
    lines.append("\n")
    lines.append("## Per-artifact needle hits\n\n")
    lines.append("| Artifact | Needle | Hits |\n")
    lines.append("|---|---|---:|\n")
    for artifact, needle, count, _hits in results:
        lines.append(f"| `{artifact}` | `{needle}` | `{count}` |\n")
    lines.append("\n")
    lines.append("## Interpretation\n\n")
    lines.append(
        "The checked offline package artifacts are still usable as the previously built package snapshot, "
        "but they do not contain the latest source-side validation helpers/evidence listed above. "
        "Before a final offline handoff is claimed to include the current M11 evidence chain, the "
        "offline handoff/delivery artifacts should be regenerated or the release notes must explicitly "
        "state that these source-side evidence updates are outside the packaged target kit.\n\n"
    )
    lines.append(
        "This boundary is intentionally conservative. It does not change package hashes, does not execute "
        "target runners, does not install VSIX files, and does not migrate ChipMate QA or contract/repair/"
        "gating behavior.\n"
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(lines), encoding="utf-8")
    print(f"Status: {status}")
    print(f"Summary: {rel(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
