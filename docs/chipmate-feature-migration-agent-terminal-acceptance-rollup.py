#!/usr/bin/env python3
"""Roll up Agent Terminal local acceptance evidence.

This helper is read-only. It checks focused Agent Terminal service/runtime
coverage, development extension-host contribution evidence, and installed VSIX
command smoke evidence before allowing the local Agent Terminal Acceptance
Matrix item to close with review limits.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


DEFAULT_FOCUSED = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260708-224000-agent-terminal-current-focused-smoke/"
    "summary.md"
)
DEFAULT_EXTENSION_HOST = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260708-090621-expanded-extension-host-smoke/"
    "summary.md"
)
DEFAULT_INSTALLED_LINUX = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260708-130125-48658-1082-installed-vsix-host-smoke/"
    "summary.md"
)
DEFAULT_INSTALLED_WINDOWS = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260708-130129-48912-19989-installed-vsix-host-smoke/"
    "summary.md"
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""


def has_all(text: str, needles: list[str]) -> bool:
    return bool(text) and all(needle in text for needle in needles)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--focused-summary", type=Path, default=DEFAULT_FOCUSED)
    parser.add_argument("--extension-host-summary", type=Path, default=DEFAULT_EXTENSION_HOST)
    parser.add_argument("--installed-linux-summary", type=Path, default=DEFAULT_INSTALLED_LINUX)
    parser.add_argument("--installed-windows-summary", type=Path, default=DEFAULT_INSTALLED_WINDOWS)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    focused_text = read_text(args.focused_summary)
    extension_host_text = read_text(args.extension_host_summary)
    installed_linux_text = read_text(args.installed_linux_summary)
    installed_windows_text = read_text(args.installed_windows_summary)

    checks = {
        "focusedSummaryExists": bool(focused_text),
        "focusedStatusPass": "- Status: `PASS`" in focused_text and "- Exit code: `0`" in focused_text,
        "focusedCoversPlanningAndClassification": has_all(
            focused_text,
            [
                "plans common natural language prompts without replacing the native shell loop",
                "classifies safe, review, and dangerous commands",
            ],
        ),
        "focusedCoversDefaultOffOpenCancel": has_all(
            focused_text,
            [
                "opens a default-off sidecar terminal after workspace confirmation",
                "does not open a terminal when the default-off prompt is cancelled",
            ],
        ),
        "focusedCoversHelperContextAndLogs": has_all(
            focused_text,
            [
                "creates workspace-scoped context summaries and log artifacts",
                "helper/context generation",
                "log artifact creation",
            ],
        ),
        "extensionHostSummaryExists": bool(extension_host_text),
        "extensionHostPass": "Exit code: 0" in extension_host_text and "3 passing" in extension_host_text,
        "extensionHostKeepsNativeAndSidecar": "keeps native Kilo contributions present while adding sidecar document and Agent Terminal contributions" in extension_host_text,
        "installedLinuxSummaryExists": bool(installed_linux_text),
        "installedLinuxPass": "Install exit code: 0" in installed_linux_text and "Test exit code: 0" in installed_linux_text and "2 passing" in installed_linux_text,
        "installedLinuxSafeSidecarCommands": "executes safe installed sidecar commands without replacing native commands" in installed_linux_text,
        "installedWindowsSummaryExists": bool(installed_windows_text),
        "installedWindowsPass": "Install exit code: 0" in installed_windows_text and "Test exit code: 0" in installed_windows_text and "2 passing" in installed_windows_text,
        "installedWindowsSafeSidecarCommands": "executes safe installed sidecar commands without replacing native commands" in installed_windows_text,
    }

    status = "PASS_WITH_LIMITS" if all(checks.values()) else "FAIL"
    report = {
        "status": status,
        "checks": checks,
        "focusedSummary": str(args.focused_summary),
        "extensionHostSummary": str(args.extension_host_summary),
        "installedLinuxSummary": str(args.installed_linux_summary),
        "installedWindowsSummary": str(args.installed_windows_summary),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix(".json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    lines = [
        "# Agent Terminal Acceptance Rollup",
        "",
        f"- Status: `{status}`",
        f"- Focused summary: `{args.focused_summary}`",
        f"- Extension-host summary: `{args.extension_host_summary}`",
        f"- Installed Linux-target summary: `{args.installed_linux_summary}`",
        f"- Installed Windows-target summary: `{args.installed_windows_summary}`",
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
            "This rollup only closes the local Agent Terminal Acceptance Matrix item with limits. It proves sidecar contribution, default-off service behavior, natural-language planning/classification, helper/context/log artifacts, and installed safe command smoke. It does not replace visible installed VS Code terminal-pane UX validation, target Windows/Linux runtime execution, or final M11 no-regression.",
            "",
        ]
    )
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(f"Status: {status}")
    print(f"Summary: {args.output}")
    return 0 if status == "PASS_WITH_LIMITS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
