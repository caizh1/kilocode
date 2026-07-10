# 08 Mermaid PNG Rendering Rules

## 1. Kilo render route

Mermaid `.mmd` is the editable diagram source. High-DPI white-background PNG is the Word figure artifact. Do not bundle local renderer dependencies into VSIX. Prefer configured remote renderer; externally installed `mmdc` is acceptable only as an explicit external runtime path.

Use `render_mermaid_diagram` or `save_mermaid_artifact` when the user or active document scope asks for a persisted Mermaid artifact or Word figure. Use `scale: 3` for normal Word figures and `scale: 4` only for unusually dense diagrams after simplifying or splitting the graph. Keep the returned `width` / `height` as the Word display size and keep `pixelWidth` / `pixelHeight` only as high-DPI diagnostics.

## 2. Artifact indexing

The render tool writes `.mmd` and `.png` artifacts under Kilo's artifact location, normally `.kilo/artifacts/diagrams/`. Do not assume the tool writes directly into this skill's requested `04-diagrams/` tree. When the work package requires `04-diagrams/mmd/...` and `04-diagrams/png/...`, create or update `04-diagrams/diagram-index.md` and the coverage CSVs to map the requested logical diagram path to the tool-returned artifact path.

## 3. Diagram syntax

Business flow diagrams default to `flowchart TD`; state overview diagrams use `stateDiagram-v2` when appropriate. Node ids must use ASCII letters, digits, and underscores. Node labels may use Chinese business language. Edge labels must be readable business conditions and should quote punctuation-heavy labels. Exact C conditions belong in evidence tables, not overloaded node labels.

## 4. Word insertion

When a Word figure is requested, use the returned PNG path in `FigureSpec.image.path` / `artifactPath`. Raw Mermaid source should not be used as the Word figure body unless the user explicitly asks for Mermaid source as a code block instead of a rendered diagram. If remote rendering fails, omit the figure or disclose the render gap; do not substitute Mermaid syntax as if the figure existed.

## 5. Quality checks

For diagrams that are actually produced, keep Mermaid source, PNG output when available, and evidence/edge notes together. If render metadata reports warnings, record them in review notes and disclose whether the figure was rendered, skipped, or needs owner review. Do not trigger an automatic missing-diagram repair loop.
