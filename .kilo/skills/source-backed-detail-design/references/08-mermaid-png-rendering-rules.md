# 08 Mermaid PNG Rendering Rules

## 1. Kilo render route

Mermaid `.mmd` is the editable diagram source. High-DPI white-background PNG is the Word figure artifact. Do not bundle local renderer dependencies into VSIX. Prefer configured remote renderer; externally installed `mmdc` is acceptable only as an explicit external runtime path.

Use `render_mermaid_diagram` or `save_mermaid_artifact` when the user or active document scope asks for a persisted Mermaid artifact or Word figure. Use a white background and `scale: 3` for normal Word figures; use `scale: 4` only for unusually dense diagrams after simplifying or splitting the graph. The renderer crops to real content bounds with 32 CSS px safety padding and returns `contentBounds`, `cropBounds`, `padding`, and `contentCropRatio`. Keep the returned cropped `width` / `height` as the Word display size and keep `pixelWidth` / `pixelHeight` only as high-DPI diagnostics. Treat `contentCropRatio < 0.2` as suspicious and preserve returned warnings and QA issues in review notes.

## 2. Artifact indexing

The render tool writes `.mmd` and `.png` artifacts under Kilo's artifact location, normally `.kilo/artifacts/diagrams/`. Do not assume the tool writes directly into this skill's requested `04-diagrams/` tree. When the work package requires `04-diagrams/mmd/...` and `04-diagrams/png/...`, create or update `04-diagrams/diagram-index.md` and the coverage CSVs to map the requested logical diagram path to the tool-returned artifact path.

## 3. Diagram syntax

Business flow diagrams default to `flowchart TD`; state overview diagrams use `stateDiagram-v2` when appropriate. Node ids must use ASCII letters, digits, and underscores. Node labels may use Chinese business language. Edge labels must be readable business conditions and should quote punctuation-heavy labels. Exact C conditions belong in evidence tables, not overloaded node labels.

## 4. Word insertion

Before Word creation, maintain `diagramId -> targetSection -> pngPath -> QA status`. For every successful render, place an image block at the exact intended position in the lightweight initial skeleton's target `sections[].blocks[]` array. Prefer `pngPath` over base64 so the skeleton stays bounded:

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

Structural `apply_word_document_edits` calls cannot add image blocks. Use them only for non-image chapter content; use `insert_mermaid_into_word` at a unique figure heading when a valid PNG becomes available after initial creation. Raw Mermaid source should not be used as the Word figure body unless the user explicitly asks for Mermaid source as a code block instead of a rendered diagram. If rendering fails and there is no source-mapped, visually reviewed existing PNG, omit the image block and disclose the render gap; do not substitute Mermaid syntax, ASCII art, a text box, or a prose pseudo-diagram as if the figure existed.

## 5. Quality checks

For diagrams that are actually produced, keep Mermaid source, PNG output when available, the target section, and evidence/edge notes together. Record dimensions, scale, crop metadata, warnings, and QA issues, and disclose whether each figure was rendered, skipped, or needs owner review. Open every PNG at 100% and inspect node text, edge labels, and arrows at 200%; metadata alone is insufficient. Reject excessive whitespace, clipping, overlaps, missing branches, unreadable labels, unexpected backgrounds, and distorted proportions. After all serial Word chapter and late-image mutations, compare the inspected image count with the successful planned figure count. Reuse an existing PNG with `insert_mermaid_into_word` only when that explicit check finds a missing planned image; do not regenerate unrelated content or trigger a global repair loop.
