#!/usr/bin/env python3
"""Roll up Artifact acceptance evidence for ChipMate feature migration.

This helper is read-only. It checks the deterministic artifact lifecycle smoke
and the current runtime direct-tool S4 evidence before allowing the local
Acceptance Matrix artifact item to be marked complete with review limits.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


DEFAULT_DETERMINISTIC = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260708-222000-artifact-manifest-deterministic-smoke/"
    "summary.md"
)
DEFAULT_RUNTIME_SUMMARY = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260708-233500-runtime-s3-s4-direct-tool-smoke/"
    "summary.md"
)
DEFAULT_RUNTIME_GUARD = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260708-233500-runtime-s3-s4-direct-tool-smoke/"
    "s4-guard.txt"
)
DEFAULT_RUNTIME_LOG = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260708-233500-runtime-s3-s4-direct-tool-smoke/"
    "s4.log"
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""


def field(text: str, name: str) -> str | None:
    match = re.search(rf"(?im)^\s*[-*]?\s*{re.escape(name)}\s*:\s*`?([^`\n]+?)`?\s*$", text)
    return match.group(1).strip() if match else None


def runtime_s4_row_ok(text: str) -> bool:
    for line in text.splitlines():
        cells = [cell.strip().strip("`") for cell in line.strip().strip("|").split("|")]
        if len(cells) >= 5 and cells[0] == "S4":
            return cells[2] == "NEEDS_REVIEW" and cells[3] == "0"
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deterministic-summary", type=Path, default=DEFAULT_DETERMINISTIC)
    parser.add_argument("--runtime-summary", type=Path, default=DEFAULT_RUNTIME_SUMMARY)
    parser.add_argument("--runtime-guard", type=Path, default=DEFAULT_RUNTIME_GUARD)
    parser.add_argument("--runtime-log", type=Path, default=DEFAULT_RUNTIME_LOG)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    deterministic_text = read_text(args.deterministic_summary)
    runtime_text = read_text(args.runtime_summary)
    guard_text = read_text(args.runtime_guard)
    log_text = read_text(args.runtime_log)

    manifest = field(deterministic_text, "Manifest")
    primary_report = field(deterministic_text, "Primary report")
    diagnostics = field(deterministic_text, "Diagnostics")

    checks = {
        "deterministicSummaryExists": bool(deterministic_text),
        "deterministicStatusPass": field(deterministic_text, "Status") == "PASS",
        "manifestPathRecorded": bool(manifest),
        "manifestExists": bool(manifest and Path(manifest).is_file()),
        "primaryReportExists": bool(primary_report and Path(primary_report).is_file()),
        "diagnosticsExists": bool(diagnostics and Path(diagnostics).is_file()),
        "listedByArtifactManager": field(deterministic_text, "Listed by artifact manager") == "yes",
        "openedManifestPath": field(deterministic_text, "Opened manifest path") == "yes",
        "runtimeSummaryExists": bool(runtime_text),
        "runtimeS4RowNeedsReviewExit0": runtime_s4_row_ok(runtime_text),
        "runtimeS4GuardPassed": guard_text.strip() == "guardrails passed",
        "runtimeLogMentionsDeclareArtifact": "declare_artifact" in log_text,
    }

    status = "PASS_WITH_REVIEW" if all(checks.values()) else "FAIL"
    report = {
        "status": status,
        "checks": checks,
        "deterministicSummary": str(args.deterministic_summary),
        "runtimeSummary": str(args.runtime_summary),
        "runtimeGuard": str(args.runtime_guard),
        "runtimeLog": str(args.runtime_log),
        "manifest": manifest,
        "primaryReport": primary_report,
        "diagnostics": diagnostics,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix(".json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    lines = [
        "# Artifact Acceptance Rollup",
        "",
        f"- Status: `{status}`",
        f"- Deterministic summary: `{args.deterministic_summary}`",
        f"- Runtime summary: `{args.runtime_summary}`",
        f"- Runtime guard: `{args.runtime_guard}`",
        f"- Runtime log: `{args.runtime_log}`",
        f"- Manifest: `{manifest or 'missing'}`",
        f"- Primary report: `{primary_report or 'missing'}`",
        f"- Diagnostics: `{diagnostics or 'missing'}`",
        "",
        "## Checks",
    ]
    for name, value in checks.items():
        lines.append(f"- {name}: `{'yes' if value else 'no'}`")
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "This rollup only closes the local Artifact acceptance item. It does not prove installed VSIX S1-S16, target Windows/Linux runtime execution, or final M11 no-regression.",
            "",
        ]
    )
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(f"Status: {status}")
    print(f"Summary: {args.output}")
    return 0 if status == "PASS_WITH_REVIEW" else 1


if __name__ == "__main__":
    raise SystemExit(main())
