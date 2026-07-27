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

# ChipMate Loading Motion Real Extension Host Final QA

## Evidence

- Selected design reference: `/Users/archer/.codex/generated_images/019f9413-3417-7800-9634-758b7f347e50/call_WFJxytoCEQxIdbWC0Izm9MmV.png`
- Real Extension Host before the final Orbital correction: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/real-host-2026-07-25/current-audit/orbital-phase-01.png`
- Real Extension Host after the final Orbital correction: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/real-host-2026-07-25/current-audit/v1018-orbital-phase-01.png`
- Final eight-phase source contact sheet: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/real-host-2026-07-25/current-audit/orbital-contact-v5.png`
- Final design/runtime comparison: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/real-host-2026-07-25/current-audit/orbital-v1018-design-comparison.png`
- Real host viewport: VS Code 1.129.1, 406 × 627 CSS px webview, device scale factor 2.
- Installed artifact: `chipmate-1.0.18-loading-motion-darwin-arm64.vsix`.

## Root Causes And Iterations

1. A global shuffle bag was consumed by unrelated or hidden Spinner mounts, which biased the visible working indicator.
2. One logical loading lifecycle could remount during submitting, busy, and retry transitions, drawing more than once.
3. The first Orbital implementation used thin composited layers whose large projection changes collapsed into a bright knot at small sizes.
4. The first raster rebuild kept the rings distinguishable but still changed all three projected planes too aggressively, producing an atom-like tangle instead of the selected three-axis gimbal silhouette.
5. The final 96-frame render fixes a horizontal, vertical, and diagonal readable skeleton, moves independent highlights along the ring surfaces, removes artificial ring wobble, keeps the center sphere visible, and closes every motion path over the 1.6-second loop.

## Findings

- The final 24 × 24 CSS px Orbital preserves three separate glass rings through all sampled phases.
- The horizontal, vertical, and diagonal axes remain readable instead of collapsing into an eye or line knot.
- The center sphere stays stationary and is correctly occluded by far and near ring segments.
- Ring highlights follow the local tube direction; the previous detached sparkle and uniform top-edge shine are removed.
- The final silhouette is materially closer to the selected astronaut-training gyroscope reference while remaining legible beside the working-status text.
- The visible first real-host bag began with Prism, Liquid, and Orbital without a repeat; the scoped shuffle and lifecycle behavior are also covered by the 12-test spinner suite.
- The 1.0.19 concurrent-session regression created three sessions in the same real webview and submitted one message in each before the previous sessions completed. Their working indicators resolved to Prism, Orbital, and Signal respectively; the first session's choice was no longer reused by the other two.
- No loading-motion decode, WebP, uncaught, or Extension Host crash errors were found in the current isolated-profile logs. The deliberately incomplete local QA provider can still end its response without usable output; that fixture behavior is unrelated to the spinner renderer.
- No actionable P0, P1, or P2 visual differences remain.

## Interaction, Packaging, And Accessibility Checks

- The mounted Orbital remained selected across the full eight-screenshot capture and did not redraw during reactive updates.
- All visible working-indicator variants occupy an exact 24 × 24 CSS px box without shifting the text baseline.
- The final Animated WebP contains 96 frames, loops indefinitely, and uses 16–17 ms frame durations.
- The VSIX contains 24 loading assets totaling 1,496,582 bytes, no `dist/*.map`, and no bundled FFmpeg.
- The packaged CLI SHA-256 matches the freshly built macOS ARM64 CLI.
- Reduced-motion, forced-colors, static-frame, and system-spinner fallbacks are verified by component tests; screenshot evidence alone is not used to claim full accessibility compliance.
- The targeted spinner suite now contains 12 tests and explicitly covers three concurrent session lifecycle keys.

final result: passed

# ChipMate High-FPS Loading Motion Enhancement

## Comparison Target and Evidence

- Selected source: `/Users/archer/.codex/generated_images/019f9413-3417-7800-9634-758b7f347e50/call_WFJxytoCEQxIdbWC0Izm9MmV.png`
- Combined source/implementation board: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/motion-enhance/17-design-implementation-comparison.png`
- Dark runtime view: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/motion-enhance/11-motion-qa-dark-final-a.png`
- Dark alternate phase: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/motion-enhance/16-motion-qa-dark-final-phase2.png`
- Light runtime view: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/motion-enhance/13-motion-qa-light-final.png`
- `12/14/16/18px` matrix: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/motion-enhance/14-size-matrix-dark-final.png`
- Orbital closed-ring phase QA: `/tmp/chipmate-motion-enhance.Mj7sqY/orbital/ring-phase-qa.png`
- Browser viewport: `1280 × 720` CSS px at density `1`.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- Orbital now reads as an astronaut training gyroscope: three independent closed glass gimbals rotate on different axes around a refractive core.
- Orbital, Signal, and Prism use browser refresh-rate-synchronized `transform` and `opacity` compositing. Liquid uses a 108-frame, 1.8-second Animated WebP with individual frame durations capped at 17ms.
- The closed Orbital assets remain a single connected ring with one enclosed hole at alpha thresholds `8/24/48/72`; no green or magenta keying residue remains.
- Dark and light assets retain distinct highlights and readable rims. The 16px working state is visibly larger without altering the compact 12–14px button states.
- All layers share a normal-flow `inline-grid` cell. No absolute positioning, clipping, baseline shift, or layout displacement is present.

## Comparison History

- Initial compositor pass:
  - P2: reconstructing full rings from near/far segments exposed broken arcs during 3D rotation.
  - Fix: replace each axis with a separately generated 360-degree closed glass hoop.
  - Post-fix evidence: the combined comparison board and closed-ring phase QA.
- Core proportion pass:
  - P2: the refractive center sphere became visually insignificant at the 48px inspection size.
  - Fix: enlarge only the Orbital core layer while preserving the existing slot and ring footprint.
  - Post-fix evidence: the dark alternate phase and light runtime view.

## Interaction and Runtime Checks

- All eight mounted motion layers reported ready after dark and light theme navigation.
- Exact spinner boxes were verified at `12 × 12`, `14 × 14`, `16 × 16`, and `18 × 18`.
- Current browser navigations produced no new runtime errors; earlier logged `root is not a function` entries came from the first development pass and were fixed before final capture.
- Static-first loading, reduced motion, high contrast, and image-failure fallback behavior remain wired.

final result: passed

---

# ChipMate Dynamic Loading Motion Design QA

## Comparison Target and Evidence

- Source visual truth:
  - Orbital Glass Weave: `/Users/archer/.codex/generated_images/019f9413-3417-7800-9634-758b7f347e50/call_VstUzbXjtQBuFNceycDKeCO8.png`
  - Glass Signal Fold: `/Users/archer/.codex/generated_images/019f9413-3417-7800-9634-758b7f347e50/call_75poepfVOuYyIWTkNOamvQvy.png`
  - Prism Fission: `/Users/archer/.codex/generated_images/019f9413-3417-7800-9634-758b7f347e50/call_mIzxYr3fyucnHmWwbUdPhD57.png`
  - Liquid Topology: `/Users/archer/.codex/generated_images/019f9413-3417-7800-9634-758b7f347e50/call_NtIlcEhwJNe7Dm7dtq5x5Geo.png`
- Browser-rendered implementation:
  - Dark: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/repair/03-all-variants-dark-graded.png`
  - Light: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/repair/04-all-variants-light.png`
  - Focused `12/14/16/18px` matrix: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/repair/06-size-matrix-dark-clip.png`
  - Full comparison board: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/repair/10-source-vs-implementation-board.png`
- Viewport and normalization: `1200 × 700` CSS px, `1200 × 700` captured pixels, density `1`; source boards were normalized to `600 × 375` cells on the combined comparison board.
- States: VS Code dark, VS Code light, high contrast, four explicit variants, `12/14/16/18/48px`.

## Findings

- No actionable P0, P1, or P2 visual differences remain after iteration.
- Fonts and copy: existing loading labels and typography are unchanged; the asset layer contains no text.
- Spacing and layout: the spinner keeps its existing square slot and text baseline at every tested size. Static and animated images share one `inline-grid` cell without absolute positioning or layout shift.
- Colors and tokens: separate dark/light assets retain visible glass rims on both backgrounds. Signal magenta keying residue found during the first pass was removed.
- Image quality: all four implementations use transparent 96px raster animation assets with glass thickness, refraction, highlight bloom, and the selected orbital/signal/prism/liquid silhouettes. No CSS art or handcrafted SVG remains in the visual layer.
- Accessibility: reduced motion selects the static PNG; VS Code high contrast and forced colors select the existing current-color system Spinner.
- Copy/content: all existing loading text, elapsed time, and business state remain owned by the surrounding product UI.

## Comparison History

- Iteration 1:
  - P1: the asset `Show` condition returned a boolean, producing `true.png` and falling back to the old Spinner.
  - Fix: preserve the resolved asset root as the `Show` value and use a separate asset accessor.
  - Post-fix evidence: all eight theme/variant WebP URLs load at natural size `96 × 96`.
  - P2: Signal retained magenta chroma contamination.
  - Fix: neutralize saturation after chroma removal and re-encode both theme assets.
  - Post-fix evidence: `03-all-variants-dark-graded.png` and the combined comparison board.

## Interaction and Runtime Checks

- Browser screenshots taken 320ms apart produced different SHA-256 values, confirming active animation frames.
- Dark/light theme selection resolves the matching four asset URLs without changing the selected variant.
- High contrast renders four system Spinner fallbacks with zero raster images.
- Browser console: no warnings or errors.
- Focused sizing confirms exact `12 × 12`, `14 × 14`, `16 × 16`, and `18 × 18` boxes with no clipping.

## Follow-up Polish

- P3: Prism intentionally becomes visually sparse at peak fission because the reference separates it into three small shards; retain this behavior unless a future design chooses a less dramatic split.

final result: passed

---

# ChipMate Working Indicator Size Follow-up

## Comparison Target and Evidence

- User source: `/var/folders/9s/q5y69fzj3b59lt103v6y4f4m0000gn/T/codex-clipboard-bb19e6cd-c21c-476b-a721-7064697ea66f.png`
- Browser-rendered light implementation: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/size-adjustment/05-working-spinner-16px-light-focus.png`
- Combined comparison: `/Users/archer/.codex/visualizations/2026/07/24/019f9413-3417-7800-9634-758b7f347e50/size-adjustment/06-source-vs-16px.png`
- Browser viewport: `1280 × 720` CSS px at density `1`; the implementation row was cropped and scaled to the source image's `506 × 116` comparison cell.
- State: VS Code Light Modern, active working status row, all four explicit loading variants.

## Findings

- P2: the default `1em` slot rendered as `12 × 12px` in the working row, leaving the transparent 96px asset's glass subject visually undersized beside the status text.
- Fix: set only `WorkingIndicator` to an explicit `16 × 16px` slot, increasing the status animation by about 33% without changing compact button spinners or global Spinner defaults.
- Post-fix: all four variants occupy exact `16 × 16px` boxes, remain vertically centered, and preserve the existing text baseline, elapsed-time alignment, gap, copy, and loading state behavior.
- Material, colors, theme asset selection, reduced-motion behavior, high-contrast fallback, and resource-failure fallback are unchanged.
- No actionable P0, P1, or P2 visual differences remain.

## Interaction and Runtime Checks

- Verified all four variants in the real Storybook component under VS Code dark and light themes.
- Verified the light-theme DOM resolves the corresponding light PNG/WebP assets.
- Browser console contains no warnings or errors.
- The change stays in normal flex flow and does not use absolute positioning.
- Component unit test locks the explicit size to the working status row.

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

---

# ChipMate Ultra Mode Selector Design QA

## Evidence

- Selected reference: `/Users/archer/.codex/generated_images/019f93c7-57df-78b1-88af-695420e3b149/call_dwE4DiZMG3hwqmbc8egahJrK.png`
- Dark implementation: `/Users/archer/.codex/visualizations/2026/07/24/019f93c7-57df-78b1-88af-695420e3b149/ultra-selector/04-dark-open-420.png`
- Light implementation: `/Users/archer/.codex/visualizations/2026/07/24/019f93c7-57df-78b1-88af-695420e3b149/ultra-selector/04-light-open-420.png`
- High Contrast Dark implementation: `/Users/archer/.codex/visualizations/2026/07/24/019f93c7-57df-78b1-88af-695420e3b149/ultra-selector/04-hc-dark-open-420.png`
- High Contrast Light implementation: `/Users/archer/.codex/visualizations/2026/07/24/019f93c7-57df-78b1-88af-695420e3b149/ultra-selector/04-hc-light-open-420.png`
- Narrow implementation: `/Users/archer/.codex/visualizations/2026/07/24/019f93c7-57df-78b1-88af-695420e3b149/ultra-selector/05-dark-closed-200.png`
- Side-by-side comparison: `/Users/archer/.codex/visualizations/2026/07/24/019f93c7-57df-78b1-88af-695420e3b149/ultra-selector/06-source-vs-dark-open.png`

## Findings

- Ultra uses the existing `codicon-sparkle`; the Ask fallback icon no longer appears after Ultra is selected.
- Dark Ultra icon and name resolve to `#A78BFA`; light resolves to `#6D28D9`. Contrast against the target dark and light surfaces is approximately `6.13:1` and `7.10:1`.
- High Contrast Dark and Light resolve Ultra to the VS Code foreground instead of forcing purple.
- Only the Ultra trigger icon, trigger label, and menu name receive the semantic color. Other Agent names, descriptions, Chevron, borders, backgrounds, hover, focus, and selected states retain existing tokens.
- The implementation intentionally preserves the current menu structure without adding the reference image's icons or selection checkmarks to other Agent rows.
- At 420px and 200px the trigger remains in normal flex/grid flow without overlap or horizontal overflow. Existing narrow responsive behavior hides the icon and Chevron while keeping the Ultra label readable.
- No actionable P0, P1, or P2 visual differences remain within the approved “only Ultra” scope.

## Interaction and Runtime Checks

- Verified click selection, `aria-selected`, selected-row focus, Escape focus restoration, and Storybook state persistence.
- Verified closed and expanded states under VS Code Dark Modern, Light Modern, High Contrast Dark, and High Contrast Light.
- The targeted Ultra Playwright test passed across all four themes and the 200px viewport.
- Browser inspection found no runtime errors; only the expected Storybook mock VS Code warning was present.
- The implementation uses the existing 16px icon slot and does not add absolute positioning, custom SVG, gradients, glow, image assets, or dependencies.

final result: passed

---

# ChipMate Ultra Mode Confirmation Design QA

## Evidence

- Selected reference: `/Users/archer/.codex/generated_images/019f9dd2-d8fb-76b3-aa9a-8e0d5b88f9e6/call_V0B2ScP3FHKkTpitWhO1In9A.png`
- Dark implementation: `/Users/archer/.codex/visualizations/2026/07/26/019f9dd2-d8fb-76b3-aa9a-8e0d5b88f9e6/ultra-confirmation/implementation-420-dark.png`
- Light implementation: `/Users/archer/.codex/visualizations/2026/07/26/019f9dd2-d8fb-76b3-aa9a-8e0d5b88f9e6/ultra-confirmation/implementation-420-light.png`
- High Contrast Dark implementation: `/Users/archer/.codex/visualizations/2026/07/26/019f9dd2-d8fb-76b3-aa9a-8e0d5b88f9e6/ultra-confirmation/implementation-420-hc-black.png`
- High Contrast Light implementation: `/Users/archer/.codex/visualizations/2026/07/26/019f9dd2-d8fb-76b3-aa9a-8e0d5b88f9e6/ultra-confirmation/implementation-420-hc-light.png`
- Narrow implementation: `/Users/archer/.codex/visualizations/2026/07/26/019f9dd2-d8fb-76b3-aa9a-8e0d5b88f9e6/ultra-confirmation/implementation-200-dark.png`
- Side-by-side comparison: `/Users/archer/.codex/visualizations/2026/07/26/019f9dd2-d8fb-76b3-aa9a-8e0d5b88f9e6/ultra-confirmation/source-vs-implementation.png`
- Source dimensions: `958 × 1642` pixels.
- Implementation viewport: `420 × 720` CSS pixels at density `1`; the in-app browser enforces a `240px` minimum viewport for its narrow capture, while Playwright separately verifies the exact `200 × 720` case.
- State: Simplified Chinese QA prompt, Code selected behind an open and focused Ultra confirmation.

## Findings

- The implementation preserves the reference hierarchy: purple sparkle, title, explanatory paragraph, three evidence-oriented benefits, suitability note, and one full-width primary confirmation action.
- The approved `344px` maximum dialog width is used at the `420px` QA sidebar breakpoint, with an `8px` minimum viewport gutter and no horizontal page overflow.
- Dark and light surfaces use VS Code semantic tokens with a restrained translucent glass material, soft edge highlight, backdrop blur, and a single layered shadow.
- High Contrast Dark and Light intentionally reduce to opaque system surfaces, explicit contrast borders, foreground icons, and no blur or shadow.
- The title and benefit icons reuse Codicon and kilo-ui assets and remain in normal flex flow; no custom SVG or absolute-positioned icon layout was added.
- At the exact `200px` Playwright viewport, the content wraps vertically without clipping, overlap, or horizontal scroll.
- No actionable P0, P1, or P2 visual differences remain within the approved implementation plan.

## Interaction and Runtime Checks

- Verified the confirmation button receives initial focus and the alert dialog traps Tab and Shift+Tab.
- Verified Escape and overlay pointer interaction do not dismiss the dialog.
- Verified Code remains selected and `selectAgent` is not called before confirmation; confirmation switches once and returns focus to the prompt.
- Verified Ultra to Code to Ultra prompts again, Ultra to Ultra does not prompt, and ordinary modes switch immediately.
- Verified pointer, keyboard, and `/agents` selection paths share the same confirmation flow.
- Verified native Ultra triggers the dialog, a non-native same-name Agent does not, and replacing the source session discards the pending confirmation.
- Browser inspection found no runtime errors; only the expected Storybook mock VS Code warning was present.
- Reduced-motion disables dialog transitions, and forced-colors mode uses an opaque system surface.
- The isolated development Extension Host launched successfully and activated `chipmate.chipmate`; visual clicks across the sidebar, editor QA tab, and Agent Manager could not be completed because the macOS screen-capture service failed to start.

final result: passed
