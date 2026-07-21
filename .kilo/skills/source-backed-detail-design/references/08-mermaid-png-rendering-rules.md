# 08 Mermaid PNG Rendering Rules

## 1. Kilo render route

Mermaid `.mmd` is the editable diagram source. High-DPI white-background PNG is the Word figure artifact. Do not bundle local renderer dependencies into VSIX. Prefer configured remote renderer; externally installed `mmdc` is acceptable only as an explicit external runtime path.

Use `render_mermaid_diagram` or `save_mermaid_artifact` when the user or active document scope asks for a persisted Mermaid artifact or Word figure. Use a white background and `scale: 3` for normal Word figures; use `scale: 4` only for unusually dense diagrams after simplifying or splitting the graph. The renderer crops to real content bounds with 32 CSS px safety padding and returns `contentBounds`, `cropBounds`, `padding`, and `contentCropRatio`. Keep the returned cropped `width` / `height` as the Word display size and keep `pixelWidth` / `pixelHeight` only as high-DPI diagnostics. Treat `contentCropRatio < 0.2` as suspicious and preserve returned warnings and QA issues in review notes.

## 2. Artifact indexing

The render tool writes `.mmd` and `.png` artifacts under the active product profile's artifact location. Do not assume the concrete directory; use the path returned by the tool. When the work package requires `04-diagrams/mmd/...` and `04-diagrams/png/...`, create or update `04-diagrams/diagram-index.md` and the coverage CSVs to map the requested logical diagram path to the tool-returned artifact path.

## 3. Diagram syntax

Business flow diagrams default to `flowchart TD`; state overview diagrams use `stateDiagram-v2` when appropriate. Node ids must use ASCII letters, digits, and underscores. Node labels may use Chinese business language. Edge labels must be readable business conditions and should quote punctuation-heavy labels. Exact C conditions belong in evidence tables, not overloaded node labels.

## 4. Word insertion

Before Word creation, maintain separate `CoverageSlot` and `DiagramRequirement` ledgers. `CoverageSlot` has exactly `5D` base rows for the one target module and every target-owned confirmed submodule, where `D = 1 + confirmedSubmoduleCount`; evidenced owning modules are excluded. `DiagramRequirement` has one row per actual base or focused figure and records `diagramId -> baseOrFocused -> owningSlot -> complexityInstanceIds -> sourceEvidence -> mmdPath -> sourceStatus -> syntaxValidation -> semanticCoverage -> pngPath -> visibleFigureId -> targetSection -> renderDisposition -> visualQaStatus -> wordInsertionStatus`. Every non-`N/A` base slot needs a unique primary PNG; one PNG cannot satisfy another design unit or view type. A required render failure remains an explicit `MISSING` requirement but does not permit an image-only skeleton or incomplete prose. An optional owning-module orientation figure is additional and satisfies no base slot. Keep each successful render and its unique target H2/H3 heading in the ledger; the initial working skeleton is text-only, and insertion starts only after its body audit passes:

```json
{
  "wordPath": "<latest working DOCX path>",
  "source": "<validated Mermaid source>",
  "pngPath": "<pngPath returned by render_mermaid_diagram>",
  "heading": "<unique existing H2/H3 heading>",
  "figureTitle": "中文图题",
  "caption": "[DU-<designUnitId>/<viewType>/<diagramId>] 中文图注",
  "altText": "完整的中文可访问性说明，源码符号保持原样",
  "width": 480,
  "height": 280
}
```

Structural `apply_word_document_edits` calls cannot add image blocks. Use them only to replace exact prose anchors; after the text-only body audit passes, use `insert_mermaid_into_word` at a unique existing H2/H3 heading. Even when `pngPath` already exists, the insertion call still requires the exact Mermaid text in `source`; also pass the current authoritative `wordPath`, unique `heading`, stable `taskSlug`/`outputFile`, source-mapped `pngPath`, plain Chinese `figureTitle`, complete independent Chinese `altText`, and unique visible caption. Insert multiple diagrams under one heading in reverse desired display order. Raw Mermaid source should not be used as the Word figure body unless the user explicitly asks for Mermaid source as a code block instead of a rendered diagram. If rendering fails and there is no source-mapped, visually reviewed existing PNG, mark the required slot `MISSING`, disclose the render gap, and keep the text-complete delivery `PARTIAL`; acceptance remains `PARTIAL`. Do not substitute Mermaid syntax, ASCII art, a text box, or a prose pseudo-diagram as if the figure existed.

## 5. Quality checks

For every required diagram, keep Mermaid source, PNG output when available, the owning design unit/view slot, visible figure ID, target section, complexity instance IDs, and evidence/edge notes together. Record dimensions, scale, crop metadata, warnings, and QA issues, and disclose whether each figure was rendered, skipped, or needs owner review. Open every PNG at 100% and inspect node text, edge labels, and arrows at 200%; metadata alone is insufficient. Reject excessive whitespace, clipping, overlaps, missing branches, unreadable labels, unexpected backgrounds and distorted proportions. For a new full Word the text-only skeleton relationship set is empty; track late insertions, replacements, actual removals, and final IDs by set difference. Structural paragraph deletion is not proof of relationship removal, and replacement normally retains the relationship rather than adding one. Treat `inspect_word_document.imageCount` only as a coarse count. Call inspection with `maxParagraphs: 1000` and `maxTables: 200`; require no truncation for the body and caption-ID audits. Page images can verify placement and layout but cannot prove missing prose. Reuse an existing PNG only for a specifically identified missing insertion; do not blindly duplicate images, regenerate unrelated content, or trigger a global repair loop.
