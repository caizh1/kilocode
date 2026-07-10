# Document Tools Contract

## Purpose

- [x] This document defines the minimum contract for migrated document artifact, Word, and Mermaid tools.
- [x] These tools are deliverable-generation tools, not QA-routing tools.
- [x] These tools must be implemented as additive Kilo tools and must not replace Kilo `document_search`.
- [x] This is a generic tool API boundary only. It is not a migrated ChipMate Word/document runtime contract, recipe gate, repair loop, or planner steering mechanism.
- [x] Do not migrate ChipMate `nextToolContract`, required-artifact validators, document-depth gates, recipe-specific Word repair prompts, or skill contract gates into Kilo QA.

## Artifact Tool Boundary

- [x] Artifact root defaults to `.kilo/artifacts`.
- [x] Each artifact lives under `.kilo/artifacts/<timestamp>-<task-slug>/`.
- [x] Every generated deliverable must be declared through an artifact manifest.
- [x] All manifest file paths must be artifact-relative or workspace-relative.
- [x] Tools must reject output paths outside the active workspace.
- [x] Tool results must return paths, summaries, quality status, and warnings, not large binary contents or full document bodies.

Minimum manifest:

```json
{
  "kind": "word-document",
  "title": "Module Design Document",
  "createdAt": "2026-07-07T15:30:12+08:00",
  "primaryFile": "design.docx",
  "derivedFiles": ["design.pdf", "rendered/page-001.png"],
  "sourceFiles": [],
  "warnings": [],
  "quality": {
    "status": "ok"
  }
}
```

Artifact tools:

- [x] `declare_artifact`: create or update an artifact manifest.
- [x] `list_artifacts`: list current workspace artifacts.
- [x] `open_artifact`: open an artifact file or folder through the VS Code side when available.
- [x] `export_artifact_diagnostics`: export artifact diagnostics for support and regression review.

## Generic Word Tool Boundary

- [x] Word migration scope is generic `.docx` creation, inspection, editing, style inheritance, merge, diff, and render diagnostics.
- [x] Word tools may validate their own arguments and return warnings, but they must not impose a ChipMate-style document contract on ordinary Kilo QA.
- [x] Word tools must not force missing-deliverable repair prompts, artifact-consumption gates, or recipe-specific document-depth checks into the Kilo native agent loop.

- [x] `create_word_document` creates a `.docx` from a structured document spec.
- [x] `inspect_word_document` returns bounded outline, paragraph, table, image, style, and anchor summaries.
- [x] `apply_word_document_edits` applies structured edit operations to an existing `.docx`.
- [x] `render_word_document` renders `.docx` to PDF and page PNGs through an external renderer.
- [x] `apply_word_template_styles` applies template styles, theme, fonts, and numbering.
- [x] `merge_word_documents` merges multiple `.docx` files while preserving images and relationships.
- [x] `diff_word_documents` reports document differences as Markdown summary plus structured diagnostics.
- [x] `materialize_word_fields` handles caption, SEQ, TOC, and page-number related fields where supported.

Word edit operations for v1:

- [x] `insert_after_heading`
- [x] `insert_before_heading`
- [x] `append_blocks`
- [x] `replace_paragraph`
- [x] `replace_paragraph_with_blocks`
- [x] `replace_section`
- [x] `delete_paragraph`
- [x] `delete_section`
- [x] `delete_table`
- [x] `update_table`
- [x] `replace_image`

Word edit safety rules:

- [x] Delete operations default to dry-run.
- [x] Edits default to creating a new output file instead of overwriting the source.
- [x] Ambiguous anchors must return a warning and refuse high-risk edits unless the user supplies a more precise anchor.
- [x] Image edits must update `document.xml.rels`, `[Content_Types].xml`, and `word/media/*` consistently.
- [x] Template support means style, theme, font, and numbering inheritance; it is not a full arbitrary mail-merge engine.

## Mermaid Tool Boundary

- [x] `validate_mermaid_diagram` performs lightweight validation and safety checks.
- [x] `render_mermaid_diagram` renders Mermaid text to PNG.
- [x] `save_mermaid_artifact` stores `.mmd`, `.png`, and manifest entries.
- [x] `insert_mermaid_into_word` inserts a rendered PNG into a Word document.

Mermaid diagnostic codes:

- [x] `chrome-not-found`
- [x] `chrome-startup-failed`
- [x] `mermaid-render-failed`
- [x] `mermaid-render-timeout`
- [x] `png-invalid`
- [x] `artifact-write-failed`

Mermaid boundary:

- [x] Mermaid tools render explicit diagram content.
- [x] Mermaid tools must not infer business main flows, exception flows, state roles, or layout semantics from source code.
- [x] Business semantics must come from the model, active skill, or user-provided diagram spec.

## Renderer Boundary

- [x] LibreOffice, Chromium, and Poppler remain outside the VSIX.
- [x] Renderer endpoint may be empty by default.
- [x] Missing renderer endpoint must return a warning for render tools without breaking Word creation or QA.
- [x] Rendered outputs should be persisted under the active artifact directory.

## No-Regression Boundary

- [x] These tools must not replace `document_search`.
- [x] These tools must not trigger for ordinary source-code QA.
- [x] These tools must not return large document bodies to the model by default.
- [x] These tools must preserve Kilo's existing permission and path-safety expectations.
