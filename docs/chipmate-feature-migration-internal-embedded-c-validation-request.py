#!/usr/bin/env python3
"""Generate an internal embedded-C source-backed design validation request.

This helper prepares a handoff document for the project owner who can run the
installed Kilo/ChipMate VSIX against a representative internal embedded-C
workspace.  It does not run the skill, does not inspect private source, and
does not decide M11 acceptance.
"""

from __future__ import annotations

import argparse
from pathlib import Path


DEFAULT_PROMPT = (
    "为该嵌入式 C 模块生成源码驱动详细设计文档。请基于当前源码证据输出："
    "源码证据、控制流证据、业务抽象、业务图、代码图、状态机图、详细设计 Markdown、"
    "Word 文档和质量/差异说明。不要使用 ChipMate 旧 document contract / repair / gating 流水线。"
)


def write_request(output: Path, project_label: str, workspace_hint: str, module_hint: str) -> None:
    lines = [
        f"# Internal Embedded-C Source-Backed Detail Design Validation Request: {project_label}",
        "",
        "- Status: `REQUEST_PENDING_INTERNAL_PROJECT_EXECUTION`",
        "- Scope: S13 source-backed detail-design validation on a representative internal embedded-C module",
        "- Runner: installed Kilo/ChipMate VSIX in the target VS Code profile",
        "",
        "## Required inputs from project owner",
        "",
        f"- Workspace path: `{workspace_hint}`",
        f"- Module/file/function focus: `{module_hint}`",
        "- Provider/auth profile that can run installed chat/tool flow",
        "- Permission to create `.kilo/artifacts/...` outputs in the workspace",
        "",
        "## Prompt to run",
        "",
        "```text",
        DEFAULT_PROMPT,
        "```",
        "",
        "## Expected returned evidence",
        "",
        "- Chat transcript or runtime log showing the source-backed-detail-design skill/tool path was selected",
        "- Evidence files showing source references and control-flow/source evidence",
        "- Generated detailed-design Markdown",
        "- Generated Mermaid/diagram sources and rendered images when configured",
        "- Generated Word `.docx` artifact when Word generation is requested",
        "- Artifact manifest under `.kilo/artifacts/.../artifact.json`",
        "- Quality report or limitation notes, especially any missing evidence, unsupported renderer, or provider issue",
        "- Confirmation that ordinary Kilo QA was not replaced or routed through Word/Mermaid/artifact tools",
        "",
        "## Acceptance criteria",
        "",
        "| Check | Required status | Notes |",
        "|---|---:|---|",
        "| Installed VSIX chat/tool flow ran | PASS | A tool-layer-only script is not enough for final S13 acceptance. |",
        "| Source-backed detail-design skill selected | PASS | Skill-only migration is expected; ChipMate runtime flow/Word contract is not expected. |",
        "| Source evidence references current embedded-C files | PASS | Include paths/functions/line evidence where available. |",
        "| Markdown detailed design generated | PASS | Must be present as an artifact/file, not only described in chat. |",
        "| Diagrams generated or renderer limitation recorded | PASS_WITH_LIMITS/PASS | Missing renderer may be a warning if diagram source exists. |",
        "| Word artifact generated or scoped limitation recorded | PASS_WITH_LIMITS/PASS | Word generation is generic Word capability only. |",
        "| Old document contract/repair/gating not triggered | PASS | No `nextToolContract`, `missingDeliverable`, `validate_artifacts`, missing-diagram auto-repair, or missing document contract planning. |",
        "| Native Kilo QA preserved | PASS_WITH_REVIEW | Ordinary QA prompts must still use native Kilo code understanding, not the document-generation flow. |",
        "",
        "## Explicit non-goals",
        "",
        "- Do not migrate or invoke ChipMate runtime flow.",
        "- Do not require a Word/document runtime contract.",
        "- Do not run required-artifact validator or recipe repair loop.",
        "- Do not auto-render missing diagrams before the user asks.",
        "- Do not treat this request document as acceptance evidence by itself.",
        "",
        "## Return package",
        "",
        "Return the artifact directory, logs/transcript, and any generated Word/diagram files. If evidence is packaged as tar/zip, include checksums and a manifest of returned files.",
        "",
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-label", default="internal-embedded-c-module")
    parser.add_argument("--workspace-hint", default="/path/to/internal/embedded-c/workspace")
    parser.add_argument("--module-hint", default="module/file/function under validation")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    output = args.output_dir / "internal-embedded-c-validation-request.md"
    write_request(output, args.project_label, args.workspace_hint, args.module_hint)
    print(f"WROTE: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
