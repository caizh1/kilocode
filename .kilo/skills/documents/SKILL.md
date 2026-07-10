---
name: documents
description: Create, inspect, edit, render, merge, diff, and manage Word `.docx` document artifacts with Kilo native tools, Mermaid PNG figures, and external render diagnostics.
allowed-tools:
  - document_search
  - read
  - grep
  - glob
  - declare_artifact
  - list_artifacts
  - open_artifact
  - export_artifact_diagnostics
  - create_word_document
  - inspect_word_document
  - apply_word_document_edits
  - apply_word_template_styles
  - materialize_word_fields
  - merge_word_documents
  - diff_word_documents
  - normalize_word_table_spec
  - render_word_document
  - validate_mermaid_diagram
  - render_mermaid_diagram
  - save_mermaid_artifact
  - insert_mermaid_into_word
metadata:
  keywords:
    - word
    - docx
    - .docx
    - Word 文档
    - 生成文档
    - 创建文档
    - 编辑文档
    - 修改文档
    - 渲染文档
    - 文档对比
    - 文档合并
    - Mermaid
    - PNG 图
    - artifact
---

# Kilo Documents Skill

Use this skill when the user explicitly asks to create, inspect, edit, render, merge, diff, or package a Word `.docx` document, or when they ask to produce Mermaid PNG figures for a document artifact.

This is a Kilo-native skill wrapper around sidecar document tools. It is not a QA pipeline, not ChipMate question routing, and not a replacement for Kilo native `codebase_analysis`, `semantic_search`, or `document_search`.

This skill intentionally carries only generic Word/Mermaid/artifact guidance. Do not import ChipMate Word runtime contracts, required-artifact validators, document-depth contracts, recipe-specific repair loops, or planner gates into Kilo QA.

## Routing Boundary

- For ordinary code QA, call-chain analysis, macro lookup, bug explanation, or architecture questions, use Kilo native QA tools directly and do not trigger document artifact creation.
- For existing document QA where the user only wants to ask about an already indexed document, use Kilo native `document_search`.
- Use this skill only when the user wants a generated or edited deliverable such as `.docx`, `.pdf`, page PNGs, Mermaid PNGs, merged documents, diff summaries, or artifact diagnostics.
- For source-backed detailed design deliverables, prefer the `source-backed-detail-design` skill for evidence planning and section scope; use this documents skill only for final Word mechanics when needed.

## Artifact Guidance

- Generated files must be registered under `.kilo/artifacts` through the artifact tools or returned document tool manifests.
- Tool results should return paths, concise summaries, warnings, diagnostics, and quality status. Do not paste large binary content, full OOXML, or full document text into the chat context.
- Keep source files and generated artifacts separate. Do not overwrite a user-provided `.docx` unless the user explicitly requests that exact path.
- When a render, Mermaid, or edit step fails, preserve the successful upstream artifact and report a warning instead of treating the whole QA session as failed.

## New Word Document Workflow

Before calling `create_word_document`, decide:

- document title, audience, language, and document type;
- outline and heading levels;
- sections, paragraphs, tables, callouts, figures, and assumptions;
- source/evidence list when the document is source-backed;
- whether external render QA is required.

Use object-shaped JSON tool arguments. Do not pass `JSON.stringify(...)`, quoted JSON, Markdown, or prose where the tool expects a `spec` object.

Recommended sequence:

1. Gather only the evidence needed for a useful document.
2. Build the smallest complete `WordDocSpec` with metadata, sources, sections, and quality notes.
3. Call `create_word_document`.
4. If the user requested visual QA or the workflow requires it, call `render_word_document`.
5. Return the `.docx` artifact path plus important warnings and render status.

## Existing Word Edit Workflow

For edits to an existing `.docx`:

1. Call `inspect_word_document` first.
2. Build a small edit plan using only locators returned by inspection.
3. Prefer 1-3 operations per edit call; split larger changes into inspect/apply rounds.
4. Keep `backup: true` for risky edits.
5. Keep destructive edits dry-run first unless the user explicitly asks to apply them.
6. Prefer a new version output under the artifact directory instead of mutating the source document.
7. Render after edit only when the user requested it or when visual QA is part of the workflow.

Use `apply_word_document_edits` for controlled operations such as section insert/delete, paragraph replacement, table updates, image replacement, content-control filling, comments, tracked changes, field materialization prep, and last-resort OOXML patching. Use low-level OOXML patching only when the user request cannot be expressed by a safer structured edit operation.

## Template, Field, Table, Merge, and Diff Workflow

- Use `apply_word_template_styles` only when the user explicitly asks to apply a template, DOTX, template DOCX, or style pack. Explain that pagination and wrapping may change.
- Use `materialize_word_fields` when cached field values such as captions or references need deterministic output before rendering.
- Use `normalize_word_table_spec` before document creation or replacement when a table is wide, prose-heavy, or likely to overflow.
- Use `merge_word_documents` when the user asks to combine documents. Treat style, numbering, relationship, and image warnings as important output.
- Use `diff_word_documents` when the user asks to compare versions. Return a bounded summary and artifact paths, not full extracted text.

## Mermaid Figure Workflow

The model owns diagram semantics. Mermaid tools only validate, render, save, and insert diagrams.

Recommended sequence:

1. Decide the diagram type and content from user intent and evidence.
2. Call `validate_mermaid_diagram`.
3. Call `render_mermaid_diagram` when PNG output is required.
4. Call `save_mermaid_artifact` to persist `.mmd`, `.png`, and diagnostics.
5. Call `insert_mermaid_into_word` only after a valid PNG exists and the target Word path is known.

Do not use Mermaid tools to infer business semantics, choose main flows, or classify exception paths. Those decisions belong to the model or the active source-backed design skill.

## Render and Quality Boundary

- `render_word_document` uses an external renderer endpoint when configured. Do not assume local LibreOffice, Chromium, or Poppler are bundled with the VSIX.
- If the renderer endpoint is missing or unavailable, continue delivering the `.docx` and disclose that visual QA was skipped.
- Important warnings include blank pages, table overflow risk, near-edge content, image alt-text gaps, skipped heading levels, broken fields, unsupported drawings, and stale render diagnostics.
- Do not claim visual layout passed unless render artifacts or diagnostics actually support that claim.

## Final Response Discipline

When delivering a document task, report:

- primary artifact path;
- secondary paths such as PDF, page PNGs, Mermaid PNGs, diff JSON, or diagnostics;
- warnings and known limitations;
- whether render QA ran, skipped, or failed;
- any owner-review assumptions.

Keep the response short unless the user asks for a detailed report.
