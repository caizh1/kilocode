#!/usr/bin/env python3
"""Generate a read-only M11 current-status dashboard for the migration.

The dashboard is intentionally source-side only. It summarizes existing plan
state and validation evidence, but it does not run QA, install VSIX files,
touch runtime code, or satisfy any external evidence gate by itself.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAN = ROOT / "docs/chipmate-feature-migration-plan.md"
DEFAULT_AUDIT = (
    ROOT
    / "docs/chipmate-feature-migration-validation-runs/20260709-147000-completion-audit-after-unblock-packet-receive-workflow/completion-audit.md"
)
DEFAULT_CURRENT_STATE = (
    ROOT
    / "docs/chipmate-feature-migration-validation-runs/20260709-147500-current-state-consistency-after-unblock-packet-receive-workflow/summary.md"
)
DEFAULT_SIGNOFF = (
    ROOT
    / "docs/chipmate-feature-migration-validation-runs/20260709-148000-m11-final-signoff-after-unblock-packet-receive-workflow/current-signoff-summary.md"
)
DEFAULT_READINESS = (
    ROOT
    / "docs/chipmate-feature-migration-validation-runs/20260709-161000-m11-readiness-after-latest-s3-rerun/summary.md"
)
DEFAULT_OUTPUT = ROOT / "docs/chipmate-feature-migration-m11-current-status-dashboard.md"
PACKAGE_REFRESH_OWNER_ACTION_PACKET = ROOT / "docs/chipmate-feature-migration-package-refresh-owner-action-packet.md"


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def read(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def checkbox_counts(plan_text: str) -> tuple[int, int, int]:
    done = plan_text.count("- [x]")
    open_ = plan_text.count("- [ ]")
    return done, open_, done + open_


def open_lines(plan_text: str) -> list[tuple[int, str]]:
    lines: list[tuple[int, str]] = []
    for line_no, line in enumerate(plan_text.splitlines(), 1):
        if "- [ ]" in line:
            lines.append((line_no, line.strip()[len("- [ ] ") :]))
    return lines


def first_match(text: str, pattern: str, default: str = "missing") -> str:
    match = re.search(pattern, text, re.MULTILINE)
    if not match:
        return default
    return match.group(1).strip()


def extract_backticked_value(text: str, label: str, default: str = "missing") -> str:
    return first_match(text, rf"^- {re.escape(label)}:\s+`([^`]+)`", default)


def status_line(text: str, label: str, default: str = "missing") -> str:
    return first_match(text, rf"^{re.escape(label)}:\s+`?([^`\n]+)`?", default)


def latest_matching(pattern: str) -> Path | None:
    matches = sorted((ROOT / "docs/chipmate-feature-migration-validation-runs").glob(pattern))
    if not matches:
        return None
    return matches[-1]


def classify_open_items(items: Iterable[tuple[int, str]]) -> dict[str, list[str]]:
    categories: dict[str, list[str]] = {
        "M11 review/signoff": [],
        "Installed VSIX runtime": [],
        "Internal embedded C validation": [],
        "Company Word template": [],
        "Offline Windows/Linux target": [],
        "Final packaging/acceptance": [],
        "Other open checklist items": [],
    }
    for line_no, item in items:
        lowered = item.lower()
        entry = f"`{line_no}` {item}"
        if "m11" in lowered or "review" in lowered or "最终结论" in item or "最终迁移" in item:
            categories["M11 review/signoff"].append(entry)
        elif "installed" in lowered or "安装 vsix" in lowered or "chat/runtime" in lowered:
            categories["Installed VSIX runtime"].append(entry)
        elif "内网嵌入式" in item or "embedded c" in lowered or "详细设计" in item:
            categories["Internal embedded C validation"].append(entry)
        elif ".docx" in lowered or "word 模板" in item:
            categories["Company Word template"].append(entry)
        elif "windows" in lowered or "linux" in lowered or "offline" in lowered:
            categories["Offline Windows/Linux target"].append(entry)
        elif "打包验收" in item or "m10" in lowered:
            categories["Final packaging/acceptance"].append(entry)
        else:
            categories["Other open checklist items"].append(entry)
    return categories


def bullet_list(items: list[str]) -> str:
    if not items:
        return "- None\n"
    return "".join(f"- {item}\n" for item in items)


def render_dashboard(args: argparse.Namespace) -> str:
    plan_text = read(args.plan)
    audit_text = read(args.audit)
    current_state_text = read(args.current_state)
    signoff_text = read(args.signoff)
    readiness_text = read(args.readiness)

    done, open_, total = checkbox_counts(plan_text)
    blockers = extract_backticked_value(audit_text, "Blockers")
    review_items = extract_backticked_value(audit_text, "Review items")
    completion_allowed = extract_backticked_value(audit_text, "Completion allowed")
    current_state = status_line(current_state_text, "Status")
    current_state_failed = extract_backticked_value(current_state_text, "Failed checks", "missing")
    signoff_status = extract_backticked_value(signoff_text, "Overall status")
    ready_gates = extract_backticked_value(signoff_text, "Ready gates")
    total_gates = extract_backticked_value(signoff_text, "Total gates")
    readiness_status = extract_backticked_value(
        readiness_text,
        "Overall status",
        status_line(readiness_text, "Overall status"),
    )

    document_rag_path = latest_matching("*document-rag-readiness-rerun*/document-rag-readiness-summary.md")
    document_rag_text = read(document_rag_path) if document_rag_path else ""
    document_rag_status = extract_backticked_value(
        document_rag_text,
        "Status",
        status_line(document_rag_text, "Status"),
    )
    document_rag_http = extract_backticked_value(document_rag_text, "provider diagnostic http status", "missing")
    if document_rag_http == "missing":
        document_rag_http = first_match(document_rag_text, r"HTTP status:\s+`?([^`\n]+)`?", "missing")
    if document_rag_http == "missing":
        document_rag_http = first_match(document_rag_text, r"HTTP `?([0-9]{3})`?", "missing")
    source_marker_path = latest_matching("*contract-marker-current-source-audit*/summary.md")
    source_marker_text = read(source_marker_path) if source_marker_path else ""
    source_marker_status = extract_backticked_value(source_marker_text, "Status")
    package_marker_path = latest_matching("*package-marker-audit*/summary.md")
    package_marker_text = read(package_marker_path) if package_marker_path else ""
    package_marker_status = extract_backticked_value(package_marker_text, "Status")
    target_boundary_path = latest_matching("*target-execution-boundary-check/summary.md")
    target_boundary_text = read(target_boundary_path) if target_boundary_path else ""
    target_boundary_status = extract_backticked_value(target_boundary_text, "Status")
    target_boundary_linux = extract_backticked_value(
        target_boundary_text,
        "Can satisfy offline Linux x86-64 target execution on this host directly",
    )
    target_boundary_windows = extract_backticked_value(
        target_boundary_text,
        "Can satisfy offline Windows x86-64 target execution on this host directly",
    )
    package_refresh_path = latest_matching("*package-refresh-boundary-check/summary.md")
    package_refresh_text = read(package_refresh_path) if package_refresh_path else ""
    package_refresh_status = extract_backticked_value(package_refresh_text, "Status")
    package_refresh_latest_present = extract_backticked_value(
        package_refresh_text,
        "Latest source-side evidence present in any checked package",
    )
    package_refresh_decision_path = latest_matching("*package-refresh-decision-intake/summary.md")
    package_refresh_decision_text = read(package_refresh_decision_path) if package_refresh_decision_path else ""
    package_refresh_decision_status = extract_backticked_value(
        package_refresh_decision_text,
        "Overall status",
    )
    package_refresh_decision = extract_backticked_value(package_refresh_decision_text, "Decision")
    package_refresh_accepted_by = extract_backticked_value(package_refresh_decision_text, "Accepted by")
    package_refresh_accepted_date = extract_backticked_value(package_refresh_decision_text, "Accepted date")
    owner_action_packet_exists = PACKAGE_REFRESH_OWNER_ACTION_PACKET.exists()

    categories = classify_open_items(open_lines(plan_text))

    lines: list[str] = []
    lines.append("# ChipMate Feature Migration M11 Current Status Dashboard\n")
    lines.append("Status: `NOT_READY`\n")
    lines.append(f"Generated stamp: `{args.stamp}`\n")
    lines.append("\n")
    lines.append("## Scope\n\n")
    lines.append(
        "This dashboard is a read-only source-side summary. It does not execute QA, "
        "does not install VSIX files, does not run provider calls, and does not mark "
        "external evidence gates complete.\n\n"
    )
    lines.append(
        "It also does not migrate ChipMate contract/repair/gating behavior such as "
        "`nextToolContract`, `missingDeliverable`, `validate_artifacts`, missing-diagram "
        "auto-render repair, or missing-document contract planning.\n\n"
    )

    lines.append("## Current completion snapshot\n\n")
    lines.append("| Metric | Value |\n")
    lines.append("|---|---:|\n")
    lines.append(f"| Completed checklist items | `{done}` |\n")
    lines.append(f"| Open checklist items | `{open_}` |\n")
    lines.append(f"| Total checklist items | `{total}` |\n")
    lines.append(f"| Completion audit blockers | `{blockers}` |\n")
    lines.append(f"| Completion audit review items | `{review_items}` |\n")
    lines.append(f"| Completion allowed | `{completion_allowed}` |\n")
    lines.append(f"| Current-state consistency | `{current_state}` |\n")
    lines.append(f"| Current-state failed checks | `{current_state_failed}` |\n")
    lines.append(f"| M11 final signoff | `{signoff_status}` |\n")
    lines.append(f"| M11 ready gates | `{ready_gates} / {total_gates}` |\n")
    lines.append(f"| M11 readiness intake | `{readiness_status}` |\n")
    lines.append("\n")

    lines.append("## Evidence sources\n\n")
    lines.append("| Evidence | Path | Current signal |\n")
    lines.append("|---|---|---|\n")
    lines.append(f"| Plan | `{rel(args.plan)}` | `{done}` complete / `{open_}` open |\n")
    lines.append(
        f"| Completion audit | `{rel(args.audit)}` | blockers `{blockers}`, allowed `{completion_allowed}` |\n"
    )
    lines.append(
        f"| Current-state consistency | `{rel(args.current_state)}` | `{current_state}`, failed `{current_state_failed}` |\n"
    )
    lines.append(
        f"| M11 readiness intake | `{rel(args.readiness)}` | `{readiness_status}` |\n"
    )
    lines.append(
        f"| M11 final signoff | `{rel(args.signoff)}` | `{signoff_status}`, gates `{ready_gates}/{total_gates}` |\n"
    )
    if document_rag_path:
        lines.append(
            f"| Document RAG readiness rerun | `{rel(document_rag_path)}` | `{document_rag_status}`, HTTP `{document_rag_http}` |\n"
        )
    else:
        lines.append("| Document RAG readiness rerun | `missing` | `missing` |\n")
    if source_marker_path:
        lines.append(
            f"| Current source/skill marker audit | `{rel(source_marker_path)}` | `{source_marker_status}` |\n"
        )
    else:
        lines.append("| Current source/skill marker audit | `missing` | `missing` |\n")
    if package_marker_path:
        lines.append(
            f"| Package runtime-surface marker audit | `{rel(package_marker_path)}` | `{package_marker_status}` |\n"
        )
    else:
        lines.append("| Package runtime-surface marker audit | `missing` | `missing` |\n")
    if target_boundary_path:
        lines.append(
            f"| Target execution boundary check | `{rel(target_boundary_path)}` | `{target_boundary_status}`, linux direct `{target_boundary_linux}`, windows direct `{target_boundary_windows}` |\n"
        )
    else:
        lines.append("| Target execution boundary check | `missing` | `missing` |\n")
    if package_refresh_path:
        lines.append(
            f"| Package refresh boundary check | `{rel(package_refresh_path)}` | `{package_refresh_status}`, latest source evidence present `{package_refresh_latest_present}` |\n"
        )
    else:
        lines.append("| Package refresh boundary check | `missing` | `missing` |\n")
    if package_refresh_decision_path:
        lines.append(
            f"| Package refresh decision intake | `{rel(package_refresh_decision_path)}` | `{package_refresh_decision_status}`, decision `{package_refresh_decision}`, accepted by `{package_refresh_accepted_by}`, accepted date `{package_refresh_accepted_date}` |\n"
        )
    else:
        lines.append("| Package refresh decision intake | `missing` | `missing` |\n")
    lines.append(
        f"| Package refresh owner action packet | `{rel(PACKAGE_REFRESH_OWNER_ACTION_PACKET)}` | `{'present' if owner_action_packet_exists else 'missing'}` |\n"
    )
    lines.append("\n")

    lines.append("## Open checklist groups\n\n")
    for name, items in categories.items():
        lines.append(f"### {name}\n\n")
        lines.append(bullet_list(items))
        lines.append("\n")

    lines.append("## No-regression boundary for ChipMate native capabilities\n\n")
    lines.append("| Capability | Dashboard effect | Current M11 interpretation |\n")
    lines.append("|---|---|---|\n")
    lines.append("| Native ChipMate QA | No runtime or prompt-path change | Still requires installed S1-S16 runtime evidence |\n")
    lines.append("| Code understanding | No runtime or tool-routing change | Final no-regression review remains open |\n")
    lines.append("| Document RAG | No provider or retrieval-path change | Readiness rerun is still not enough for final pass if provider is unavailable |\n")
    lines.append("| Autocomplete | No qwen autocomplete source change | S16 needs explicit product/user decision and read-only smoke evidence |\n")
    lines.append("| Tool registry | No tool registration change | Final review still must confirm no registry breakage |\n")
    lines.append("| VS Code activation/package | No activation/package change | Installed VSIX smoke remains pending |\n")
    lines.append("\n")

    lines.append("## Current contract-marker boundary refresh\n\n")
    lines.append("| Boundary check | Status | Interpretation |\n")
    lines.append("|---|---|---|\n")
    lines.append(
        f"| Current source/skill marker audit | `{source_marker_status}` | Product source, VS Code source/webview, package manifest, and local skill surfaces should remain free of old ChipMate contract/repair/gating markers. |\n"
    )
    lines.append(
        f"| Package runtime-surface marker audit | `{package_marker_status}` | VSIX runtime surfaces, offline delivery metadata, and target-kit boundary should remain free of old ChipMate contract/repair/gating markers. |\n"
    )
    lines.append("\n")

    lines.append("## Target execution boundary\n\n")
    lines.append("| Boundary check | Status | Current interpretation |\n")
    lines.append("|---|---|---|\n")
    lines.append(
        f"| Current source workstation target boundary | `{target_boundary_status}` | This host can satisfy Linux x86-64 target directly: `{target_boundary_linux}`; Windows x86-64 target directly: `{target_boundary_windows}`. |\n"
    )
    lines.append(
        "| Package-only runner | `not sufficient` | Package/integrity evidence does not replace offline target execution evidence, installed VSIX S1-S16 runtime smoke, or final M11 review. |\n"
    )
    lines.append("\n")

    lines.append("## Package refresh boundary\n\n")
    lines.append("| Boundary check | Status | Current interpretation |\n")
    lines.append("|---|---|---|\n")
    lines.append(
        f"| Offline package refresh boundary | `{package_refresh_status}` | Latest source-side M11/readiness/target-boundary evidence present in checked packages: `{package_refresh_latest_present}`. |\n"
    )
    lines.append(
        "| Final offline delivery | `requires decision` | Regenerate offline packages before claiming they include the current M11 evidence chain, or explicitly state these source-side evidence updates remain outside the packaged target kit. |\n"
    )
    lines.append(
        f"| Package refresh decision intake | `{package_refresh_decision_status}` | Current decision: `{package_refresh_decision}`; accepted by: `{package_refresh_accepted_by}`; accepted date: `{package_refresh_accepted_date}`. Accepted decisions are `REGENERATE_OFFLINE_PACKAGES` or `EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT` with an accepted owner and date. |\n"
    )
    lines.append(
        f"| Owner action packet | `{'present' if owner_action_packet_exists else 'missing'}` | `{rel(PACKAGE_REFRESH_OWNER_ACTION_PACKET)}` gives the final-delivery owner the copyable decision/intake/signoff command path. |\n"
    )
    lines.append("\n")

    lines.append("## Next evidence needed before M11 can pass\n\n")
    lines.append("- Return installed VSIX S1-S16 runtime smoke evidence from the target VS Code environment.\n")
    lines.append("- Return at least one internal embedded-C source-backed detail-design end-to-end run.\n")
    lines.append("- Return a real company `.docx` template validation result.\n")
    lines.append("- Return Windows x86-64 and Linux x86-64 offline target execution evidence.\n")
    lines.append("- Resolve or rerun Document RAG readiness after the provider/upstream is available.\n")
    lines.append("- Record the S16 autocomplete decision and run the accepted read-only smoke path.\n")
    lines.append("- Then run M11 final review and explicitly decide PASS or PASS_WITH_KNOWN_LIMITS.\n")
    lines.append("\n")

    return "".join(lines)


def write_self_check(path: Path, dashboard_text: str) -> None:
    required = [
        "Status: `NOT_READY`",
        "`nextToolContract`",
        "`missingDeliverable`",
        "`validate_artifacts`",
        "Native ChipMate QA",
        "Document RAG",
        "Autocomplete",
        "VS Code activation/package",
        "Current contract-marker boundary refresh",
        "Current source/skill marker audit",
        "Package runtime-surface marker audit",
        "20260709-161000-m11-readiness-after-latest-s3-rerun",
        "20260709-160500-document-rag-readiness-rerun-after-marker-guards",
        "20260709-163000-target-execution-boundary-check",
        "Target execution boundary",
        "Package-only runner",
        "20260709-164000-package-refresh-boundary-check",
        "20260709-164500-package-refresh-decision-intake",
        "Package refresh boundary",
        "Package refresh decision intake",
        "Package refresh owner action packet",
        "chipmate-feature-migration-package-refresh-owner-action-packet.md",
        "Owner action packet",
        "`REFRESH_REQUIRED_FOR_FINAL_DELIVERY`",
        "`NEEDS_PACKAGE_REFRESH_DECISION`",
        "accepted by `MISSING`",
        "accepted date `MISSING`",
        "REGENERATE_OFFLINE_PACKAGES",
        "EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT",
        "latest source evidence present `no`",
        "linux direct `no`",
        "windows direct `no`",
        "`NOT_READY_FOR_M11_REVIEW`",
        "`ERROR_NEEDS_REVIEW`",
        "HTTP `503`",
        "Next evidence needed before M11 can pass",
    ]
    missing = [token for token in required if token not in dashboard_text]
    path.parent.mkdir(parents=True, exist_ok=True)
    status = "PASS" if not missing else "FAIL"
    lines = [
        "# M11 Current Status Dashboard Self-Check\n\n",
        f"Status: `{status}`\n",
        f"Checked tokens: `{len(required)}`\n",
        f"Missing tokens: `{len(missing)}`\n",
        "\n",
        "## Missing tokens\n",
    ]
    if missing:
        lines.extend(f"- `{token}`\n" for token in missing)
    else:
        lines.append("- None\n")
    path.write_text("".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--audit", type=Path, default=DEFAULT_AUDIT)
    parser.add_argument("--current-state", type=Path, default=DEFAULT_CURRENT_STATE)
    parser.add_argument("--signoff", type=Path, default=DEFAULT_SIGNOFF)
    parser.add_argument("--readiness", type=Path, default=DEFAULT_READINESS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--stamp", default="20260709-148500")
    parser.add_argument("--self-check-output", type=Path)
    args = parser.parse_args()

    dashboard = render_dashboard(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(dashboard, encoding="utf-8")
    if args.self_check_output:
        write_self_check(args.self_check_output, dashboard)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
