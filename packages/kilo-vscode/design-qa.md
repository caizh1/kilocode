# PlantUML Streaming Progress Design QA

## Evidence

- Source visual truth: `/Users/archer/.codex/generated_images/019f92b0-78f3-7380-ae5b-3726ae3feccf/call_G7QVTcZinxy3zU6Ugc2scptK.png`
- Implementation screenshot: `/Users/archer/.codex/visualizations/2026/07/24/019f92b0-78f3-7380-ae5b-3726ae3feccf/plantuml-streaming-implementation.png`
- Full-view comparison: `/Users/archer/.codex/visualizations/2026/07/24/019f92b0-78f3-7380-ae5b-3726ae3feccf/plantuml-streaming-comparison.png`
- Focused card comparison: `/Users/archer/.codex/visualizations/2026/07/24/019f92b0-78f3-7380-ae5b-3726ae3feccf/plantuml-streaming-card-comparison.png`
- Viewport: `420 × 720` CSS px at device scale factor `1`
- Source pixels: `958 × 1642`, normalized to `420 × 720`
- Implementation pixels: `420 × 720`
- State: complete PlantUML source while the assistant message is still streaming

## Findings

- No actionable P0, P1, or P2 visual differences.
- Fonts and typography: the status copy and monospace source match the existing plugin typography and preserve the reference hierarchy and wrapping.
- Spacing and layout rhythm: the waiting strip is approximately `48px`, left aligned, and the card width, padding, divider, radius, and source spacing match the focused reference.
- Colors and visual tokens: the implementation uses existing dark-theme surface, border, highlight, and shadow tokens. Its divider contrast is slightly stronger than the generated reference but remains a P3-level theme-dependent difference.
- Image quality and asset fidelity: the design contains no raster content. The implementation intentionally uses the project's existing Spinner rather than recreating the generated ring.
- Copy and content: the Chinese status text and PlantUML source match the selected design.
- The full-view comparison has a different scroll position and live thinking/input chrome because the implementation is a functioning Storybook chat state; the target PlantUML card and surrounding conversation context remain equivalent.

## Interaction and Runtime Checks

- Verified waiting, long-wait, success, error, timeout, cache reuse, source replacement, zoom, fit, fullscreen, source toggle, copy, and download behavior.
- Verified the waiting state at `420px` and toolbar containment at `300px`.
- Browser logs contained only the expected Storybook mock-VS Code warning and mock postMessage logs; no runtime errors were present.
- The first browser pass exposed a source-visibility race after Shiki replacement. The implementation now preserves the hidden state and resolves the current source node before success/error transitions.

## Comparison History

- Initial implementation: functional browser QA found that asynchronous syntax highlighting could expose source after success.
- Revised implementation: preserved source visibility state across highlighted node replacement; focused and full-view comparisons show no remaining P0/P1/P2 differences.

## Follow-up Polish

- P3: the generated reference uses a smooth ring spinner while the product requirement specifies the existing project Spinner; no change is recommended unless the project Spinner itself is redesigned.

final result: passed

---

# ChipMate Manual Update Design QA

## Evidence

- Latest reference: `/Users/archer/.codex/generated_images/019f93a8-32c4-75c0-bacd-b7ad8835c917/call_WymH0xBekv2tzLvIJa2rZ3NX.png`
- Available reference: `/Users/archer/.codex/generated_images/019f93a8-32c4-75c0-bacd-b7ad8835c917/call_PJG3IubTdAobROkcrPQ4iab6.png`
- Expanded notes reference: `/Users/archer/.codex/generated_images/019f93a8-32c4-75c0-bacd-b7ad8835c917/call_eUeMQF0CEW2m1W4RDN1m4S30.png`
- Implementation screenshots: `.runtime/update-design-qa/{latest,available,notes}-1440x1024.png`
- Side-by-side comparisons: `.runtime/update-design-qa/{latest,available,notes}-comparison.png`

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- The ChipMate brand header, server connection state, update-card sections, status hierarchy, controls, spacing, and Chinese copy match the selected references.
- The implementation keeps the existing Settings shell and VS Code navigation frame; comparison focuses on the ChipMate Server content surface because the reference also includes native VS Code activity and status bars that are outside this webview.
- Theme colors use VS Code tokens and Liquid Glass surfaces. Icons use existing ChipMate assets or monochrome Codicons with `currentColor`.
- Release notes render inside the card with the existing safe Markdown component and an ISO publication date.

## Interaction and Runtime Checks

- Verified latest, available, expanded notes, checking, installing, installed, and error stories.
- Verified click expansion and collapse, `aria-expanded`, `aria-live`, keyboard-native buttons and switch controls.
- Verified 1440 × 1024 dark, 900px and 480px responsive layouts, light theme, and high-contrast theme.
- Browser inspection found no current story runtime error; only the expected mock VS Code warning was present after a clean load.

## Comparison History

- Moved the server connection state below the address row to match the reference.
- Added the branded ChipMate page header and restored the exact Chinese title, description, connection wording, and sample server address.
- Replaced the plain success mark with the system `pass-filled` Codicon and excluded QA images from the packaged VSIX.

final result: passed
