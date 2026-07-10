#!/usr/bin/env python3
"""Conservative M11 readiness intake for ChipMate feature migration.

This helper does not execute tests or mark the migration complete.  It reads
current or returned evidence summaries and reports whether the evidence set is
ready to enter final M11 no-regression review.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path


DEFAULT_S3 = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-160500-document-rag-readiness-rerun-after-marker-guards/"
    "document-rag-readiness-summary.md"
)
DEFAULT_S16_GUARD = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-004500-s16-source-guard/summary.md"
)


@dataclass
class Gate:
    name: str
    status: str
    ready: bool
    evidence: str
    note: str


def read_text(path: Path | None) -> str:
    if path is None or not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def status_line(text: str, label: str = "Status") -> str | None:
    match = re.search(rf"(?im)^\s*[-*]?\s*{re.escape(label)}\s*:\s*`?([A-Z0-9_]+)`?\s*$", text)
    return match.group(1).upper() if match else None


def status_value(text: str, *labels: str) -> str | None:
    for label in labels:
        value = status_line(text, label)
        if value:
            return value
    for label in labels:
        match = re.search(rf"(?im)^\|\s*{re.escape(label)}\s*\|\s*`?([A-Z0-9_]+)`?\s*\|", text)
        if match:
            return match.group(1).upper()
    return None


def contains_field(text: str, field: str, value: str) -> bool:
    return bool(re.search(rf"(?im)^\s*[-*]?\s*{re.escape(field)}\s*:\s*`?{re.escape(value)}`?\s*$", text))


def gate_from_required_statuses(name: str, path: Path | None, accepted_statuses: set[str], note: str) -> Gate:
    if path is None:
        return Gate(name, "MISSING", False, "not provided", note)
    text = read_text(path)
    if not text:
        return Gate(name, "MISSING", False, str(path), note)
    status = status_value(text, "Status", "Final status", "Overall status") or "UNKNOWN"
    return Gate(name, status, status in accepted_statuses, str(path), note)


def gate_from_required_pass(name: str, path: Path | None, note: str) -> Gate:
    return gate_from_required_statuses(name, path, {"PASS"}, note)


def shaped_gate(
    name: str,
    path: Path | None,
    accepted_statuses: set[str],
    required_needles: list[str],
    note: str,
    *,
    status_labels: tuple[str, ...] = ("Status", "Final status", "Overall status"),
    bad_needles: list[str] | None = None,
    any_required: list[list[str]] | None = None,
) -> Gate:
    if path is None:
        return Gate(name, "MISSING", False, "not provided", note)
    text = read_text(path)
    if not text:
        return Gate(name, "MISSING", False, str(path), note)
    status = status_value(text, *status_labels) or "UNKNOWN"
    bad_needles = bad_needles or [
        "This self-check uses synthetic evidence only",
        "synthetic evidence",
        "generic PASS",
    ]
    missing = [needle for needle in required_needles if needle not in text]
    missing_any = [
        group
        for group in (any_required or [])
        if not any(needle in text for needle in group)
    ]
    bad = [needle for needle in bad_needles if needle in text]
    ready = status in accepted_statuses and not missing and not missing_any and not bad
    if status in accepted_statuses and not ready:
        status = f"{status}_NEEDS_REVIEW"
    return Gate(name, status, ready, str(path), note)


def s3_gate(path: Path) -> Gate:
    text = read_text(path)
    if not text:
        return Gate("S3 Document RAG readiness", "MISSING", False, str(path), "S3 readiness summary missing")
    status = status_value(text, "Status", "Overall status") or "UNKNOWN"
    document_search = contains_field(text, "document_search used", "yes")
    provider_ok = contains_field(text, "provider/readiness failure detected", "no")
    ready = status == "PASS" and document_search and provider_ok
    note = "requires PASS, document_search used yes, and provider/readiness failure no"
    return Gate("S3 Document RAG readiness", status, ready, str(path), note)


def s16_gate(path: Path, decision: Path | None, accept_decision: bool) -> Gate:
    text = read_text(path)
    if not text:
        return Gate("S16 autocomplete source decision", "MISSING", False, str(path), "S16 source guard summary missing")
    status = status_value(text, "Status", "Overall status") or "UNKNOWN"
    decision_text = read_text(decision)
    decision_status = status_value(decision_text, "Status", "Overall status") or "MISSING"
    decision_ready = contains_field(decision_text, "Ready for read-only S16 smoke", "yes")
    decision_shape = all(
        needle in decision_text
        for needle in [
            "# S16 Autocomplete Decision Intake",
            "Source guard status: `PASS_WITH_LIMITS`",
            "Decision record present: `yes`",
            "Parsed decision:",
            "## Boundary",
            "does not modify protected files",
        ]
    )
    decision_note = (
        f"; decision intake {decision} status {decision_status}"
        if decision and decision.is_file()
        else "; no decision intake supplied"
    )
    accept_note = "; explicit S16 decision accepted" if accept_decision else "; explicit S16 decision not accepted"
    ready = (
        status == "PASS_WITH_LIMITS"
        and decision_status == "READY_FOR_READONLY_S16_SMOKE"
        and decision_ready
        and decision_shape
        and accept_decision
    )
    if status == "PASS_WITH_LIMITS" and decision is not None and decision.is_file() and accept_decision and not ready:
        status = "PASS_WITH_LIMITS_NEEDS_DECISION_REVIEW"
    return Gate(
        "S16 autocomplete source decision",
        status,
        ready,
        str(path),
        "requires source guard PASS_WITH_LIMITS plus typed S16 decision intake READY_FOR_READONLY_S16_SMOKE and explicit accepted user decision"
        + decision_note
        + accept_note,
    )


def installed_runtime_gate(path: Path | None) -> Gate:
    return shaped_gate(
        "Installed runtime S1-S16",
        path,
        {"PASS"},
        [
            "# Runtime Smoke Intake Verify",
            "Requested ID",
            "Final status:",
            "## Checks",
            "S1:",
            "S16:",
            "S16 source guard",
        ],
        "requires runtime intake final PASS for S1-S16 from chipmate-feature-migration-runtime-smoke-intake-verify.py; generic PASS summaries are not accepted",
        status_labels=("Final status", "Status", "Overall status"),
    )


def target_execution_gate(name: str, path: Path | None, target_markers: list[str]) -> Gate:
    return shaped_gate(
        name,
        path,
        {"PASS"},
        [
            "# ChipMate Offline Target Evidence Intake Verify",
            "Target:",
            "Final status:",
            "## Package evidence checks",
            "## Runtime evidence checks",
            "## Target evidence return template checks",
            "runtime-intake-summary.md",
            "Overall target status",
        ],
        "requires returned target intake final PASS from chipmate-feature-migration-target-evidence-intake-verify.py, including package evidence, runtime intake, and filled return-template evidence",
        status_labels=("Final status", "Status", "Overall status"),
        any_required=[target_markers],
    )


def internal_embedded_c_gate(path: Path | None) -> Gate:
    return shaped_gate(
        "Internal embedded-C source-backed detail design",
        path,
        {"PASS"},
        [
            "# Internal Embedded-C Source-Backed Detail Design Intake Summary",
            "Status:",
            "Failed checks: `0`",
            "evidence file found:",
            "context filled: Installed VSIX profile",
            "context filled: Source workspace",
            "context filled: Embedded C module",
            "status PASS: Kilo native QA preserved",
            "status PASS: Source-backed detail-design skill selected",
            "status PASS: Markdown detail design generated",
            "status PASS: Word detail design generated",
            "status PASS: At least one diagram generated",
            "status PASS: Quality report generated",
            "status PASS: Old ChipMate contract markers absent",
            "status PASS: No missing-diagram auto-repair triggered",
            "status PASS: No document-contract planning triggered when skill disabled",
            "generated Markdown artifacts:",
            "generated Word artifacts:",
            "generated diagram artifacts:",
            "quality report artifacts:",
        ],
        "requires returned installed source-backed detail-design evidence accepted by chipmate-feature-migration-internal-embedded-c-intake.py, including Markdown, diagram, Word, quality report, and old-contract absence checks; generic PASS summaries are not accepted",
    )


def company_template_gate(path: Path | None, accept_pass_with_limits: bool) -> Gate:
    accepted_statuses = {"PASS", "PASS_WITH_LIMITS"} if accept_pass_with_limits else {"PASS"}
    note = "requires representative company template validation PASS"
    if accept_pass_with_limits:
        note += " or explicitly accepted PASS_WITH_LIMITS"
    else:
        note += "; PASS_WITH_LIMITS requires --accept-company-template-pass-with-limits"
    return shaped_gate(
        "Real company .docx template validation",
        path,
        accepted_statuses,
        [
            "# Company DOCX Template Validation",
            "Template:",
            "Template size:",
            "Style count:",
            "## Failures",
            "## Warnings",
            "## Boundary",
            "does not generate Word output",
            "does not fill placeholders",
        ],
        note + "; evidence must come from the company .docx template validator shape, not a generic PASS summary",
    )


def agent_terminal_visible_ux_gate(path: Path | None) -> Gate:
    note = (
        "requires returned installed VS Code visible UX intake PASS for command palette, "
        "default-off prompt, terminal pane, native terminal preservation, dangerous confirmation, "
        "audit/log evidence, and intake-summary shape; self-check or generic PASS summaries are not accepted"
    )
    if path is None:
        return Gate("Visible Agent Terminal UX", "MISSING", False, "not provided", note)
    text = read_text(path)
    if not text:
        return Gate("Visible Agent Terminal UX", "MISSING", False, str(path), note)
    status = status_value(text, "Status", "Overall status") or "UNKNOWN"
    required_needles = [
        "# Agent Terminal Visible UX Intake Summary",
        "Failed checks: `0`",
        "evidence file found:",
        "context filled: Installed VSIX profile",
        "status PASS: Agent Terminal command visible",
        "status PASS: Terminal pane opens after enable",
        "status PASS: Native Kilo terminal unaffected",
        "status PASS: Dangerous command confirmation visible",
        "attached evidence assets:",
    ]
    bad_needles = [
        "This self-check uses synthetic evidence only",
        "M11 Visible Agent Terminal UX Gate Self-Check",
        "synthetic evidence",
    ]
    has_required_shape = all(needle in text for needle in required_needles)
    has_bad_shape = any(needle in text for needle in bad_needles)
    ready = status == "PASS" and has_required_shape and not has_bad_shape
    if status == "PASS" and not ready:
        status = "PASS_NEEDS_REVIEW"
    return Gate("Visible Agent Terminal UX", status, ready, str(path), note)


def write_summary(output: Path, gates: list[Gate]) -> None:
    ready = all(gate.ready for gate in gates)
    lines = [
        "# M11 Readiness Intake",
        "",
        f"- Overall status: `{'READY_FOR_M11_REVIEW' if ready else 'NOT_READY_FOR_M11_REVIEW'}`",
        f"- Ready gates: `{sum(1 for gate in gates if gate.ready)}`",
        f"- Total gates: `{len(gates)}`",
        "",
        "| Gate | Ready | Status | Evidence | Note |",
        "|---|---:|---:|---|---|",
    ]
    for gate in gates:
        lines.append(
            f"| {gate.name} | `{'yes' if gate.ready else 'no'}` | `{gate.status}` | `{gate.evidence}` | {gate.note} |"
        )
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "This helper is a readiness intake only. It does not execute tests, does not install VSIX files, does not replace manual M11 no-regression review, and does not redefine migration completion.",
            "",
        ]
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--s3-readiness", type=Path, default=DEFAULT_S3)
    parser.add_argument("--s16-source-guard", type=Path, default=DEFAULT_S16_GUARD)
    parser.add_argument("--s16-decision-brief", type=Path)
    parser.add_argument("--accept-s16-decision", action="store_true")
    parser.add_argument("--installed-runtime-intake", type=Path)
    parser.add_argument("--windows-target-intake", type=Path)
    parser.add_argument("--linux-target-intake", type=Path)
    parser.add_argument("--internal-embedded-c-summary", type=Path)
    parser.add_argument("--company-template-summary", type=Path)
    parser.add_argument("--accept-company-template-pass-with-limits", action="store_true")
    parser.add_argument("--agent-terminal-visible-ux-intake", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    gates = [
        s3_gate(args.s3_readiness),
        s16_gate(args.s16_source_guard, args.s16_decision_brief, args.accept_s16_decision),
        installed_runtime_gate(args.installed_runtime_intake),
        target_execution_gate("Offline Windows x86-64 target execution", args.windows_target_intake, ["win32-x64", "windows", "Windows"]),
        target_execution_gate("Offline Linux x86-64 target execution", args.linux_target_intake, ["linux-x64", "linux", "Linux"]),
        internal_embedded_c_gate(args.internal_embedded_c_summary),
        company_template_gate(args.company_template_summary, args.accept_company_template_pass_with_limits),
        agent_terminal_visible_ux_gate(args.agent_terminal_visible_ux_intake),
    ]
    write_summary(args.output, gates)
    ready = all(gate.ready for gate in gates)
    print(f"Status: {'READY_FOR_M11_REVIEW' if ready else 'NOT_READY_FOR_M11_REVIEW'}")
    print(f"Summary: {args.output}")
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
