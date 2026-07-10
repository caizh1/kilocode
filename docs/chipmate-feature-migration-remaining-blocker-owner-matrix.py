#!/usr/bin/env python3
"""Generate the remaining blocker owner/intake matrix.

This helper is read-only. It does not execute validation, run tests, install
VSIX files, or change acceptance status. It creates a handoff matrix that
separates external inputs, user decisions, target execution, provider readiness,
and final M11 review gates.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path


DEFAULT_OUTPUT = Path(
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-091000-remaining-blocker-owner-matrix/"
    "remaining-blocker-owner-matrix.md"
)


@dataclass(frozen=True)
class Blocker:
    blocker_id: str
    owner_type: str
    status: str
    current_evidence: str
    required_input: str
    acceptance_gate: str


BLOCKERS = [
    Blocker(
        "S3 Document RAG",
        "Provider/operator",
        "ERROR_NEEDS_REVIEW",
        "docs/chipmate-feature-migration-validation-runs/20260709-082000-document-rag-readiness-rerun/document-rag-readiness-summary.md",
        "Restore or replace the openai-compatible embedding upstream so readiness no longer returns HTTP 503.",
        "Rerun Document RAG readiness until document_search used=yes, provider/readiness failure=no, and guardrails pass.",
    ),
    Blocker(
        "S16 autocomplete",
        "User/product decision",
        "NEEDS_USER_DECISION",
        "docs/chipmate-feature-migration-validation-runs/20260709-085000-s16-decision-intake/current-summary.md",
        "Record Decision: keep, revert, or split-review for the protected qwen autocomplete/package source changes.",
        "After decision, rerun read-only S16 source guard/smoke; source guard must reach PASS_WITH_LIMITS before S16 acceptance.",
    ),
    Blocker(
        "Installed VSIX S1-S16",
        "Runtime operator",
        "PENDING",
        "docs/chipmate-feature-migration-validation-runs/20260709-063000-installed-runtime-smoke-request/installed-runtime-smoke-s1-s16-request.md",
        "Run installed VSIX chat/runtime S1-S16 in the agreed VS Code profile/workspace with usable providers.",
        "Runtime intake summary must PASS for required S1-S16 and old ChipMate contract/repair markers must remain absent.",
    ),
    Blocker(
        "Offline Windows x86-64 target execution",
        "Windows target owner",
        "PENDING",
        "docs/chipmate-feature-migration-validation-runs/20260709-060000-target-execution-request-generator/win32-x64-target-execution-request.md",
        "Run the offline delivery-set verifier and target runner on an actual offline Windows x86-64 target.",
        "Returned target evidence pack verifies, target intake final status PASS, and runtime intake PASS where required.",
    ),
    Blocker(
        "Offline Linux x86-64 target execution",
        "Linux target owner",
        "PENDING",
        "docs/chipmate-feature-migration-validation-runs/20260709-060000-target-execution-request-generator/linux-x64-target-execution-request.md",
        "Run the offline delivery-set verifier and target runner on an actual offline Linux x86-64 target.",
        "Returned target evidence pack verifies, target intake final status PASS, and runtime intake PASS where required.",
    ),
    Blocker(
        "Internal embedded-C source-backed detail design",
        "Internal project owner",
        "PENDING",
        "docs/chipmate-feature-migration-validation-runs/20260709-061500-internal-embedded-c-validation-request/internal-embedded-c-validation-request.md",
        "Run source-backed-detail-design skill through installed VSIX/chat on a representative internal embedded C module.",
        "Returned evidence includes source evidence, Markdown/detail design, diagrams, Word output, quality report, and no old contract/repair flow.",
    ),
    Blocker(
        "Real company .docx template",
        "Document/template owner",
        "PENDING",
        "docs/chipmate-feature-migration-company-docx-template-validate.py",
        "Provide a representative company .docx/.dotx and run the template validation plus S8 Word template flow.",
        "Company template validation PASS or explicitly accepted PASS_WITH_LIMITS with documented style inheritance limits.",
    ),
    Blocker(
        "Visible Agent Terminal UX",
        "VS Code UX/manual operator",
        "PENDING",
        "docs/chipmate-feature-migration-validation-runs/20260709-080000-agent-terminal-acceptance-rollup/summary.md",
        "Run visible installed VS Code UX checks for command-palette prompt, terminal pane opening, and dangerous-command confirmation.",
        "Manual/automated UX evidence accepted in M11; local service/runtime rollup is already PASS_WITH_LIMITS but not enough for visible UX.",
    ),
    Blocker(
        "M11 final no-regression review",
        "Release reviewer",
        "NOT_READY_FOR_FINAL_SIGNOFF",
        "docs/chipmate-feature-migration-validation-runs/20260709-072000-m11-final-signoff-intake/current-signoff-summary.md",
        "Complete the above gates, then run M11 review against QA, code understanding, Document RAG, autocomplete, terminal, tool registry, activation, and packaging.",
        "Final signoff intake must be READY_FOR_FINAL_SIGNOFF and final review decision must be PASS or explicitly accepted PASS_WITH_KNOWN_LIMITS.",
    ),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    lines = [
        "# Remaining Blocker Owner Matrix",
        "",
        "- Status: `ACTIVE_BLOCKERS_REMAIN`",
        f"- Blocker count: `{len(BLOCKERS)}`",
        "",
        "| Blocker | Owner type | Status | Current evidence | Required input | Acceptance gate |",
        "|---|---|---:|---|---|---|",
    ]
    for blocker in BLOCKERS:
        lines.append(
            "| "
            + " | ".join(
                [
                    blocker.blocker_id,
                    blocker.owner_type,
                    f"`{blocker.status}`",
                    f"`{blocker.current_evidence}`",
                    blocker.required_input,
                    blocker.acceptance_gate,
                ]
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "This matrix is a handoff aid only. It does not run validation, does not install or package VSIX files, does not modify protected autocomplete files, and does not mark any blocker complete.",
            "",
        ]
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(f"Status: ACTIVE_BLOCKERS_REMAIN")
    print(f"Summary: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
