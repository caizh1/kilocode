# 12 Word Export Rules

## 1. Kilo Word route

When the user asks for Word output, generate the `.docx` with Kilo's generic Word tool: `create_word_document`. Do not introduce a task-specific Word pipeline, local pandoc, local LibreOffice/soffice export, or a standalone node-docx script as the primary or fallback route. `08-word-export-input.md`, when used, is an auditable assembly draft, not the final export mechanism.

## 2. WordDocSpec requirements

Before calling `create_word_document`, build an object-shaped `WordDocSpec` with `metadata`, `sources`, and `sections`. Never pass `JSON.stringify(spec)`, quoted JSON, Markdown, or prose as `spec`. Use assumptions, limitations, gaps, and owner-review items for incomplete evidence rather than continuing unbounded search.

Sections should preserve the enhanced design structure: overview, business flow overview, architecture/dependencies, core data structures, interface design, main flow, state machine and exceptions, submodule business flows, code-level submodule flows, resources/performance, build/integration, source evidence appendix, diff report, and quality gates.

## 3. Figures and diagrams

Insert Mermaid diagrams as PNG-backed `FigureSpec` objects in the section that explains them. Copy the complete figure shape returned by `render_mermaid_diagram`: title, caption, alt text, image content type, artifact path, width, and height. Keep `.mmd` paths in diagram indexes and evidence ledgers for traceability.

If the user explicitly asks for Mermaid source in Word, represent it as a `codeBlocks[]` entry with `language: mermaid`; otherwise rendered diagrams must be PNG figures.

## 4. Render verification

After `create_word_document` succeeds, call `render_word_document` only when the user asks for visual QA, render verification is configured, or the task explicitly requires PDF/page PNG output. If remote render is unconfigured or unavailable, continue the Word delivery and disclose that page-level visual QA was skipped. If render returns page PNGs or visual summaries with material risks, report them and fix through the generic Word tools only when the user wants that follow-up.

## 5. Success criteria

A completed Word deliverable should report the non-empty `.docx` path returned by `create_word_document`, any generated figure paths, and whether render QA ran, skipped, or failed. A Markdown draft, Mermaid source, or `08-word-export-input.md` alone is not a Word deliverable unless the user explicitly asked only for a draft.
