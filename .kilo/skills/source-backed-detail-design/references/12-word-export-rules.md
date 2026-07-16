# 12 Word Export Rules

## 1. Kilo Word route

When the user asks for Word output, generate the `.docx` with Kilo's generic Word tools. Use `create_word_document` for the initial artifact and `apply_word_document_edits` for bounded non-image chapter batches. Do not introduce a task-specific Word pipeline, temporary JSON shell bridge, local Pandoc, local LibreOffice/soffice authoring, `pip install`, `npm install`, `python-docx`, or a standalone Python/Node DOCX script as the primary or fallback route. `08-word-export-input.md`, when used, is an auditable assembly draft, not the final export mechanism or tool payload.

## 2. create_word_document arguments

Before calling `create_word_document`, verify the required Word tools are exposed in the active runtime and build object-shaped top-level arguments with `title`, optional document fields, and `sections`. Never wrap the arguments in another object or pass stringified JSON, quoted JSON, Markdown, or prose. Choose a stable `taskSlug` and `.docx` `outputFile` once. A full detailed design uses a lightweight initial skeleton containing the real tool-level title, optional document metadata, summary paragraphs, exactly one standalone summary paragraph whose full text is `{{TOC}}`, canonical headings beginning with Heading 1 `阅读路径`, unique H2/H3 insertion anchors, and all available successful image blocks, but no long prose, large tables, long lists, or code bodies. Do not embed the placeholder in other text, place it inside a chapter, repeat it, or handwrite a directory as Normal paragraphs. Use returned PNG paths instead of base64 whenever possible.

After skeleton creation, fill non-image content in canonical order with strictly serial `apply_word_document_edits` calls. Pass the stable `taskSlug` and `outputFile` explicitly on every edit, image, style, and field mutation so the final filename does not accumulate `-edited` suffixes. One main chapter or important-submodule design unit is the maximum batch size. Split a larger unit across unique anchors, insert after each anchor exactly once, and pass every newly returned Word path into the next mutation. Structural edits cannot add image blocks; use `insert_mermaid_into_word` at a unique figure heading for a late PNG.

If a large call fails, reduce it to the lightweight skeleton rather than writing the payload to a temporary file or retrying the same oversized object. Split a failing chapter until the smallest meaningful subsection is isolated. If that subsection still fails, preserve the last successful DOCX and disclose the missing content and native tool error instead of switching to a third-party generator. Use assumptions, limitations, gaps, and owner-review items for incomplete evidence rather than continuing unbounded search.

Sections must preserve the hybrid structure from `10-detail-design-output-templates.md`: opening context and detailed main business flow first, then target-module implementation, then one continuous chapter per important submodule, followed by cross-module summaries, indexes, coverage, optional differences, and review items. Do not assemble all submodule business flows, code flows, state machines, or objects into separate horizontal Word chapters that detach local detail from its owning submodule.

New detailed-design documents use the Codex `standard_business_brief` baseline: US Letter portrait, one-inch margins, Calibri 11 pt body, the standard blue H1/H2/H3 hierarchy, real numbering, fixed-DXA tables, quiet running header, and right-aligned page number. Put the standalone `{{TOC}}` paragraph after the title/summary and before the first Heading 1 for a full detailed design. After all chapter and late-image mutations, call `materialize_word_fields` with `tocMode: "materialize"`, the stable `taskSlug`, and the stable `outputFile`. The result must be a native Word TOC field with a non-outline directory heading and page separation, not a static list of copied heading text.

## 3. Existing-document update and difference output

For an existing-document update, rebuild conclusions from current source and use `apply_word_document_edits`, `apply_word_template_styles`, `materialize_word_fields`, `normalize_word_table_spec`, `merge_word_documents`, or `diff_word_documents` as appropriate. Preserve unrelated user content and styles where the request is a bounded edit. Do not regenerate unrelated chapters or use the old document as current implementation evidence.

A difference-only request may return the requested diff report without producing a new full Word document. A single-chapter, single-submodule, state-machine-only, or quick update uses the same generic Word tools and only the relevant sections; it must not be expanded into the canonical full-document outline unless the user asks.

## 4. Figures and diagrams

Track `diagramId -> targetSection -> pngPath -> QA status`. Insert every successfully rendered Mermaid diagram as an image block in the lightweight skeleton at the exact `sections[].blocks[]` position where it is explained:

```json
{
  "type": "image",
  "path": "<pngPath returned by render_mermaid_diagram>",
  "contentType": "image/png",
  "title": "Figure title",
  "caption": "Figure explanation",
  "altText": "Accessible description",
  "width": 480,
  "height": 280
}
```

Use ordered blocks to control surrounding text, image, title, and caption placement. Use the render result's cropped display width and height and retain pixel dimensions as QA evidence. Word insertion is inline, centered, aspect-locked, downscale-only, and bounded to 624 CSS px wide and 720 CSS px high. If fitting the page makes labels unreadable, split and rerender the diagram instead of shrinking it again. Keep `.mmd` paths in diagram indexes and evidence ledgers for traceability. If the user explicitly asks for Mermaid source in Word, use a normal code block with Mermaid source; otherwise rendered diagrams must be PNG images.

## 5. Render verification

After skeleton creation, all chapter, late-image, style, and field mutations must finish before the final `inspect_word_document` call. Require exactly one Title-style paragraph whose text equals the planned document title, no remaining `{{TOC}}`, and `阅读路径` as the first outline item followed by `术语、范围与证据基线`. Then require `imageCount` to match the number of successful renders planned for insertion. If structure is missing or reordered, repair the authoritative DOCX before delivery. If image count does not match, reuse the existing PNG for each missing figure with `insert_mermaid_into_word`, then inspect again. Do not regenerate unrelated document content.

All mutations of one DOCX must be serialized. Parallel Mermaid rendering is allowed, but parallel calls that edit or insert into the same `sourcePath` are forbidden: each output is a sibling fork and later copies can discard earlier figures. Maintain one authoritative working path and pass the path returned by each successful `apply_word_document_edits`, `insert_mermaid_into_word`, style, or field operation into the next mutation. A disclosed image-count mismatch is not completion; sequentially repair missing figures, reinspect, and continue only after the count matches.

The post-repair inspection must also compare the final outline, heading order, submodule design units, later cross-module chapters, captions, image relationships, and diagram identity map with the planned document. `imageCount` alone is insufficient: missing or reordered chapters, multiple drawings collapsed onto one relationship, or a semantically wrong/repeated PNG must be repaired before rendering.

For the full detailed-design Word workflow, call `render_word_document` after the image-count and outline checks. The tool tries the configured Render Service first and the local LibreOffice/Poppler path second. `visualQaStatus: completed` means page-image evidence exists, not that the model inspected it. Open every page PNG at 100%, inspect complex figure/table/code pages again at 200%, fix material risks, rerender the whole document, and repeat the all-page review. Automated page QA, ink ratios, edge checks, or inability to view images cannot be reported as visual pass; if pages cannot actually be opened, disclose that the manual page review was skipped. If both render paths are unavailable, continue the Word delivery with `visualQaStatus: skipped`, disclose the reason, and do not claim page-image visual QA passed.

## 6. Success criteria

A completed Word deliverable should report the final non-empty `.docx` path returned by the complete serial create/edit/repair chain, Mermaid render and QA status, successful planned figure count, inspected image count, any bounded repair, and whether final Word render QA ran, skipped, or failed. A Markdown draft, Mermaid source, ASCII diagram, temporary JSON file, or `08-word-export-input.md` alone is not a Word deliverable unless the user explicitly asked only for a draft.
