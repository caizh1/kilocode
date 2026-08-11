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

# ChipMate Child Setting Search Design QA

## Evidence

- Source visual truth: `/Users/archer/.codex/generated_images/019f9769-2368-7582-b646-1e5e0c2525bd/call_04ofwLhMFPmZSb30SMpBsvKk.png`
- Desktop implementation screenshot: `/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/settings-search-desktop.png`
- Narrow implementation screenshot: `/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/settings-search-narrow.png`
- Combined full-view comparison: `/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/settings-search-comparison.png`
- Viewports: `1440 × 1024` and `420 × 900` CSS px at device scale factor `1`.
- Source pixels: `1487 × 1058`; desktop implementation pixels: `1440 × 1024`; narrow implementation pixels: `420 × 900`.
- The source and desktop implementation have effectively identical aspect ratios and were normalized into equal `720 × 512` comparison cells without cropping.
- State: VS Code dark theme, query `嵌入维度`, real `向量维度` setting located on the Indexing page, full row highlighted, control unchanged and unfocused.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- Fonts and typography: the result title, breadcrumb, description, page content, and control labels reuse the current VS Code/ChipMate font stack and preserve readable hierarchy at both widths.
- Spacing and layout rhythm: desktop search results stay inside the existing `232px` navigation track; the selected result uses the current full-width navigation geometry. The content panel scrolls independently to center the row while the settings header remains fixed in view.
- Colors and visual tokens: the result selection and located-row treatment reuse existing Titanium and VS Code focus, border, foreground, and surface tokens. High-contrast fallbacks remain explicit.
- Image quality and asset fidelity: no new raster, generated icon, custom SVG, CSS icon, or placeholder asset is used. The only image remains the existing ChipMate logo.
- Copy and content: the implementation intentionally uses the real current setting name `向量维度` and its real description rather than the generated mock's invented values or provider layout. The query still matches the common Chinese alias `嵌入维度`, the English alias `embedding dimension`, and configuration-key terms.
- The generated mock shows three loosely related results for one exact query; the implementation ranks deterministic real settings and returns the one exact target. This avoids misleading navigation to invented or conditionally unavailable fields.
- A separate focused comparison was unnecessary because the full-view board keeps the result card, breadcrumb, row label, description, input state, and highlight legible; the narrow screenshot separately verifies the responsive target treatment.

## Interaction and Runtime Checks

- Verified search by current title, bilingual alias, description, page path, and configuration-key terms.
- Verified selecting a child result navigates to the owning page, scrolls only the settings content panel, highlights the full row, retains the query, and does not focus, click, open, or edit the control.
- Verified `window.scrollY` remains `0`, the header stays visible, no save bar appears, and no dirty state is created by search or navigation.
- Verified an explicit `3072` edit can still be made, saved, and observed after save.
- Verified the narrow picker closes after selection, shows Indexing as the current page, highlights the target, and does not focus or dirty the input.
- Verified page-only search, all 17 existing page routes, keyboard navigation, close behavior, dark, light, high contrast, and responsive containment through the targeted Storybook suite.
- In-app browser inspection found no runtime error in the located state.

## Comparison History

- Initial runtime pass found a P2 navigation regression: `scrollIntoView()` scrolled the whole document and moved the settings header off screen.
- Fix: calculate the target offset relative to `[data-ui="settings-content"]` and scroll only that panel, retaining `scrollIntoView()` solely as a fallback when the panel is unavailable.
- Post-fix evidence: the desktop screenshot and in-app browser readback show `window.scrollY = 0`, the header at `12px`, and the located row centered in the content panel.

## Windows ARM Installed-VSIX Acceptance

- Installed artifact: `/Users/archer/Downloads/chipmate-1.0.8-win32-x64-baseline-settings-search.vsix`, SHA-256 `aea87895ce88154587c1bd9e7a42fb92086e23408e224b3f45af4390e986ca39`.
- Host: Windows 11 ARM64 `10.0.26200.0` in Parallels, running the required `win32-x64-baseline` VSIX through Windows Prism.
- Final passing run: `C:\qa\settings-search-1.0.8\settings-search-x64-prism-r6`; copied report: `/Users/archer/Downloads/chipmate-settings-search-windows-arm-r6/report.html`.
- Desktop evidence: `/Users/archer/Downloads/chipmate-settings-search-windows-arm-r6/desktop.png`.
- Narrow evidence: `/Users/archer/Downloads/chipmate-settings-search-windows-arm-r6/narrow-220-420.png`.
- Reopen evidence: `/Users/archer/Downloads/chipmate-settings-search-windows-arm-r6/verify.json`.
- The installed-host gate passed package manifest/content audit, forced installation, activation, all 15 visible internal settings pages, four navigation groups, desktop and `332px` narrow child-setting search, result selection, target marking, no automatic control focus, no dirty state, no duplicate option IDs, and no horizontal overflow.
- The same run rejected an invalid ChipMate Server URL, saved the valid replacement, edited the embedding model and dimension to `qa-embedding-model-1019` and `3072`, saved them, reopened Settings, and confirmed all values persisted with no save or endpoint error.
- Four real mock embedding requests observed the saved model and dimension after reopen.
- The local responsive browser gate additionally asserts that the highlighted target intersects the viewport after smooth scrolling.
- Two later harness-only reruns did not reach the search assertions because the existing feature-gated navigation readiness probe remained below its expected item count. The passing installed-VSIX run and browser regression remain valid; this startup nondeterminism is not counted as a product-search failure.
- As expected for an x64-only release artifact exercised on ARM, the VM reports that the x64 LanceDB native module cannot load under Prism. Settings search, edit, save, reopen, and configuration propagation passed; native x64 indexing storage remains for the user's physical x64 acceptance gate.

## Follow-up Polish

- P3: broad queries can intentionally return more results than the mock because matching includes real descriptions and configuration keys; exact-title and exact-alias matches remain ranked first.

final result: passed

# ChipMate Settings Navigation Refactor Design QA

## Evidence

- Source visual truth: `/Users/archer/.codex/generated_images/019f9769-2368-7582-b646-1e5e0c2525bd/call_Hr14ZTynueAgiKF94xEvSIoY.png`
- Final desktop implementation: `/Users/archer/.codex/visualizations/2026/07/27/019f9769-2368-7582-b646-1e5e0c2525bd/settings-refactor/final-desktop-chipmate-1440x900.png`
- Final narrow implementation: `/Users/archer/.codex/visualizations/2026/07/27/019f9769-2368-7582-b646-1e5e0c2525bd/settings-refactor/final-narrow-chipmate-open-420x900.png`
- Full-view comparison: `/Users/archer/.codex/visualizations/2026/07/27/019f9769-2368-7582-b646-1e5e0c2525bd/settings-refactor/final-source-vs-implementation.png`
- Focused navigation comparison: `/Users/archer/.codex/visualizations/2026/07/27/019f9769-2368-7582-b646-1e5e0c2525bd/settings-refactor/final-navigation-focused-comparison.png`
- Viewports: `1440 × 900` and `420 × 900` CSS px at device scale factor `1`.
- Source pixels: `1672 × 941`; implementation pixels: `1440 × 900` and `420 × 900`.
- Comparison boards: `2072 × 1040` full view and `1510 × 760` focused navigation. The source is a composite VS Code mock with native chrome, so the boards normalize each surface into labeled cells rather than claiming a pixel-diff.
- State: VS Code dark theme, ChipMate Server selected, narrow grouped picker open.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- Fonts and typography: the implementation uses the existing VS Code/ChipMate font stack. Static group headings, page labels, selected state, truncation, and control hierarchy remain readable at both target widths.
- Spacing and layout rhythm: the desktop navigation keeps a stable `232px` track with full-width click targets; under `720px` it becomes one full-width page picker above the content. Header actions and the save bar remain in normal flow and wrap at the existing narrow breakpoint.
- Colors and visual tokens: glass fills, borders, focus blue, muted labels, shadows, and high-contrast fallbacks reuse the existing Titanium and VS Code theme tokens.
- Image quality and asset fidelity: the only visible image asset is the existing ChipMate logo. Icons are existing monochrome Codicons using `currentColor`; no replacement raster, handcrafted SVG, CSS icon, or placeholder asset was introduced.
- Copy and content: all 17 existing page labels and the current ChipMate Server content remain intact. The mock's separate top search is intentionally consolidated into the desktop navigation and into the single narrow picker so the narrow UI never presents duplicate search entry points.

## Interaction and Runtime Checks

- Verified every visible settings page remains reachable on desktop.
- Verified the narrow picker opens, groups pages, filters by translated page name, selects a result, closes, and updates the visible panel.
- Verified Arrow Up/Down, Home, End, Enter, and Escape behavior, plus selected and focus states.
- Verified `360–1450px` responsive boundaries, dark, light, high contrast, settings close activation, Sandboxing visibility, and no document overflow.
- Browser capture reported no console errors or uncaught page errors.

## Windows ARM Installed-VSIX Acceptance

- Installed artifact: `chipmate-1.0.20-win32-x64-baseline.vsix`, SHA-256 `8bd373743acf0b4d2f85f9482849b5841f3f8931b6a040e91c46eb3c819ffabb`.
- Host: Windows 11 ARM64 `10.0.26200.0` in Parallels, running the baseline x64 VSIX with packaged ARM64 CLI sidecars.
- Final report: `/Users/archer/.codex/visualizations/2026/07/27/019f9769-2368-7582-b646-1e5e0c2525bd/settings-refactor/windows-arm-1.0.20/report.html`.
- Desktop evidence: `/Users/archer/.codex/visualizations/2026/07/27/019f9769-2368-7582-b646-1e5e0c2525bd/settings-refactor/windows-arm-1.0.20/evidence/WIN-SETTINGS-PROVIDER/desktop.png`.
- Narrow evidence: `/Users/archer/.codex/visualizations/2026/07/27/019f9769-2368-7582-b646-1e5e0c2525bd/settings-refactor/windows-arm-1.0.20/evidence/WIN-SETTINGS-PROVIDER/narrow-220-420.png`.
- Reopen evidence: `/Users/archer/.codex/visualizations/2026/07/27/019f9769-2368-7582-b646-1e5e0c2525bd/settings-refactor/windows-arm-1.0.20/evidence/WIN-SETTINGS-PROVIDER/verify.json`.
- The installed-host gate passed package installation, activation, all 15 visible settings pages, four navigation groups, translated search, invalid Server URL rejection, Server save/reopen persistence, and indexing endpoint/model/dimension edit/save/reopen persistence.
- The saved indexing model `qa-embedding-model-1019` and dimension `3072` were observed in four real mock embedding requests after reopen. This caught and fixed a runtime propagation gap where OpenAI-compatible requests previously omitted the configured dimension.
- The ARM VM still reports that the extension-side x64 LanceDB native module cannot load on the ARM host. This is recorded separately from settings correctness: the configuration persisted and reached embedding requests, but native x64 indexing storage remains for the user's native Windows x64 release gate.

## Comparison History

- Initial comparison found a P2 desktop affordance mismatch: group containers inherited shrink-to-content sizing, making selected and clickable rows narrower than the navigation panel and centering group labels.
- Fix: set each desktop group to `width: 100%` and explicitly left-align group headings.
- Post-fix evidence: the focused comparison shows full-row navigation targets and left-aligned group headings with no remaining P0/P1/P2 issue.

## Follow-up Polish

- P3: the implementation uses larger row spacing than the generated mock. This is intentional for scanability and pointer targeting and does not reduce visible settings or create overflow.

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
- The title and benefit icons reuse Codicon and chipmate-ui assets and remain in normal flex flow; no custom SVG or absolute-positioned icon layout was added.
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

---

# QA 对话工具调用状态条 Design QA

## 证据

- 选定设计图：`/Users/archer/.codex/generated_images/019fa6a3-687c-7d20-896e-e423db45aaae/call_vA4Sti83YLK6CcJC4SYUNiAF.png`
- 深色实现：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call/实现-深色-420x720.png`
- 浅色实现：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call/实现-浅色-420x720.png`
- 高对比实现：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call/实现-高对比-420x720.png`
- 窄宽实现：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call/实现-窄宽-200x720.png`
- 完整并排对比：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call/对比-完整-源图与实现.png`
- 聚焦并排对比：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call/对比-聚焦-源图与实现.png`
- 源图尺寸：`1091 × 1441` 像素。
- 主实现视口：`420 × 720` CSS 像素；浏览器最小视口为 `240px`，窄宽故事在其中固定渲染精确的 `200px` QA 内容宽度。
- 状态：简体中文 QA 对话；完成的 read、bash、edit，运行中的 bash，以及展开的 edit Diff 标题。

## 发现

- 实现保留了方案 1 的核心层级：轻量玻璃触发条、青蓝左侧强调线、细边界、`8px` 圆角、弱阴影，以及右侧“勾选＋完成”状态。
- 工具图标继续使用项目现有图标；标题、路径、状态和展开箭头均处于正常 flex 流，没有新增自绘图标或绝对定位。
- `read` 保持不可展开且不显示伪造箭头；bash 和 edit 继续使用原有展开语义。
- 完成状态只在既有 completed 状态下出现，并且没有新增 `aria-live` 或 `role="status"`。
- `200px` QA 内容宽度下“完成”文字隐藏，勾选图标保留；四个触发区均无横向溢出。
- edit 展开状态下的 sticky offset 计算值为 `40px`；Diff、终端、文件内容和复制操作继续使用原有实现。
- 所有新视觉选择器均限定在 `.chat-view[data-ui="qa-shell"]`，非 QA 环境中的私有状态槽默认隐藏。
- 与源图并排检查后，保留现有工具图标和约 `40px` 高度属于已批准的实现约束，不构成视觉偏差。
- 目标范围内未发现可执行的 P0、P1 或 P2 视觉差异。

## 交互与运行检查

- 基于真实 `AssistantMessage` 和工具注册表故事验证深色、浅色、高对比、`420px` 和精确 `200px` 内容宽度。
- 验证 read 无箭头、bash 键盘展开/收起、edit 展开、三个完成状态以及运行中无完成状态。
- 浏览器运行检查未发现错误日志；QA 状态文本没有新增实时播报区域。
- 针对 QA 工具状态条的 Playwright 可访问性和交互测试通过。

## 对比修正记录

- 补齐 BasicTool 直接作为消息根节点的 bash 结构，使其与 read、edit 使用同一套玻璃状态条和完成状态。
- 将 edit 触发条恢复到同一 `40px` 基线，并校正横向位置，使三类工具触发区对齐。
- 为 `200px` 故事增加精确内容宽度容器，确认状态文字隐藏和标题省略不是浏览器最小视口造成的假象。

final result: passed

---

# QA 对话工具调用状态条二次校准 Design QA

## 证据

- 选定设计图：`/Users/archer/.codex/generated_images/019fa6a3-687c-7d20-896e-e423db45aaae/call_vA4Sti83YLK6CcJC4SYUNiAF.png`
- 最终设计对照场景：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-100pct-20260728/21-最终设计对照场景-420x720.jpg`
- 最终同视口并排对比：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-100pct-20260728/22-最终设计对照并排.png`
- 最终浅色状态集合：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-100pct-20260728/16-最终浅色完整-420x720.jpg`
- 最终高对比状态集合：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-100pct-20260728/19-验证实现高对比-420x720.jpg`
- 最终窄宽状态集合：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-100pct-20260728/20-验证实现窄宽-200内容.jpg`
- 对照视口与状态：`420 × 720`、简体中文、已完成的 `read README.md`。

## 修正结果

- 移除上一轮的圆角卡片轮廓、四边描边和外投影，改为与对话背景融合的扁平玻璃状态条。
- 按设计图校准为 `40px` 高度、上下分隔线、短青蓝强调线、左右留白和同一垂直基线。
- `read` 使用项目已有的 `liquid-file` 图标，并在 QA 内显示本地化“读取文件”；非 QA 环境中的私有槽位继续隐藏。
- 标题、圆点分隔、等宽文件名、绿色勾选和中性“完成”文字的字号、字重、颜色与间距已按并排图逐轮收敛。
- 状态条左右边界、强调线、文件图标和标题起点已在同一 `420px` 对照中对齐。
- 保留既定交互约束：不可展开的 `read` 不伪造箭头；可展开工具继续显示原有箭头并保持原有回调。
- 设计对照故事与多状态回归故事分离，避免为了截图缩减原有 read、bash、edit、running 覆盖。
- 所有样式仍限定在 `.chat-view[data-ui="qa-shell"]`，未修改工具协议、执行状态、输出内容和其他界面。

## 验证

- 深色、浅色、高对比和 `200px` 内容宽度均无重叠或横向溢出。
- “完成”在常规宽度完整显示，在窄于 `260px` 时只隐藏文字并保留勾选。
- `read` 无展开箭头；bash 键盘展开/收起、edit 展开内容与 sticky 标题保持原行为。
- 目标单元测试、类型检查、Lint、Storybook 构建、Knip、变更标记检查、编译和两项针对性 Playwright 可访问性/交互测试均通过。
- 同视口同状态并排检查未发现可执行的 P0、P1 或 P2 视觉差异。

final result: passed

---

# QA 对话工具调用状态条四项精校 Design QA

## 证据

- 选定设计图：`/Users/archer/.codex/generated_images/019fa6a3-687c-7d20-896e-e423db45aaae/call_vA4Sti83YLK6CcJC4SYUNiAF.png`
- 浏览器最终实现：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-four-items-aligned-20260728/14-四项可访问性校准最终版-420x720.jpg`
- 完整组件同尺度对比：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-four-items-aligned-20260728/15-设计图与最终版-同尺度.png`
- 聚焦三倍对比：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-four-items-aligned-20260728/16-设计图与最终版-三倍放大.png`
- 深色状态集合：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-four-items-aligned-20260728/10-深色完整状态-420x720.jpg`
- 浅色状态集合：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-four-items-aligned-20260728/11-浅色完整状态-420x720.jpg`
- 高对比状态集合：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-four-items-aligned-20260728/12-高对比完整状态-420x720.jpg`
- 窄宽状态集合：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-four-items-aligned-20260728/13-窄宽完整状态-200x720.jpg`
- 源图尺寸：`1091 × 1441` 像素；源工具条按 `420px` 宽归一化后裁切为 `420 × 56` 像素。
- 实现视口：`420 × 720` CSS 像素，浏览器密度为 `1`；窄宽回归视口为 `200 × 720`。
- 状态：简体中文、已完成的 `read README.md`；回归集合同时覆盖已完成和运行中的 bash、展开的 edit。

## 范围与冻结项

- 本轮只校准标题比例、文件名、完成状态，以及文件名与青色强调线的距离。
- 框体宽高、背景颜色、上下边界颜色、青色强调线的尺寸与位置、标题元素起点和原有展开箭头均保持本轮修改前的值。
- 没有修改工具执行、状态来源、消息协议、输出内容、展开回调、sticky offset 或 QA 之外的选择器作用域。

## 对齐结果

- 标题实际像素范围：设计图约 `x=60–101`，实现约 `x=59–101`；宽度和右边界已对齐到 `1px` 内。
- 文件名实际像素范围：设计图约 `x=122–177`，实现约 `x=121–177`；起点、终点以及相对强调线的距离已对齐到 `1px` 内。
- 完成图标实际像素范围：设计图约 `x=332–342`，实现约 `x=332–341`；“完成”文字设计图约 `x=349–367`，实现约 `x=348–367`。
- 文件名和完成文字保留设计图的弱化层级，但没有复制源图中低于 WCAG AA 的灰度；最终颜色使用能通过现有 `4.5:1` 门禁的最接近主题色。
- 完成图标继续使用现有 `circle-check`，继承成功色并校准描边视觉重量，没有新增 SVG、CSS 图标或绝对定位。

## 必查视觉面

- 字体与排版：标题使用更紧凑的 `11px/600` 比例；文件名使用 `12px` 等宽字体和 `-0.75px` 字距；完成文字使用 `11px/400`。
- 间距与布局：只用正常 flex 流、负外边距和字距校准文件名，不改变标题元素起点、框体或箭头。
- 颜色与视觉令牌：框体、背景、边界和强调线完全冻结；文字继续使用 Titanium 主题令牌，并保留可访问性对比度下限。
- 图像与图标质量：没有新增图片资产；文件和完成状态均复用项目现有图标。
- 文案与内容：继续显示本地化“读取文件”“完成”和真实文件名，没有修改消息内容。

## 对比历史

- 初始对比：标题实际宽度约比设计图多 `12px`，文件名起点向右约 `12px`、终点向右约 `25px`，完成图标向左约 `11px`。
- 第一轮：缩小标题和文件名比例、移动文件名正常流位置，并缩小完成状态组合；文件名起点和完成图标进入设计坐标。
- 第二轮：进一步校准标题宽度与文件名字距；标题、文件名和完成状态均收敛到 `1px` 范围。
- 可访问性轮：直接复刻源图灰度导致部分小字对比度约 `3.46:1`；只提高文字主题色，不回退已经对齐的尺寸和位置。最终 Playwright 颜色对比与披露行为测试通过。

## 验证

- 深色、浅色、高对比和 `200px` 窄宽均无重叠或横向溢出；窄宽继续隐藏“完成”文字并保留勾选。
- read 继续不显示伪造箭头；bash 和 edit 的原有箭头、键盘展开/收起及展开内容保持工作。
- 浏览器预览未发现运行错误。
- 目标单元测试 `4` 项通过；类型检查、Lint、Storybook 构建、Knip 和变更标记检查通过。
- 针对 QA 工具调用状态条的 Playwright 可访问性与交互测试通过。
- 未发现可执行的 P0、P1 或 P2 差异；源图不可访问的低灰度被明确归类为不可照搬的约束。

final result: passed

---

# QA 对话工具调用文件名字距复校 Design QA

## 证据

- 选定设计图：`/Users/archer/.codex/generated_images/019fa6a3-687c-7d20-896e-e423db45aaae/call_vA4Sti83YLK6CcJC4SYUNiAF.png`
- 自然字距实现：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-readme-spacing-20260728/01-自然字距候选-420x720.png`
- 同尺度对比：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-readme-spacing-20260728/02-设计图与自然字距-同尺度.png`
- 三倍整体对比：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-readme-spacing-20260728/03-设计图与自然字距-三倍放大.png`
- 六倍字形对比：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-tool-call-readme-spacing-20260728/04-README字形间距-六倍对比.png`
- 对照视口与状态：`420 × 720`、简体中文、已完成的 `read README.md`。

## 修正结果

- 删除文件名原有的 `-0.75px` 负字距，恢复等宽字体的自然字符节奏。
- 文件名字号由 `12px` 调整为 `11px`，通过字号收敛整体宽度，不再压缩字母之间的空隙。
- 浏览器计算样式为 `11px`、`letter-spacing: normal`；文字排版宽度约 `59.6px`，起点保持在约 `x=121px`。
- 同尺度与六倍字形对比显示，`README.md` 的字母间距已接近设计图，不再出现实际版字母粘连的观感。
- 框体大小、背景颜色、边界颜色、青色强调线、标题位置、完成状态和右侧箭头均未修改。

## 验证

- 文件名仍使用真实文本和现有等宽字体，没有新增字体资源、图片、SVG 或绝对定位。
- `read` 的两种现有标题结构均使用相同的自然字距规则。
- 目标单元测试、Lint、类型检查及 QA 工具调用可访问性与交互回归均通过。
- 未发现可执行的 P0、P1 或 P2 视觉差异。

final result: passed

---

# Ultra 原理图确认弹窗 Design QA

## 证据

- 选定设计图：`/Users/archer/.codex/generated_images/019fa74f-4132-7220-9f25-842eb4043108/call_AeLE3aXTw4e1xQoCAHnQEnOc.png`
- 浏览器最终实现：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/ultra-principle-420.jpg`
- 完整同尺度对比：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/ultra-principle-comparison.png`
- 流程图聚焦对比：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/ultra-principle-flow-comparison.png`
- 源图尺寸：`959 × 1639` 像素。
- 实现视口：`420 × 718` CSS 像素，浏览器密度为 `1`。
- 归一化：源图按比例缩放并补边到 `420 × 718`；实现以同尺寸视口直接捕获。
- 状态：简体中文、深色 VS Code 主题、Ultra 阻断式确认弹窗打开、确认按钮自动获得焦点。

## 必查视觉面

- 字体与排版：标题继续使用现有 `20px/650` Ultra 层级；说明为 `13px`；流程节点为 `10px`，盲态补充文字为 `9px`。实现没有复制设计稿经缩放后不可读的小字号。
- 间距与布局：弹窗恢复现有 `344px` 宽度契约；流程图为单一玻璃表面，节点和连接线全部留在正常 flex/grid 流中。最终弹窗为 `344 × 531.7px`，流程区为 `298 × 302.8px`，页面无横向或纵向溢出。
- 颜色与视觉令牌：背景、边界、阴影和紫色强调全部使用现有 VS Code/Ultra 主题令牌；只强调独立证据仲裁和最终交付。
- 图像与图标质量：原理图使用真实 DOM 文本和主题线条，不使用静态流程图图片；标题继续复用现有 Codicon sparkle，没有新增 SVG、CSS 图标或彩色资源。
- 文案与内容：完整呈现用户问题、冻结基准、深化调查、扩展调查、盲态反证、证据仲裁、获批修正、争议分支、最终复核与原样交付；读屏通过一段完整本地化说明读取流程。

## 完整与聚焦对比

- 完整对比显示标题、说明、玻璃流程面、提示文字和唯一确认按钮的层级与选定设计一致，背景仍可辨识为原 QA 输入区。
- 聚焦对比显示三路调查、独立仲裁和争议复核关系均清楚；实现把设计图中的细线和小节点提高到真实 `1x` 视口可读尺寸，因此整体高度略高于归一化设计图，这是可访问性约束下的预期差异。
- 未发现裁切、重叠、乱码、错误连接方向、丢失节点或主题外颜色。

## 对比历史

- 初始实现：弹窗宽 `376px`、流程区高 `384px`，相对设计稿过宽过高，背景上下文几乎消失，记录为 P2。
- 修正：弹窗恢复 `344px`；缩小流程节点、间距和连接线；把盲态反证从基准答案分支中拆出，改为直接从用户问题形成独立旁路。
- 最终复核：弹窗宽 `344px`、流程区高 `302.8px`，背景上下文重新出现；完整与聚焦对比均无可执行的 P0、P1 或 P2 差异。

## 交互、响应式与验证

- 浏览器预览无控制台错误；确认按钮自动获得焦点。
- Ultra 定向 Playwright `3/3` 通过，覆盖不可关闭确认、鼠标和键盘进入、Slash 命令、原生 Ultra 身份、会话切换、重复进入、主题色以及 `200 × 720` 极窄视口。
- `200px` 下流程自动改为单列，弹窗保持视口内滚动且确认按钮可见，无水平溢出。
- TypeScript、ESLint、完整扩展编译、Knip 和 `check-chipmate-change` 均通过。

final result: passed

---

# Ultra 流程节点边框清晰度复核

## 证据与归一化

- 选定设计图：`/Users/archer/.codex/generated_images/019fa74f-4132-7220-9f25-842eb4043108/call_AeLE3aXTw4e1xQoCAHnQEnOc.png`，`959 × 1639` 像素。
- 用户反馈截图：`/var/folders/9s/q5y69fzj3b59lt103v6y4f4m0000gn/T/codex-clipboard-b20de1b5-fc30-4d44-b889-bd7cefe36252.png`，`420 × 718` 像素。
- 浏览器修正版：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/ultra-principle-border-420.png`，`420 × 718` 像素。
- 三联对比：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/ultra-principle-border-comparison.png`；依次为选定设计、反馈时实现、修正版实现。
- 实现视口为 `420 × 718` CSS 像素，设备密度为 `1`；设计图按比例缩放并补边到相同尺寸，反馈截图与修正版无需缩放。
- 状态：简体中文、深色 VS Code 主题、Ultra 阻断式确认弹窗打开且确认按钮聚焦。

## 发现与修正

- P2：反馈截图中的普通文字节点依赖 `widget-border` 混合色，在当前深色主题下与节点背景明度过近；用户问题、基准答案、调查节点、获批修正和最终复核的容器轮廓不够连续。
- 修正：普通节点改为基于 `foreground` 的 `36%` 半透明主题描边，并增加 `10%` 内高光与轻微底部材质阴影；连接线由 `42%–48%` 提升到 `52%–58%`，保持流程关系连续。
- 修正后证据：三联对比右侧的普通节点均形成清楚的玻璃白边，仍显著弱于紫色仲裁与交付节点，没有改变原有视觉优先级。

## 必查视觉面

- 字体与文案：字号、字重、行高、换行和全部流程文案保持不变。
- 间距与布局：弹窗、流程区、节点尺寸、圆角和网格结构未变；`420px` 视口无裁切或溢出。
- 色彩与令牌：描边继续使用 VS Code 主题前景色，不写死白色；浅色主题可自然得到深色描边。
- 图像与图标：没有新增或替换图像、图标、SVG 或 CSS 图形资产。
- 聚焦对比：流程图已占三联对比的主要可读区域，节点描边在原始 `1x` 尺寸下可直接判读，因此无需再次裁切放大。

## 交互与验证

- 浏览器预览无控制台错误，确认按钮继续自动获得焦点。
- Ultra 定向 Playwright `3/3` 通过，覆盖阻断确认、键盘与 Slash 入口、会话切换、重复进入、主题语义色和 `200px` 极窄布局。
- `bun run typecheck` 与 `bun run lint` 通过。
- 最终没有未解决的 P0、P1 或 P2 视觉问题。

final result: passed

---

# QA 工具强调线顺序修正 Design QA

## 证据与状态

- 用户实机问题截图：`/var/folders/9s/q5y69fzj3b59lt103v6y4f4m0000gn/T/codex-clipboard-078a89ec-a06a-4758-a913-56cb76753f7f.png`。
- 选定设计图：`/var/folders/9s/q5y69fzj3b59lt103v6y4f4m0000gn/T/codex-clipboard-fd92693b-6427-43f9-9336-44ee3964b4a1.png`。
- 深色实现：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-accent-order-fixed-20260728/01-深色强调线顺序-420x720.png`。
- 浅色实现：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-accent-order-fixed-20260728/02-浅色强调线顺序-420x720.png`。
- 高对比实现：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-accent-order-fixed-20260728/03-高对比强调线顺序-420x720.png`。
- 窄宽实现：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-accent-order-fixed-20260728/04-窄宽强调线顺序-200内容.png`。
- 修复前、修复后与设计图三联对比：`/Users/archer/.codex/visualizations/2026/07/28/019fa6b2-df7f-7910-91fd-b20b8a02cd01/qa-accent-order-fixed-20260728/05-修复前-修复后-设计图对比.png`。
- 实现视口为 `420 × 720` CSS 像素，窄宽场景外层视口为 `240 × 720`，内部 QA 内容宽度为 `200px`，浏览器密度为 `1`。
- 状态覆盖已完成 Read、已完成 Bash、展开 Edit、运行中 Bash 和结构化标题 Web Search。

## 发现与修正

- P2：强调线原先挂在 `basic-tool-trigger-layout::before`，Shell、Edit 和结构化标题等使用外层默认图标的工具呈现为“图标 → 强调线 → 标题”；Read 因专属图标位于内层而偶然正确。
- 修正：强调线迁移到所有标准工具共有的 `basic-tool-tool-trigger-content::before`，通过正常 flex 流固定为“强调线 → 图标 → 标题”，没有使用绝对定位。
- Read 专属图标只调整既有负边距补偿，Read、Shell 和 Edit 在 `420px` 视口中的标题起点仍为 `58px`，框体和整行内容没有向右漂移。
- 浏览器测量五个标准工具的强调线至图标间隔均为 `6px`，图标至标题间隔均为 `2px`；内层 `basic-tool-trigger-layout::before` 的计算内容均为 `none`。

## 必查视觉面

- 字体与排版：标题、文件名、完成状态的字号、字重、行高和字距保持不变。
- 间距与布局：只重排强调线所属 flex 层与对应间距；框体大小、标题起点、完成状态和右侧箭头坐标保持不变。
- 颜色与视觉令牌：背景、边界和青色强调线继续使用原有 Titanium 主题令牌，没有新增硬编码主题色。
- 图像与图标质量：复用现有文件、终端、编辑、网络搜索、完成和展开图标，没有新增 SVG、CSS 图标或替代资源。
- 文案与内容：工具标题、文件名、参数、完成文案和输出内容均未改动。

## 响应式、交互与回归

- `420px` 深色、浅色和高对比截图中，Read、Bash、Edit 与结构化标题工具均保持相同顺序和相对间距。
- `200px` 内容宽度下五个工具触发区均无横向溢出；完成文字按既有断点隐藏，勾选图标和展开箭头仍在正常 flex 流中。
- QA Playwright 覆盖完成状态语义、键盘展开、Read 不伪造箭头以及五类工具的几何顺序，`1/1` 通过。
- QA 样式单元测试明确禁止将强调线重新挂回 `basic-tool-trigger-layout`，`4/4` 通过。
- TypeScript、ESLint、Storybook 构建、扩展编译、Knip 和 `check-chipmate-change` 均通过。
- 浏览器控制台没有错误；仅有 Storybook 离开 VS Code 运行时的预期 mock 警告。
- 本轮未启动真实 VS Code Extension Host，因此安装态实机截图仍标记为未验证，不用 Storybook 截图冒充实机通过。

## 审查结论

- 未发现成立的 P0 或 P1 缺陷。
- 修复范围限定于 QA Shell 中的标准工具触发区；特殊问题卡片、任务卡片、待办卡片、工具执行、消息协议、输出、Diff sticky 和公开 API 均未改变。

final result: passed

---

# 嵌入式审查能力边界卡片 Design QA

## 证据与状态

- 选定设计图：`/Users/archer/.codex/generated_images/019fa255-7a69-7492-9477-378232e548b5/call_3GW19BaJLJreCnLICgXG9OJc.png`，`912 × 1725` 像素。
- `420px` 最终实现：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/embedded-review-boundary-final-420.jpg`，`420 × 720` 像素。
- `240px` 窄栏实现：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/embedded-review-boundary-final-240.jpg`，`240 × 1000` 像素。
- 聚焦同尺度对比：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/embedded-review-boundary-comparison.jpg`。
- 状态：简体中文、深色 VS Code 主题、输入 `/embedded-review uncommitted`、范围详情默认展开。

## 必查视觉面

- 信息层级：保留“嵌入式审查 / 实验性 / 三项事实 / 可检查 / 不检查 / PASS 提醒”的定稿顺序；盲区使用琥珀色内嵌面板和“6 类盲区”徽标突出，但不覆盖主功能标题。
- 材质与主题：主卡片、范围面板和输入框均复用 VS Code 主题令牌，并使用轻量玻璃背景、内高光、柔和阴影和细边界；没有引入主题外的固定彩色图标。
- 图标与布局：盾牌、清单、文件、警告和折叠动作复用项目图标组件；所有图标都位于正常 flex/grid 流中，没有使用绝对定位。
- 文案与风险：明确列出 5 类可检查逻辑、6 项机械规则、6 类不检查风险；即使折叠详情，`PASS 不代表整体安全` 仍永久可见。
- 与定稿差异：真实实现按 VS Code `12px–14px` 可读字号和现有输入区控件压缩了纵向留白；核心层级、风险强调和视觉语义一致，没有复制设计图中依赖整窗背景的装饰区域。

## 响应式、交互与可访问性

- `420px` 下卡片宽 `396px`、内容滚动宽 `394px`，根容器 `clientWidth` 与 `scrollWidth` 均为 `420px`，无横向溢出。
- `240px` 下事实项改为单列、盲区改为单列、实验性徽标自然换行；卡片宽 `216px`、滚动宽 `214px`，无横向溢出。
- 折叠按钮具有动态中文可访问名称、`aria-expanded` 和 `aria-controls`；折叠后详情移除，但风险提醒保留。
- Axe 的 WCAG 2.0/2.1/2.2 A 与 AA 扫描无违规；浏览器控制台无错误，仅有 Storybook 离开 VS Code 运行时的预期 mock 警告。

## 验证与边界

- Embedded Review Playwright `4/4` 通过，覆盖内容、Axe、折叠、命令触发和 `240px` 防溢出。
- 命令识别单元测试 `2/2` 通过；TypeScript、ESLint、Knip 与 `check-chipmate-change` 通过。
- 本轮验证的是真实 Storybook 组件及响应式行为，没有启动已安装 VS Code Extension Host；安装态视觉仍属于后续打包验收，不用 Storybook 证据冒充。
- 未发现未解决的 P0、P1 或 P2 视觉与交互问题。

final result: passed

---

# Ultra 三路验证确认弹窗 Design QA

## 证据与状态

- 深色 `420 × 720` 实现：`/Users/archer/.codex/visualizations/2026/07/28/019fa6ff-82c5-7f92-a43d-e5d3c3e4d9f1/ultra-three-way-verify-dark.png`。
- 最终 `420 × 718` 浏览器实现：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/ultra-session-flow-420.png`。
- 窄宽浏览器实现：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/ultra-session-flow-240.png`；精确 `200 × 720` 由 Playwright 回归场景验证。
- 状态：简体中文、深色 VS Code 主题、Ultra 阻断式确认弹窗打开、确认按钮自动聚焦。
- 流程图与实际运行时一致：用户问题 → Code 生成并冻结答案 → 三个互相隔离的 Explore 独立验证 → 独立 Ask 综合 → 最终答案。

## 视觉、响应式与回归

- 沿用现有 Liquid Glass 材质、紫色 Ultra 语义色、Codicon sparkle、玻璃边界与正常 flex/grid 布局，没有新增图片、SVG、绝对定位图标或廉价渐变。
- 冻结答案只连接三个 Explore，不存在冻结答案直连 Ask 的视觉路径；三份 Explore 报告再等权汇入 Ask。
- 第一轮分叉横线只明确落到左右 Explore，中间 Explore 的竖线不完整，记录为 P2；最终改为三个正常流分支容器，每个 Explore 上下均有独立竖线。
- 三个 Explore 节点在 `420px` 下等宽并列，连线、节点与正文没有遮挡；`200px` 极窄场景由既有响应式规则改为单列。
- 当前组件和本地化文案不再包含调用链验证、对抗式验证、源码覆盖验证、争议复核或原样交付等旧模式标签。
- Ultra 定向 Playwright `3/3` 通过，覆盖阻断确认、键盘与 Slash 入口、原生 Ultra 身份、会话切换、主题语义色、三个 Explore 节点计数、新读屏说明、旧标签缺失和窄宽布局。
- TypeScript、ESLint、完整扩展编译与 `check-chipmate-change` 通过；未发现 P0、P1 或 P2 视觉与交互问题。

final result: passed

---

# Ultra 深化加验证确认弹窗 Design QA

> 该组合方案已于 2026-07-29 完成 A/B 后撤销：其双轮盲评分数低于纯三路验证，当前实现恢复为上一节记录的纯三路验证弹窗。以下内容仅保留为历史设计记录。

## 证据与状态

- `420 × 720` 深色实现：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/ultra-deepen-verify-420.png`。
- `200 × 720` 窄宽顶部：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/ultra-deepen-verify-200.png`。
- `200 × 720` 窄宽滚动到底部：`/Users/archer/Work/chipmate/packages/chipmate-vscode/qa/artifacts/ultra-deepen-verify-200-bottom.png`。
- 流程图与运行时一致：用户问题 → Code 生成并冻结答案 → 三路并行深化 → 三路并行验证 → 独立 Ask 综合 → 最终答案。

## 视觉、响应式与回归

- 沿用现有 Liquid Glass 材质、紫色 Ultra 语义色、Codicon sparkle 和正常 flex/grid 布局，没有新增图片、SVG、绝对定位图标或廉价渐变。
- 两个并行波次在 `420px` 下均为三个等宽节点；`200px` 下改为单列，根页面 `scrollWidth` 保持 `200px`，无横向溢出。
- `200px` 弹窗正文的 `clientHeight` 为 `558px`、`scrollHeight` 为 `680px`，可滚动 `122px`；滚动到底部后最终答案、说明和确认按钮均完整可见。
- Ultra 定向 Playwright `3/3` 通过，覆盖阻断确认、键盘与 Slash 入口、原生 Ultra 身份、会话切换、六个 Explore 节点、两个三路波次和窄宽布局。
- TypeScript、ESLint、完整扩展编译、Knip 与 `check-chipmate-change` 通过；未发现 P0、P1 或 P2 视觉与交互问题。

final result: passed
