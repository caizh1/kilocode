# Mermaid Diagrams

Chat Markdown renders fenced `mermaid` and `mmd` code blocks as diagrams after a response finishes streaming. The same presentation layer is used by the sidebar, Open in Tab, and Agent Manager conversations.

## Behavior

- Valid Mermaid fences render inline as SVG diagrams.
- Each diagram has controls to zoom from 25% to 600% in 25% steps, fit the canvas, open a full viewer, and show or hide the original source.
- The full viewer supports button zooming, fit-to-window, pointer dragging, Escape to close, and focus restoration.
- Copy and Download menus provide Mermaid source, SVG, and PNG formats. PNG export uses the diagram's intrinsic size, a capped device pixel ratio, and the active theme background before passing the image to the existing VS Code save dialog bridge.
- Invalid Mermaid syntax shows a contained error state, keeps the source visible, and provides source copy and Prepare repair actions.
- Prepare repair only writes a localized repair request into the matching conversation draft and focuses the input. It never sends a message automatically. Read-only views copy the repair request instead.
- Diagrams are not rendered while a message is streaming, which avoids repeated parse/render work on every token.
- Diagram colors are derived from the active VS Code/ChipMate CSS variables so light, dark, and high-contrast themes can render with matching backgrounds, text, borders, and link colors.

## Limitations

- Mermaid is bundled by the current webview build, so bundle splitting remains a future optimization.
- Syntax repair still uses the normal QA input and send flow. There is no automatic model request, dedicated repair model, or persisted repair message.
- Draw.io, remote Mermaid rendering, Word illustration rendering, and QA prompt behavior are outside this feature.
