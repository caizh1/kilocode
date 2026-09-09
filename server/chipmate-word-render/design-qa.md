# Design QA — 首页 Top 10 轮播与分类 Skill 图标

- Source visual: `/Users/archer/.codex/generated_images/019f5a0c-a2b6-7663-b492-3527ee0f05b8/exec-b971485f-efa4-43b1-9f90-56aa63b3cd5f.png`
- Implementation URL: `http://127.0.0.1:4174/`
- Primary viewport: `1484 × 1060`
- Primary implementation screenshot: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/chrome-icons-1484x1060.png`
- Combined comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/reference-vs-chrome-1484x1060.png`
- Icon contact sheet: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/skill-icon-contact-sheet.png`
- Directory screenshot: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/chrome-directory-icons-1484x1060.png`
- Category card crops: `card-development.png`, `card-testing.png`, `card-operations.png`
- Dark-theme screenshot: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/chrome-dark-1484x1060.png`
- Secondary desktop screenshots: `chrome-icons-1440x1024.png`, `chrome-icons-1050x1024.png`

## Scope

- The React Web homepage and Skill card artwork fallback changed; backend routes, contracts and stored catalog data remain unchanged.
- Hero, search, directory, detail, ChipMate Marketplace, Word, Mermaid, packages, health, schemas, OpenAPI and database contracts remain unchanged. The reopened desktop cycle retains the Header structure and controls but aligns their scale under VA-18.
- The preview catalog now imports 10 deterministic real Skill rows through the existing importer and SQLite path for end-to-end verification.
- Twenty independent `512 × 512` generated Liquid Glass WebP assets ship in four five-icon families: documents (icy cyan), development (deep blue), testing (emerald) and operations (warm orange).
- A Skill with author artwork still uses that artwork first. A missing or broken artwork URL falls back to a category-colored icon selected deterministically from the Skill ID; unknown categories map consistently to one of the four families.
- `source-backed-detail-design` is the curated Skill whitelist entry that retains the ChipMate mark. Brand, footer and Hero uses of the ChipMate artwork remain unchanged.

## Interaction QA

- The real `GET /api/v1/skills?sort=downloads&limit=10` response contains 10 rows in descending cumulative-download order.
- Previous/next controls loop; `01–10` rank buttons select directly; preview cards select their represented Skill.
- ArrowLeft, ArrowRight, Home and End update the selection; pointer swipe changes the active card.
- The visible `查看技能` CTA opens the current Skill detail and browser Back returns to the homepage.
- Autoplay advances every six seconds and pauses on explicit pause, focus, hover and hidden-page state; manual selection restarts the cycle.
- `prefers-reduced-motion` disables autoplay, disables the autoplay control and reduces transition/animation duration.
- Zero items use the existing empty state; one item hides controls; two items show only the next preview; 10 items expose the full rank rail.
- Missing and invalid artwork falls back to its stable category-colored generated icon; the curated whitelist falls back to the ChipMate icon.

## Browser, Accessibility and Responsive QA

- Actual macOS Google Chrome console errors: `0`.
- Actual macOS Google Chrome console warnings: `0`.
- Automated Google Chrome Web E2E: `12/12` passed.
- axe WCAG 2/2.1/2.2 AA scan: `0` violations in both light and dark themes.
- Light and dark Liquid Glass surfaces, focus rings, hover, active, disabled and reduced-motion states passed.
- `1484 × 1060`: two translucent side previews; main card `1090 × 255`; horizontal page overflow `false`; title and description clipping `false`.
- `1440 × 1024`: two translucent side previews; horizontal page overflow `false`; title and description clipping `false`.
- `1050 × 1024`: only the next translucent preview; main card internal overflow `0`; horizontal page overflow `false`; title and description clipping `false`.
- The real directory screenshot contains one curated ChipMate icon plus nine distinct generated icons for the current Top 10, with no repeated icon inside a category in the preview dataset.
- Mobile visual matching is intentionally outside this iteration. The existing automated narrow-width no-overflow regression remains green but is not a mobile design sign-off.
- The existing Microsoft Edge branded run remains `USER_WAIVED / NOT_RUN`; this is not an Edge PASS claim.

## Visual Comparison History

1. Compared the selected source and implementation side by side at the same `1484 × 1060` viewport and first-rank state.
2. Confirmed the reference hierarchy is preserved: unchanged header and Hero, full-width glass ranking shell, adjacent-card reveal, dominant current card, blue/gold rank treatment and compact position controls.
3. Corrected the first Chrome mismatch pass: Hero/section vertical alignment, main-card dimensions, squeezed copy, rank position and desktop control spacing.
4. Corrected the second visual-feedback pass: the active card now layers `spatial-hero.webp` and `glass-field.webp` across the complete card with a readable left glass fade instead of a hard right-side image column.
5. Candidate cards now use a low-saturation glass field, `0.58` resting opacity, stronger inset refraction and a clearer hover transition so they read as pending slides rather than opaque independent cards.
6. Verified the intentional implementation additions required by the approved plan: real `01–10` rank rail, native progress, play/pause control and actual Skill data. The unchanged header retains its existing login control; the theme control is the leftmost item in the right navigation group.
7. Compared each generated icon family at 52, 74 and 96 pixel UI sizes. Pictograms remain legible, rounded-square crops are clean and category hue remains visible without losing glass refraction, edge highlights or depth.
8. Rechecked the active carousel at `1484`, `1440` and `1050` widths. The active card and both pending-card materials remain consistent with the reference; no open desktop P0, P1 or P2 visual findings remain.

## Performance Baseline

- Production entry JavaScript: `84.56 kB` gzip.
- Production CSS: `7.99 kB` gzip.
- Twenty generated Skill icons total `475718` bytes (`464.6 KiB`) after WebP conversion.
- Automated Chrome Web Vitals gates passed: LCP `≤ 2500ms`, INP `≤ 200ms`, CLS `≤ 0.1`.
- Main card hover animation sustained at least `55fps` in automated Chrome.
- All production chunks remain hashed; no new font or carousel dependency was added.

historical result: passed — superseded by the 2026-07-13 fullscreen review below

## Fullscreen Review Reopened — 2026-07-13

- Status: `REOPENED`
- Current result: `NOT_PASSED`
- Trigger: a new real macOS Google Chrome fullscreen screenshot exposed layout and material failures that were not covered by the earlier rank-01 comparison.
- Chrome source: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/01-user-fullscreen.png`
- Stable reference: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/02-reference.png`
- Full comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/03-full-comparison.png`
- Carousel comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/04-carousel-comparison.png`
- Execution ledger: `/Users/archer/Work/chipmate/server/chipmate-word-render/visual-alignment-plan.md`

### Open P1 Findings

1. `[closed by VA-05]` The active-card grid now protects the copy column from the recognizable decorative artwork at the long-title rank-03 state.
2. `[closed by VA-06]` The `已验证` pill now remains a compact horizontal label in a reserved title-row column and no longer overlaps the title.
3. `[closed by VA-06 and VA-07]` The title, two-line-limited description and metadata now retain separate compact rows without collision or wrapping the known Top 10 metadata.
4. `[closed by VA-07]` `查看技能` now stays visible on one stable bottom baseline and occupies the source's icon-aligned lower-left action area.
5. `[closed by VA-08]` The bottom control group now keeps previous/next, all ten ranks, progress/count and pause inside the visible container at every measured desktop width.
6. `[closed by VA-09]` The previous preview is now a clean glass edge, while the next preview uses the source's compact upper-left rank and lower-right Skill-icon composition without broken internal cropping.

### Open P2 Findings

1. `[closed by VA-11]` The spatial hero now matches the source scale, horizontal placement and bottom crop without entering the copy safe zone.
2. `[closed by VA-12 and VA-13]` The active card and outer shell now use separate source-aligned transmission fields: the active card retains environmental refraction, while the outer shell is a neutral white-blue glass layer without the former cyan floor.
3. `[closed by VA-14]` Pending previews now use a distinct half-transparent glass hierarchy with readable internal rank/icon content and separate hover/active depth treatments.
4. `[closed by VA-15, VA-17 and VA-19]` Rank and Skill-icon bases, active-card typography and every desktop interaction material now use the intended hierarchy in light, dark, hover, focus, pressed, paused, disabled and reduced-motion states.
5. `[closed by VA-16]` The runtime rank-03 card now demonstrably loads a development-family terminal icon; all ten live cards match their category mapping and only the curated rank-01 Skill retains the ChipMate mark.
6. `[closed by VA-18]` Header, logo and navigation controls now use a tighter desktop scale; the theme control remains the approved leftmost item and the retained login/publish controls no longer crowd the row.

### Evidence Limits

- The supplied fullscreen image is `2262×1406` physical pixels and originally lacked CSS viewport, DPR and Chrome zoom metadata. `VA-02` resolved that gap with the deterministic baseline below.
- The screenshot is at rank `#03` while the source visual is at rank `#01`; both states must be captured under identical Chrome metrics before final comparison.
- External pet and thinking-notification overlays contaminate the header and section-heading areas and must be absent from sign-off screenshots.
- Mobile visual matching remains outside scope. Microsoft Edge remains `USER_WAIVED / NOT_RUN`.

### Deterministic Real Chrome Baseline — VA-02

- Browser: the user's installed macOS Google Chrome controlled through the installed Chrome extension.
- Page zoom: reset with Chrome `Command+0`; `devicePixelRatio: 2` and `visualViewport.scale: 1` confirm the 100% Retina baseline.
- CSS viewport: `1131×616`; the clean Chrome viewport capture is also `1131×616` pixels.
- Original full-window image: `2262×1406` physical pixels. Its 2262-pixel content width maps to the 1131 CSS-pixel viewport at DPR 2; it must not be treated as a 2262 CSS-pixel layout.
- Theme/state: light theme, rank `#03 C/C++ Codebase Analysis`, autoplay paused by carousel focus, page scroll `341.5`, root scroll X `0`.
- Root document: `scrollWidth 1131`, `clientWidth 1131`, horizontal overflow `false`.
- Featured section: `clientWidth 1121`, `scrollWidth 1310`, internal hidden overflow `189px`, baseline `scrollLeft 0`.
- Active card: `787×255` at the 1131 CSS-pixel viewport; this is substantially narrower than the earlier 1090-pixel primary card.
- Detected displays: built-in Liquid Retina XDR `3024×1964` Retina; AirPlay display `2298×1604`, UI looks like `1149×802`.
- Clean baseline screenshot: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/chrome-real-baseline-1131x616-rank03.png`.
- External pet and thinking overlays are absent from the clean Chrome capture.

### All-rank Geometry Baseline — VA-03

- Geometry evidence: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/chrome-real-geometry-1131x560-all-ranks.json`.
- Live rank-03 capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/chrome-real-geometry-1131x560-rank03.png`.
- Method: sequentially switched all 10 ranks in the user's installed macOS Google Chrome while retaining a fixed `1131×560`, DPR 2, 100% zoom, light-theme content viewport and featured-section `scrollLeft 0`.
- The Chrome content viewport was 56px shorter when VA-03 reconnected than in the preserved VA-02 `1131×616` capture. Live DOM metrics, screenshot pixels and the `1131×703` outer-window bounds agree on the VA-03 size; the full ten-rank run used that one state, and the measured horizontal failures are driven by the unchanged 1131px CSS width.
- Active-card geometry is consistently `787×255`; every card has clipped vertical content, with scroll height `324px` for ranks `#02–#10` and `348px` for rank `#01`.
- Copy width is `224px` for every rank but needs `320–415px`; all 10 titles cross the copy safe boundary, and all 10 `已验证` labels wrap to approximately four lines.
- CTA exists in the DOM for all ranks but begins below the active-card bottom for all 10; rank `#01` also expands its description to three lines.
- Every previous preview is cropped at the section's left edge; every next preview extends beyond the right edge.
- The control rail is `1057px` wide but contains `1278px` of content, confirming `221px` of internal overflow on all ranks.
- Rank `#10 Repository Onboarding Guide` is the widest measured title; rank `#03 C/C++ Codebase Analysis` reproduces the same copy, verification-label and CTA failures.
- Live artwork mapping is current: rank `#03` uses `/assets/skill-icons/dev-terminal.webp`, while only whitelist rank `#01` uses `/assets/chipmate-icon.png`.
- These results map directly to `VA-04` through `VA-09`, `VA-11` and the later `VA-16` runtime revalidation. No visual finding is closed by this measurement task.

### Track and Active-card Proportion — VA-04

- Actual Chrome geometry: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/va04-chrome-real-geometry.json`.
- Live fullscreen-width capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/va04-chrome-real-1131x560-rank03.png`.
- Primary source-state capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/va04-chrome-real-1484x1060-rank01.png`.
- Same-input comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/va04-reference-vs-chrome-1484x1060-rank01.png`.
- Fix: the 1051–1399px desktop range now contracts its grid preview reservations, while the source-perfect 1484px track remains unchanged.
- At 1131px CSS width, the active card increased from `787×255` to `909×255`; previous and next previews now end inside the featured-section viewport.
- At `1484×1060`, the actual Chrome card is exactly `1090×255` at `x=136–1226`, matching the reference. The side-preview rectangles also retain the reference `x=0–66` and `x=1287–1484` composition.
- Root horizontal overflow is false at both measured widths. Chrome console errors and warnings are both zero.
- VA-04 closes the track/main-card proportion finding only. Copy/art separation, title/verification-label collision, CTA clipping, control overflow and preview material/internal cropping remain blocking findings for the following tasks.

### Copy and Artwork Safety Zone — VA-05

- Actual Chrome geometry: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/va05-chrome-real-geometry.json`.
- Live fullscreen-width capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/va05-chrome-real-1131x560-rank03.png`.
- Primary captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/va05-chrome-real-1484x1060-rank01.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/va05-chrome-real-1484x1060-rank03.png`.
- Same-input comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/va05-reference-vs-chrome-1484x1060-rank01.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/fullscreen-audit/va05-card-reference-vs-chrome-1484-rank01.png`.
- Fix: the existing `spatial-hero.webp` image is now an explicit third-column grid layer instead of part of the desktop card background. Rank and copy remain in normal-flow grid content above it; a measured mask removes the recognizable icon subject from the copy safety zone while retaining ambient glass light across the card.
- At the real `1131×560`, DPR 2 viewport, the title ends at `x=632.852`, verification at `x=694.852` and copy at `x=665`. The artwork mask stays transparent through `x=617`, reaches low opacity at `x=653`, strong opacity at `x=705` and full opacity at `x=742`; the actual Chrome screenshot shows no blue icon subject crossing the title, label, description or metadata.
- At `1484×1060`, the title and verification end at `x=695.852` and `x=781.852`, before the recognizable subject region. The active card remains exactly `1090×255` and the root has no horizontal overflow.
- Actual Chrome console errors and warnings remain zero. Web typecheck and production build passed.
- VA-05 closes only the copy/artwork separation finding. The wrapped verification label, content/CTA height, artwork scale/crop, card material and other listed P1/P2 findings remain open under VA-06 and later tasks.

### Title and Verification Label — VA-06

- Actual Chrome screenshot: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va06/chrome-real-1131x560-rank03-title-label.png`.
- Rank-03 geometry: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va06/chrome-real-1131x560-rank03-title-label.json`.
- Ten-rank geometry: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va06/chrome-real-1131x560-all-title-label-geometry.json`.
- Fix: the active-card title row now uses a normal-flow grid with a flexible title column and a compact `max-content` verification column. `已验证` cannot shrink or wrap; future longer names retain a two-line clamp.
- At the real `1131×560`, DPR 2 viewport, `#03 C/C++ Codebase Analysis` remains one line at `283×24.148px`. The `55×18px` label starts 8px later, stays inside the copy boundary and does not overlap the title.
- The same real Chrome run switched all 10 ranks individually. Maximum known title lines is one; all 10 labels remain horizontal and inside the copy column, all 10 title/label overlap checks are false and all 10 CTAs remain inside the active card.
- Actual Chrome console errors and warnings are zero. `npm run check` and `npm run build` passed.
- VA-06 closes the verification-label collapse and title collision finding only. Description, metadata and CTA spacing remain open under VA-07; final typography scale remains open under VA-17.

### Description, Metadata and CTA Flow — VA-07

- Native fullscreen screenshot: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va07/chrome-real-1131x560-rank03-content.png`.
- Native ten-rank geometry: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va07/chrome-real-1131x560-all-content-geometry.json`.
- 1050px ten-rank geometry: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va07/chrome-real-1050x1024-all-content-geometry.json`.
- Primary Chrome capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va07/chrome-real-1484x1060-rank01-content.png`.
- Full normalized same-input comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va07/reference-vs-chrome-1484x1060-rank01-content-normalized.jpg`.
- Focused active-card comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va07/card-reference-vs-chrome-1484-rank01-content-normalized.jpg`.
- Fix: the CTA is now a second normal-flow feature-content grid row instead of part of the copy column. The first desktop content row is fixed at 112px, descriptions clamp to two lines and the known metadata remains an unwrapped compact row.
- At the primary source size, the Skill icon and CTA both begin at `x=252`, while title, description and metadata begin at `x=377`. The description is one line, metadata is one line and the CTA ends 18px above the active-card bottom.
- In the real native-width ten-rank run, maximum description lines is two, metadata rows is one, every CTA is visible, every CTA aligns with its icon and copy/metadata overflow is false. The 1050px run repeats the same content results with at most a 2px icon/CTA left-edge difference.
- The temporary 1484px viewport capture contains a 104px top spacer from Chrome's viewport override surface. The normalized comparison removes that spacer without resizing the page and pads only the unavailable bottom area; the focused card comparison uses the measured `1090×255` DOM rectangles from both source and implementation.
- Actual Chrome console errors and warnings are zero. `npm run check` and `npm run build` passed.
- VA-07 closes description, metadata and CTA flow. Button scale/material and broader typography remain open under VA-17 and VA-19; the final QA result stays reopened.

### Bottom Control Containment — VA-08

- Geometry evidence: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va08/chrome-real-controls-geometry.json`.
- Native fullscreen capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va08/chrome-real-1131x560-rank03-controls.png`.
- Desktop breakpoint capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va08/chrome-real-1050x1024-rank03-controls.png`.
- Primary source-state capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va08/chrome-real-1484x1060-rank01-controls.png`.
- Same-input comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va08/chrome-reference-vs-current-1484x1060.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va08/chrome-reference-vs-current-controls.png`.
- Fix: replaced the fixed desktop control tracks with one normal-flow fluid grid that contracts its button, rank, gap, padding and progress tracks together. The progress count cannot wrap, and the approved pause control stays in its existing fifth column.
- At the real native `1131×560`, DPR 2 viewport, the control group changed from `1278px` of content inside `1057px` to `1057px` inside `1057px`; the featured section changed from `1310px` of content inside `1121px` to `1121px` inside `1121px`.
- The native, `1050×1024`, `1440×1024` and `1484×1060` installed-Chrome checks all keep every direct child inside the control rectangle, the ten-rank rail fully visible, and root horizontal overflow at zero.
- Actual Chrome console errors and warnings are zero. `npm run check` passed typecheck, lint and all 44 package tests; `npm run build` passed.
- VA-08 closes only control containment and overflow. Final control scale and Liquid Glass material remain open under VA-17 and VA-19; preview structure is now the only active VA-09 work, so the final QA result stays reopened.

### Adjacent Preview Structure — VA-09

- Geometry evidence: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va09/chrome-real-preview-geometry.json`.
- Native fullscreen capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va09/chrome-real-1131x560-rank03-preview.png`.
- Desktop breakpoint capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va09/chrome-real-1050x1024-rank01-preview.png`.
- Primary source-state capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va09/chrome-real-1484x1060-rank01-preview.png`.
- Same-input comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va09/chrome-reference-vs-current-1484x1060.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va09/chrome-reference-vs-current-previews.png`.
- Fix: the narrow previous preview no longer mounts ranking or icon children; it remains a named, clickable glass button. The next preview keeps its ranking and Skill icon in normal grid flow, arranged diagonally to match the selected source.
- Before VA-09, the native previous button had `112px` of internal content inside a `52px` client width, producing a clipped rank and half icon. After the fix it has zero children and `scrollWidth == clientWidth`.
- At `1484×1060`, the previous edge is exactly `x=0–66`; the next preview is `x=1287–1484`, its rank starts at `x=1310`, `y=715.5`, and its icon starts at `x=1404`, `y=754`. These positions match the source crop.
- Native, 1050px and 1440px checks keep the next rank fully visible and 91% of the icon visible as an intentional edge crop. Both actual-Chrome preview clicks switch the carousel successfully, and the root has no horizontal overflow.
- Actual Chrome console errors and warnings are zero. `npm run check` passed typecheck, lint and all 44 package tests; `npm run build` passed.
- VA-09 closes only preview structure and recognizability. Side arrows remain open under VA-10; preview opacity, refraction, depth and interaction material remain open under VA-14, so the final QA result stays reopened.

### Card-side Navigation — VA-10

- Geometry evidence: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va10/chrome-real-arrow-geometry.json`.
- Primary source-state capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va10/chrome-real-1484x1060-rank01-arrows.png`.
- Same-input comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va10/chrome-reference-vs-current-1484x1060.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va10/chrome-reference-vs-current-arrows.png`.
- Fix: added previous and next Phosphor caret buttons as co-located items in the existing carousel grid. They reuse the same `shift` behavior as the bottom controls and stay in normal layout flow; no arrow uses `position: absolute`.
- At `1484×1060`, the main card remains `1090×255`; the left button occupies `x=78.98–122.98` and the right button `x=1239–1283`, matching the source gaps on both sides of the `x=136–1226` active card.
- At native `1131×560`, 1050px and 1440px desktop widths, the arrows do not create root overflow or cover card copy. The 1050px layout intentionally hides the previous edge and its arrow together, while preserving the next arrow and preview.
- Both actual-Chrome card-side clicks switch the selected Skill (`01 → 02 → 01`), and the original bottom previous/next controls remain present. Actual Chrome console errors and warnings are zero; `npm run check` and `npm run build` passed.
- VA-10 closes only side-arrow structure, geometry and behavior. Artwork size/crop remains open under VA-11; arrow and control material polish remains open under VA-19, so the final QA result stays reopened.

### Active-card Artwork Scale and Crop — VA-11

- Geometry evidence: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11/chrome-real-artwork-geometry.json`.
- Primary source-state capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11/chrome-real-1484x1060-rank01-artwork.png`.
- Additional installed-Chrome captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11/chrome-real-1050x1024-rank01-artwork.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11/chrome-real-1131x560-rank01-artwork.png`.
- Same-input comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11/chrome-reference-vs-current-1484x1060.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11/chrome-reference-vs-current-artwork.png`.
- Fix: retained the supplied `spatial-hero.webp`, but reduced its desktop normal-flow slot to `440–520px`, moved its crop farther right and centered it vertically. The 761–1050px desktop background representation now uses a smaller right-extended crop so it cannot cover the verification label.
- At `1484×1060`, the main spatial subject measures `221.22px` wide at `x=921.59–1142.81`, bottom `899.41`; the source subject is approximately `x=923–1140`, bottom `900`. The copy-to-subject gap is `51.43px`, and the focused same-input comparison shows matching scale, placement and bottom crop.
- The 1440px, native 1131px and 1050px installed-Chrome checks preserve positive copy/label gaps, the circular platform across the right field, and zero root horizontal overflow. The mobile layout was not modified or visually assessed.
- Actual Chrome console errors and warnings are zero; `npm run check` passed typecheck, lint and all 44 package tests; `npm run build` passed.
- VA-11 closes artwork scale, placement, crop and copy safety only. The main-card glass opacity, refraction, blur, highlight, boundary and shadow remain open under VA-12, so the final QA result stays reopened.

### Active-card Glass Material — VA-12

- Evidence manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va12/chrome-material-evidence.json`.
- Color sampling: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va12/material-color-stats.json`.
- Primary light capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va12/chrome-real-1484x1060-rank01-light-card.png`.
- Additional installed-Chrome captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va12/chrome-real-1440x1024-rank01-light-card.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va12/chrome-real-1050x1024-rank01-light-card.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va12/chrome-real-1484x1060-rank01-dark-card.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va12/chrome-real-1131x560-rank01-light-card.png`.
- Same-input comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va12/chrome-reference-vs-current-1484x1060.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va12/chrome-reference-vs-current-light-card.png`.
- Fix: removed the desktop active card's opaque `glass-field.webp` surface layer and replaced it with two low-opacity gradients over the existing section light field. The supplied spatial art remains in its VA-11 normal-flow slot; no asset, font, dependency or absolute-positioned control was added.
- The light material now uses a `30px` backdrop blur with restrained saturation/brightness, an `rgba(255,255,255,.88)` fine boundary, two exterior shadows and four inset layers for top highlight, lower refraction, side glint and diffuse depth. The dark theme has a separate lower-luminance surface treatment and remains readable.
- Before the final tuning, the lower-left source/current mean RGB values were approximately `236/243/251` versus `244/249/255`. The final installed-Chrome capture is approximately `236/243/251` versus `240/247/253`, reducing the absolute channel gap from about `8/7/4` to `4/5/3`. The mid-card gap is approximately `1/4/2`.
- At the primary source state the active card remains `1090×255`. The 1440px, 1050px and native `1131×560`, DPR 2 installed-Chrome checks retain the established card/content structure with no visible root overflow or copy/art collision.
- The handoff state is restored to the native viewport at rank `#03`, light theme, paused autoplay and the Top 10 scroll position. Actual Chrome console errors and warnings are both zero; `npm run check` and `npm run build` passed.
- VA-12 closes only the active-card surface material. Outer-shell color and density remain open under VA-13, preview material under VA-14, and typography/control interaction polish under VA-17–VA-19; the final QA result therefore stays reopened.

### Outer Carousel Glass Material — VA-13

- Evidence manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va13/chrome-shell-evidence.json`.
- Color summary: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va13/outer-shell-color-summary.json`.
- Primary light capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va13/chrome-real-1484x1060-rank01-light-shell.png`.
- Additional installed-Chrome captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va13/chrome-real-1440x1024-rank01-light-shell.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va13/chrome-real-1050x1024-rank01-light-shell.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va13/chrome-real-1484x1060-rank01-dark-shell.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va13/chrome-real-1131x560-rank01-light-shell.png`.
- Same-input comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va13/chrome-reference-vs-current-1484x1060.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va13/chrome-reference-vs-current-shell.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va13/chrome-reference-before-after-shell.png`.
- Fix: replaced the desktop outer shell's saturated white-to-cyan overlay with a low-opacity horizontal neutral transmission gradient and a minimal vertical depth layer. The surface now uses `32px` blur at `100%` backdrop saturation, a fine `rgba(255,255,255,.82)` boundary, restrained exterior elevation, and distinct top, lower and diffuse inset refraction layers.
- The stable right-header sample moved from chroma `31.02` before the fix to `19.91`; the source is `19.43`. Its absolute chroma gap dropped from `11.59` to `0.48`. Center-header luma gap dropped from `4.79` to `0.97`, and the lower blank-strip luma gap from `2.18` to `0.34`.
- The focused source/current comparison shows the carousel field now retaining the design's neutral white-blue transparency and right-side environmental light without the previous dense cyan lower fill. Active-card and preview-card surfaces remain independent layers.
- The explicit dark theme uses a neutral slate-glass counterpart. At `1484×1060`, `1440×1024`, `1050×1024` and native `1131×560`, DPR 2, the established geometry remains intact and the root reports `scrollWidth == clientWidth`; mobile was not visually assessed.
- The handoff state is restored to the native viewport at rank `#03`, light theme, paused autoplay and scroll Y `489`. Actual Chrome console errors and warnings are both zero; `npm run check` and `npm run build` passed.
- VA-13 closes only the outer carousel-shell material. Preview transparency and depth remain open under VA-14, rank/icon base scale under VA-15, and typography/control interaction polish under VA-17–VA-19; the final QA result therefore stays reopened.

### Pending Preview Glass Material — VA-14

- Evidence manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va14/chrome-preview-evidence.json`.
- Color sampling: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va14/preview-material-color-stats.json`.
- Primary light capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va14/chrome-real-1484x1060-rank01-light-preview.png`.
- Interaction capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va14/chrome-real-1484x1060-rank01-light-preview-hover.png`.
- Additional installed-Chrome captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va14/chrome-real-1440x1024-rank01-light-preview.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va14/chrome-real-1050x1024-rank01-light-preview.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va14/chrome-real-1484x1060-rank01-dark-preview.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va14/chrome-real-1131x560-rank03-handoff.png`.
- Same-input comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va14/reference-before-after-previews.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va14/reference-vs-current-next-preview.png`.
- Fix: increased the pending surface from the former whole-card `0.58` washout to a controlled `0.82` transmission layer, kept identifying artwork separately at `0.88`, replaced the white-heavy overlay with a pale-blue field, and added explicit blur, refraction, highlight, boundary and depth layers. No preview geometry or asset changed.
- The sampled panel chroma improved from `15.03` to `23.17` against the source's `30.99`; rank chroma improved from `19.90` to `29.42` against `34.48`; icon chroma improved from `40.42` to `59.66` against `76.03`. The focused comparison now preserves a visibly pending glass surface without erasing the rank or category artwork.
- Hover raises the surface by `3px`, lifts its opacity to `0.96`, and increases the icon from `0.88` to `0.98`; the active state adds a slight press and stronger contrast. A live next-preview click changed the selected rank from `01` to `02`, confirming the material changes did not break the existing interaction.
- The distinct dark material remains legible. At `1484×1060`, `1440×1024`, `1050×1024` and native `1131×560`, DPR 2, the page has no root horizontal overflow and the established preview tracks remain unchanged.
- The handoff state is restored to the native viewport at rank `#03`, light theme, paused autoplay and scroll Y `489.5`. Actual Chrome console errors and warnings are both zero; `npm run check` and `npm run build` passed.
- VA-14 closes only pending-preview saturation, transparency, blur, refraction, depth, hover and active material. Badge and Skill-icon base dimensions remain open under VA-15; the final QA result therefore stays reopened.

### Rank Badge and Skill Icon Base — VA-15

- Evidence manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15/chrome-badge-icon-evidence.json`.
- Saturated component bounds: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15/rank-icon-saturated-bounds.json`.
- Primary light capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15/chrome-real-1484x1060-rank01-light-badge-icon.png`.
- Additional installed-Chrome captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15/chrome-real-1440x1024-rank01-light-badge-icon.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15/chrome-real-1050x1024-rank01-light-badge-icon.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15/chrome-real-1484x1060-rank01-dark-badge-icon.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15/chrome-real-1131x560-rank03-handoff.png`.
- Same-input comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15/reference-before-after-rank-icon.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15/reference-vs-current-rank-icon.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15/reference-vs-current-card-left.png`.
- Fix: replaced the plain active badge with a curved shield using a separate `3px` gold rim and inset blue body. Added a dedicated frosted glass base around the Skill artwork with a fine edge, environmental transmission, blur, inset light and restrained elevation. All badge text, icon and verification-seal alignment stays in normal-flow CSS grids.
- At `1484×1060`, the DOM badge is `84×98` and the icon base is `114×114` around a `104×104` image. High-chroma bounds put the current badge at `86×98` versus the source's `90×98`, and the current icon at `94×94` versus the source's `92×93`. The previous icon core was only `85×86`.
- Increasing the undersized icon base did not move the text: the content grid now uses a `114px` icon column and an `11px` gap, preserving the prior `125px` combined rhythm and the rank-01 title start at `x=382`. The 1050px desktop state keeps a compact `70×86` badge and `72×72` icon base.
- The explicit light and effective dark captures remain legible. The 1484px, 1440px, 1050px and native `1131×560`, DPR 2 checks all report zero root horizontal overflow, and the real Chrome console has zero warnings and zero errors.
- `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. No backend, API, database, production Skill data, asset, font or dependency changed.
- VA-15 closes only the active rank badge and Skill-icon base scale, edge proportion, glass thickness and visual weight. The rank-03 category-icon runtime proof remains open under VA-16, and typography/control sizing remains open under VA-17 and VA-19; the final QA result therefore stays reopened.

### Category Icon Runtime State — VA-16

- Evidence manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va16/chrome-category-icon-evidence.json`.
- Primary installed-Chrome captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va16/chrome-real-1484x1060-rank01.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va16/chrome-real-1484x1060-rank03.png`.
- Focused runtime comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va16/chrome-real-chipmate-vs-development.png`.
- Native handoff capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va16/chrome-real-1131x560-rank03-handoff.png`.
- The live download-sorted API returned ten rows. Each rank was selected in the user's installed macOS Google Chrome, and the active image `src`, resolved `currentSrc`, natural dimensions, completion state, active-card label and root overflow were recorded after every switch.
- Rank `#03 C/C++ Codebase Analysis` loads `/assets/skill-icons/dev-terminal.webp` at `512×512`; it does not use the ChipMate mark. Rank `#01 source-backed-detail-design` is the only card whose final runtime source is `/assets/chipmate-icon.png`.
- The remaining cards resolve to category-matching `dev-*`, `test-*` and `ops-*` files. Rank `#02` also proves the browser error path: its deliberately missing author artwork is replaced at runtime by `/assets/skill-icons/dev-architecture.webp`.
- Every final asset returned HTTP `200`, every image completed with non-zero natural dimensions, every rank retained zero root overflow, and the real Chrome console reported zero warnings and zero errors.
- Source, service, API and actual Chrome were already aligned, so no cache reset, seed rewrite, production-data change or code edit was necessary. `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed.
- VA-16 closes only the classification-icon runtime finding. Typography/spacing, Header proportion and interaction-material findings remain open under VA-17–VA-19, so the final QA result remains reopened.

### Featured Typography and Internal Rhythm — VA-17

- Primary installed-Chrome rank-01 capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va17/chrome-real-1484x1060-rank01-light.png`.
- Long-title captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va17/chrome-real-1484x1060-rank03-light-fullpage.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va17/chrome-real-1440x1024-rank03-light-fullpage.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va17/chrome-real-1050x1024-rank03-light-fullpage.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va17/chrome-real-native-rank03-light-handoff.png`.
- Dark-theme capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va17/chrome-real-1484x1060-rank03-dark-fullpage.png`.
- Same-input comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va17/reference-vs-after-full-1484x1060.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va17/reference-vs-after-card-1484x1060.png`.
- The featured heading is now `31px/680`; the wide-desktop Skill title is `26px/680`, while the `1051–1399px` desktop range scales it to `21px` at the native `1131px` viewport. Rank `#03 C/C++ Codebase Analysis` stays on one line with a non-overlapping verification label in every measured desktop state.
- Description, metadata and CTA now follow the source's vertical sequence. Metadata keeps real download values but uses lower-contrast auxiliary styling; the CTA is `134×44px` and remains fully inside the fixed `255px` card.
- The same-input comparison confirmed that `1090×255` card geometry, `18px` card padding and `30px` card radius were already aligned and were therefore preserved. The outer shell now uses a `32px` top radius and enough bottom padding to meet the source viewport baseline.
- `1484×1060`, `1440×1024`, `1050×1024` and native `1131×560`, DPR 2, states retain zero root overflow. The real Chrome console contains zero warnings and zero errors; `npm run check` passed all 44 tests and `npm run build` passed.
- VA-17 closes the active-card typography, copy spacing, auxiliary-weight, CTA proportion and section-height findings only. Header proportion remains open under VA-18 and interaction-state material under VA-19, so the final QA result remains reopened.

### Header and Navigation Proportion — VA-18

- Evidence manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va18/header-geometry-evidence.json`.
- Primary light capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va18/02-real-chrome-after-1484x1060.png`.
- Additional installed-Chrome captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va18/06-real-chrome-light-1440x1024-full.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va18/07-real-chrome-light-1050x1024-full.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va18/08-real-chrome-dark-1484x1060-full.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va18/09-real-chrome-native-light-rank03-full.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va18/10-real-chrome-native-light-rank03-handoff.png`.
- Same-input comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va18/03-reference-vs-after-header.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va18/04-reference-vs-after-full.png`.
- The desktop top bar is now `100px` high, with a `54px` logo, `22px` brand title, `12px` subtitle, `42px` navigation controls, `18px` icons and `8px` navigation gaps. The theme button remains first in the right-side group, followed by catalog, service status, login and publish.
- The selected source omits theme and login, but those controls are confirmed product differences. Tightening the complete five-control row removes the former crowding without deleting functionality or changing its order.
- The trust line absorbs the Header's `10px` reduction so their combined height remains `154px`. At `1484×1060`, the Hero still starts at `y=154`, the featured shell at `y=589` and the `1090×255` active card at `y=696.695`; VA-18 therefore does not regress the established source alignment below the Header.
- `1484×1060`, `1440×1024`, `1050×1024` and native `1131×560`, DPR 2, installed-Chrome states keep the navigation on one row and report zero root horizontal overflow. Light and effective-dark geometry is identical; the real Chrome console has zero warnings and zero errors. The final handoff restores rank `#03`, light theme, paused autoplay and scroll Y `489`.
- `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. VA-18 closes Header and navigation proportion only. Component interaction material remains open under VA-19, so the final QA result remains reopened.

### Component Interaction Materials — VA-19

- Evidence manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19/interaction-material-evidence.json`.
- State matrices: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19/10-carousel-state-matrix.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19/11-header-state-matrix.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19/12-cta-normal-hover.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19/13-preview-state-matrix.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19/15-running-vs-paused.png`.
- Native handoff capture: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19/16-real-chrome-native-light-rank03-handoff.png`.
- Header buttons, side and bottom carousel arrows, rank controls and pause control now use one desktop Liquid Glass state system with transmitted gradients, `18px` blur, fine boundaries, inset top/bottom refraction, restrained elevation and distinct hover/pressed depth. The effective dark theme uses a lower-brightness counterpart rather than reusing the light surface.
- The selected rank stays the strongest blue layer. The paused state is visibly blue-tinted and inset around the Play icon, while the running state returns to the neutral Pause control. The progress track is an inset glass channel; the verified label and CTA each have their own scale-appropriate surface and hover/pressed response.
- Keyboard focus is a visible `3px` ring plus a stronger component edge. Disabled controls use a muted low-saturation glass surface. Under reduced motion, autoplay and its control are disabled, transitions are at most `.001s`, the slide entrance animation is removed and all desktop hover/press translations are forced to none.
- Real Chrome light, dark, hover and keyboard-focus captures retain zero root overflow. The real Chrome console has zero warnings and zero errors. The targeted reduced-motion Chrome E2E passed; `npm run check` passed all 44 package tests and `npm run build` passed.
- The targeted E2E exposed a destructive preview-seed cleanup of `.runtime`. `seed-preview.ts` now removes only its owned E2E directories, and a direct rerun preserved both VA-18 and VA-19 evidence. Historical captures removed by the pre-fix run are not treated as current sign-off evidence; VA-22/VA-23 must create the complete authoritative final set before this QA can pass.
- VA-19 closes desktop interaction material and reduced-motion presentation. Geometry regression and final desktop sign-off remain open under VA-20–VA-24, so the final QA result remains reopened.

### Desktop Geometry Regression — VA-20

- Real Chrome geometry manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va20/chrome-real-all-ranks-geometry.json`.
- Installed-Chrome rank-03 captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va20/1484x1060-rank03-real-chrome.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va20/1440x1024-rank03-real-chrome.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va20/1131x560-rank03-real-chrome.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va20/1050x1024-rank03-real-chrome.png`.
- The real-data E2E and the user's installed macOS Google Chrome both traverse all ten Top 10 cards at four desktop viewports. All `40 / 40` states keep active-card content, CTA, control-strip children and all rank buttons inside their containers; title and verification label never overlap; the root has no horizontal overflow.
- Rank `#01` retains the approved ChipMate icon, while ranks `#02`–`#10` resolve to category assets. Rank `#03` resolves to `/assets/skill-icons/dev-terminal.webp` in the installed Chrome.
- A `1px` metadata overflow tolerance accounts only for Chrome's integer rounding of a measured `16.898px` line box to `clientHeight=17 / scrollHeight=18`; the metadata bounding box remains inside the active card and the horizontal check retains no tolerance beyond one device-independent pixel.
- The targeted Chrome E2E passed; `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. Playwright is recorded only as functional and geometry proof. Authoritative screenshot and component-level visual sign-off remain open under VA-22/VA-23, so the final QA result remains reopened.

### Full Functional Regression — VA-21

- Real Chrome smoke manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va21/real-chrome-functional-smoke.json`.
- Real Chrome handoff: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va21/real-chrome-native-functional-smoke.png`.
- The first full E2E run exposed three failures: two substring accessible-name locators collided with the new card-side arrows, and one INP sample measured `248ms`. The bottom-control locators now use exact accessible names; the INP threshold remains unchanged at `200ms` because three isolated repetitions and the next complete run passed it.
- Final Chrome E2E result: `13 passed / 0 failed`. Final `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests. Final `npm run build` passed all workspace builds. Edge remains `USER_WAIVED / NOT_RUN`.
- The installed-Chrome smoke state is native `1131×560`, DPR 2, scale 1, rank `#03`, light theme, paused autoplay and zero console warnings/errors. Playwright results are functional, geometry, accessibility and performance evidence only; VA-22 and VA-23 still own authoritative visual sign-off, so the final QA result remains reopened.

### Authoritative Desktop State Captures — VA-22

- State manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va22/real-chrome-desktop-state-manifest.json`.
- Source-size captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va22/1484x1060-rank01-light-paused-top.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va22/1484x1060-rank03-light-paused-top.png`.
- Additional desktop captures cover rank `#01` and rank `#03` at `1440×1024`, `1050×1024` and native `1131×560`, plus a native rank-03 carousel-focus state at scroll Y `489`. All were captured from the user's installed macOS Google Chrome, not Playwright.
- Every state is light theme, paused autoplay, free of root horizontal overflow and free of real-Chrome console warnings/errors. At source size the entire active carousel and control row remain visible; rank `#03` stays one line and loads its development category icon.
- The rejected first 1050px captures showed a contradictory below-1024px notice. The notice now hides at widths `>=1024px` while the established 1050px responsive carousel remains unchanged; corrected screenshots replaced those captures. `npm run check`, `npm run build`, the targeted all-card geometry test and the narrow-width test pass after this correction.
- VA-22 establishes the authoritative state set but does not self-approve visual material. Component-level same-input comparison remains open under VA-23, so the final QA result remains reopened.

### Reopened Rank Badge and Skill Icon — VA-15

- Source/current badge comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15-reopened/02-rank-badge-reference-left-current-right.png`.
- Source/current Skill-icon comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va15-reopened/03-skill-icon-reference-left-current-right.png`.
- The rank badge is now `84×94`, with a thicker low-saturation gold rim, lighter slate-blue transmitted glass, inset refraction and a restrained shadow. The redundant yellow CheckCircle has been removed from the clean `114×114` Skill-icon base; verification remains in the title row.
- Real Chrome reports no root overflow. `npm run check`, `npm run build` and the 40-state desktop geometry test pass. VA-15 is reclosed with no open badge/icon P2; VA-17 and VA-19 remain reopened and VA-23 remains paused, so the final QA result remains reopened.

### Reopened CTA Proportion — VA-17

- Source/current CTA comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va17-reopened/02-cta-reference-left-current-right.png`.
- Real Chrome evidence: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va17-reopened/cta-evidence.json`.
- The CTA now matches the source-measured `145×44` span at `1484×1060` and retains the same `145×44` component at `1050×1024`. It remains fully inside the active card for rank `#01` and long-title rank `#03`, with no root overflow.
- `npm run check`, `npm run build` and the 40-state desktop geometry test pass. VA-17 is reclosed with no open CTA P2.
- The user's subsequent requirement that the large card visual use each Skill's resolved icon reopens VA-16 and VA-11. Those tasks, VA-19, VA-23 and VA-24 remain open, so the final QA result remains reopened.

### Reopened Artwork Source Mapping — VA-16

- Real Chrome source map: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va16-reopened/skill-artwork-source-map.json`.
- Installed-Chrome source states: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va16-reopened/01-real-chrome-1484x1060-rank01-mapping.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va16-reopened/02-real-chrome-1484x1060-rank02-mapping.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va16-reopened/03-real-chrome-1484x1060-rank03-mapping.png`.
- All ten live cards now use one resolved source for the small Skill mark and large active-card artwork. Real Chrome reports `10 / 10` pairs loaded and equal; only rank `#01` uses ChipMate, while every other rank uses its category artwork.
- The active large artwork is eager rather than lazy so damaged author artwork falls back in the same frame even when the card starts below the viewport. The 40-state geometry/source-equality E2E passes; `npm run check` and `npm run build` pass.
- VA-16 is reclosed for source mapping. Raw square icons are still clipped by the former spatial-hero crop; VA-11 is reopened for composition and material tuning, so the final QA result remains reopened.

### Reopened Skill Artwork Composition — VA-11

- Real Chrome composition manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11-reopened/skill-artwork-composition-evidence.json`.
- Source-size states: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11-reopened/02-real-chrome-1484x1060-rank01.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11-reopened/03-real-chrome-1484x1060-rank02.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11-reopened/04-real-chrome-1484x1060-rank03.png`.
- Native focused states: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11-reopened/08-real-chrome-1131x560-rank02.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va11-reopened/09-real-chrome-1131x560-rank03.png`.
- The large visual is now the complete resolved Skill icon rather than a stretched crop or fixed ChipMate hero. It measures `219×219` at 1484px, `167.38×167.38` at native 1131px and `155.40×155.40` at 1050px, with a scale-dependent radius, restrained saturation, fine glass boundary and lightweight depth shadow.
- Rank `#01` remains ChipMate; rank `#02` uses architecture in both slots; rank `#03` uses terminal in both slots. The fixed ChipMate background is removed from the 761–1050px desktop card. All captured states keep art and copy separate and report no root overflow.
- The strengthened 40-state geometry/artwork test, `npm run check` and `npm run build` pass. VA-11 is reclosed; VA-19, VA-23 and VA-24 remain open, so the final QA result remains reopened.

### Reopened Verification Hierarchy — VA-19

- Real Chrome evidence: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19-reopened/interaction-evidence.json`.
- Installed-Chrome captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19-reopened/01-real-chrome-1484x1060-rank01.jpg`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19-reopened/02-real-chrome-1484x1060-rank03.jpg` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19-reopened/03-real-chrome-1484x1060-rank03-dark.jpg`.
- Same-input verification comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va19-reopened/04-verified-label-reference-left-current-right.png`.
- The active verification state now matches the selected source hierarchy: a compact filled blue Phosphor seal plus inline text, with no extra frosted pill background, border, blur or inset shadow. Shared verification pills outside the featured card are intentionally unchanged.
- Rank `#01` and long-title rank `#03` stay on one line. Real Chrome reports no title/label or title/artwork overlap and no root horizontal overflow. Light and effective-dark labels use dedicated blue values without introducing another surface layer.
- `npm run check`, `npm run build`, the 40-state desktop geometry/artwork test and the keyboard/reduced-motion E2E pass. VA-19 is reclosed; VA-23 resumes and VA-24 remains open, so the final QA result remains reopened.

### Final Component Same-input Audit — VA-23

- Audit manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va23-current/component-audit-evidence.json`.
- Full comparison: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va23-current/01-full-page-reference-left-current-right.png`.
- Component comparisons: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va23-current/02-header-reference-left-current-right.png` through `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va23-current/12-progress-reference-left-current-right.png`.
- Per-Skill large-art evidence: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va23-current/15-rank01-02-03-active-card-artwork.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va23-current/16-rank01-02-03-large-skill-artwork.png`.
- A new unfocused rank-01 real-Chrome baseline replaced every stale current-side crop. Header, shell, card, previews, badge, small icon, verification state, CTA, rank rail and progress were each reviewed beside the selected source at original scale.
- Rank `#01`, `#02` and `#03` visibly use different large artwork matching their small Skill marks. The source's fixed spatial platform is intentionally replaced by the user's per-Skill artwork rule; the retained Header theme/login controls remain an approved product difference.
- No open P0, P1 or P2 remains in this gate. VA-23 is complete; final full regression, current-console/axe/overflow verification and real-Chrome handoff remain under VA-24, so the final QA result remains reopened.

### Final Desktop Sign-off — VA-24

- Final manifest: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va24-final/final-signoff-evidence.json`.
- Source-size installed-Chrome captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va24-final/01-real-chrome-1484x1060-rank01-light.jpg`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va24-final/02-real-chrome-1484x1060-rank03-light.jpg` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va24-final/03-real-chrome-1484x1060-rank03-dark.jpg`.
- Additional desktop captures: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va24-final/04-real-chrome-1440x1024-rank03-light.jpg`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va24-final/05-real-chrome-1050x1024-rank03-light.jpg` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/va24-final/07-real-chrome-native-rank03-carousel.jpg`.
- The clean final installed-Chrome tab reports zero warnings/errors. Every final state has zero root overflow; rank `#03` has no title/verification or title/artwork overlap; the native `1131×560`, DPR 2, scale 1 carousel keeps its complete control row visible at scroll Y `489`.
- `npm run check` passes generated-contract validation, typecheck, lint and all 44 package tests. `npm run build` passes. The first complete Chrome E2E run recorded one `296ms` INP outlier with the other 12 tests passing; three isolated reruns passed without changing the `200ms` gate, followed by a final complete `13 / 13` pass including axe, performance, geometry, interaction and journey coverage.
- All P0/P1/P2 findings are closed. Mobile remains intentionally out of scope and Edge remains `USER_WAIVED / NOT_RUN`.

No P0 crash or unusable-page failure is visible. No open P1/P2 remains in the final desktop evidence.

### Extension Batch Upload and Capability Cache — G9

- Installed macOS Google Chrome captured the review, active batch progress and idle states at `1484×1060`, `1440×1024` and `1050×1024`.
- Evidence: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/evidence/extension-market/08-extension-upload-review-1484x1060.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/evidence/extension-market/09-extension-upload-progress-1484x1060.png`, `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/evidence/extension-market/extension-upload-idle-1440x1024.png` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/evidence/extension-market/extension-upload-idle-1050x1024.png`.
- The upload page keeps the approved Liquid Glass hierarchy, an immediately visible batch progress surface, normal-flow icons and controls, readable review rows, and no root overflow or obscured actions at the accepted desktop widths.
- The visual capture test passed in installed Chrome. Targeted batch-network and axe coverage passed after removing the nested complementary landmark. `npm run check` passed all 64 package tests and `npm run build` passed.
- No P0, P1 or P2 is open for G9. Mobile and legacy browsers remain out of scope; archive inputs are browser-local and only selected VSIX bytes cross the publication boundary.

final result: passed

### Skill Publication Terminal States — G10

- Functional Chrome E2E covers the published, unchanged, retry/double-submit and mixed error-plus-20-script-warning states. The full repository `npm run check` gate passes.
- Installed macOS Google Chrome opened the local publish page at `1484×1060` and completed the local QA login. The archive chooser then lost extension control before bytes were selected, so no authoritative terminal-state screenshot was produced.
- The required `1484×1060`, `1440×1024` and `1050×1024` success, failure and warning-state visual captures remain `BLOCKED / UNVERIFIED`. Playwright results are functional evidence only and are not treated as installed-Chrome visual sign-off.

### Skill Risk Warning Precision — G11

- The installed macOS Google Chrome opened the local `skill-risk-v3` publish page at `1484×1060`, completed the local QA login and opened the archive chooser.
- The Chrome extension rejected local archive injection before upload, so the 20-script, placeholder-credential and high-confidence-credential terminal states could not be captured. The required `1484×1060`, `1440×1024` and `1050×1024` visual evidence remains `BLOCKED / UNVERIFIED`.
- Functional Chrome E2E verifies one warning category for 20 expandable script paths and the updated risk-category wording. `npm run check` passes generated-contract validation, typecheck, lint and all package tests. Playwright evidence is not treated as installed-Chrome visual certification.

### Extension Analytics Download Trend — G12

- The user-provided production-shaped series `2 / 1 / 17 / 3` was reproduced against the local analytics API with a total of `23`. The Web view now renders a continuous UTC 30-day series with zero-filled missing dates and normalized nonzero heights of `11.7647% / 8% / 100% / 17.6471%`.
- Installed macOS Google Chrome evidence: `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/evidence/extension-market/10-extension-analytics-trend-1484x1060.jpg` and `/Users/archer/Work/chipmate/server/chipmate-word-render/.runtime/design-qa/evidence/extension-market/11-extension-analytics-trend-1050x1024.jpg`.
- Both accepted desktop widths have zero root overflow. The chart fills its glass panel, keeps dates and the 30-day total readable, and reports zero Chrome console warnings/errors. No P0, P1 or P2 remains for G12.
- `npm run check` passes generated-contract validation, typecheck, lint and all 98 package tests. The Chrome E2E project passes all 28 tests; the combined Chrome/Edge command cannot start Edge because Microsoft Edge is not installed on this Mac, so Edge remains `UNVERIFIED` rather than a product failure.

### Server 本地管理员授权 — 2026-09-04

- 范围：管理员导航、直接访问守卫、独立应急登录、管理员查询与确认授权、名单及最后管理员保护、会话失效清除；沿用现有玻璃面板、按钮和正常文档流布局。未提供新的视觉参考图，不宣称完成参考图逐组件比对。
- 功能自动化：真实安装 Chrome 的 Playwright 项目通过 6 项认证测试，包含伪造前端标记、配置测试、明确授权、失效清除、应急退出和设备授权。无障碍检查及 `1484×1060`、`1440×1024`、`1050×1024` 无横向溢出断言通过；这些结果不代替视觉截图签收。
- 后端验证：管理员、认证和 LDAP 协议目标测试共 28 项通过；覆盖 v10→v11 空管理员名单迁移、同名不同 GUID、角色独立于市场账号映射、旧 Web／设备凭据撤销、并发撤权、事务内重验授权者及轮询后撤权的发证竞态。构建、类型检查、Lint、生成契约检查通过。
- 全套测试仍存在 `apps/api/test/sqlite-legacy.test.ts` 中旧 Skill 归档安装用例失败，不能把全套测试标记为通过。扩展生成契约目标单测通过；扩展全量单测命令因范围参数解析扩大，被停止，不作为本轮通过证据。
- 原生视觉尝试：本机 Google Chrome 原生窗口进入本地隔离测试 Server，完成测试 break-glass 登录，页面读取到管理员管理和 LDAP 配置。测试目录和凭据均为合成数据，未连接真实 AD，未授权真实用户。
- 阻塞：Chrome 扩展控制返回 `Browser is not available: chrome`；改用原生窗口后，固定尺寸操作遇到剪贴板超时，随后 ScreenCaptureKit 连续返回 `SCStreamErrorDomain -3812`。未取得三种规定视口的有效截图，未保存凭据截图；不使用 Playwright 截图替代。
- 容器与组件视觉状态：面板材质、确认卡、长 GUID／账号 ID 换行、名单行、按钮状态和三尺寸完整视觉仍为未验证；真实 AD、目标服务器部署与人工效率指标也未验证。
- 本轮视觉结论：阻塞／未验证；此前各项历史签收不代表本轮管理员页面已经视觉通过。
