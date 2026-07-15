# G7 Review

Status: `PASS — CODE_AND_COMPONENT_RUNTIME_SCOPE`

## Changed Files

- `server/chipmate-word-render/packages/contracts/src/openapi.ts` and generated OpenAPI/Web/Kilo clients.
- `server/chipmate-word-render/packages/market-db/src/{client,protocol,repo,worker}.ts` and DB tests.
- `server/chipmate-word-render/apps/api/src/aligned.ts` and API integration tests.
- `packages/kilo-vscode/src/MarketplacePanelProvider.ts`.
- `packages/kilo-vscode/src/services/marketplace/{api,index,types}.ts` and Marketplace API/architecture tests.
- `packages/kilo-vscode/webview-ui/src/components/marketplace/{AlignedSkillMarket,ItemCard,MarketplaceListView,MarketplaceView,marketplace.css}`.
- Marketplace extension/webview message types and dedicated marketplace entrypoint.
- `packages/kilo-vscode/webview-ui/src/stories/marketplace.stories.tsx` and `tests/accessibility.spec.ts`.
- `packages/kilo-i18n/src/{en,zh}.ts`.
- `packages/kilo-vscode/playwright.config.ts`.
- `.changeset/marketplace-aligned-workspace.md`.

## Design Summary

- Capability detection is authoritative. A valid `aligned-v1` capability payload enables version, synchronized favorite/install, publication, analytics and diagnostic views; a missing/404/invalid capability response selects legacy mode and never renders those invalid actions.
- Internal `skillsOnly` mode opens directly into the Skill Market. Full public mode retains the existing Agent, MCP and Skill tabs and their install/remove behavior.
- The aligned Skill Market uses SolidJS and `@kilocode/kilo-ui`; no React was added to the webview. The navigation toolbar uses monochrome VS Code Codicons in normal flex flow, while content uses VS Code theme tokens and existing Kilo UI cards, buttons, tags, Markdown and spinners.
- The market home supports the existing search/status/tag filters and safe install/remove/favorite/upload actions. On-demand detail fetch avoids loading 10,000 Skill bodies into the initial DOM.
- Detail shows authoritative Markdown, current metadata, revision/SHA, full immutable version history and file metadata. My Favorites, My Installations and My Publications are server-synchronized owner views.
- `GET /api/v1/me/publications` lists only the current pseudonymous owner's runs from the Worker. The minimal G7 analytics view reads authenticated Worker-aggregated global series; G8 retains the full event ingestion, retention, author funnel and load-hardening scope.
- Diagnostics shows render/market/packages/transport state, warnings, capability flags and a safe link to the Web status page.
- New user-facing copy has Simplified Chinese and English fallback. Contract status tokens and server issue messages are rendered unchanged on both surfaces.
- The former decorative Marketplace gradient/shadow was removed from the VS Code webview. The result follows native editor surfaces rather than copying the Web Liquid Glass background.

## Commands Run

- `npm run check && npm run build`
  - Result: PASS; generated contracts current, API 13/13, Web 3/3, contracts 4/4, DB 3/3, skill-spec 4/4, TypeScript and ESLint pass.
- `bun run typecheck && bun run lint`
  - Result: PASS for the extension and SolidJS webview.
- `bun test tests/unit/marketplace-*.test.ts`
  - Result: PASS, 49/49.
- `bun run compile`
  - Result: PASS; fresh CLI build and smoke tests, SDK regeneration, typecheck, lint and all extension/webview bundles completed. The final analytics/Codicon/CSS delta was rechecked with typecheck, lint and `node esbuild.js`, also PASS.
- `bun run build-storybook`
  - Result: PASS. Existing unresolved-font and large-story-bundle warnings remain non-blocking.
- `PLAYWRIGHT_WORKERS=1 bun run test:a11y`
  - Result: PASS, 9/9 after installing the pinned Chromium runtime. A subsequent focused keyboard/section scan also PASS, 1/1 across Favorites, Installed, My Publications, Analytics and Diagnostics.
- `bun run typecheck` in `packages/kilo-i18n`
  - Result: PASS.
- `bun run check-kilocode-change`
  - Result: PASS.
- `bun run script/extract-source-links.ts`
  - Result: completed; 104 unique URLs recorded.
- `bun run script/check-md-table-padding.ts`
  - Result: PASS, 399 Markdown files checked.

## Test Results

- Capabilities 404/invalid response selects legacy catalog; full mode continues loading Agent/MCP/Skill; aligned response selects revision-pinned Skill catalog: PASS.
- Aligned client loads detail, synchronized installations, owner publications, authenticated analytics, status and capability flags with Bearer identity where required: PASS.
- Worker owner publication listing excludes another user; authenticated analytics returns Worker-aggregated series and rejects anonymous reads: PASS.
- Static architecture guard confirms Marketplace cases stay outside `KiloProvider`, SolidJS/Kilo UI are retained, aligned views are capability gated, and Agent/MCP surfaces remain: PASS.
- Storybook aligned home and detail visually inspected at `1100×760`: PASS. Evidence: `aligned-skill-home.png` and `aligned-skill-detail.png`.
- Axe WCAG 2.0/2.1/2.2 A/AA scans for aligned home and detail: PASS. Keyboard activation and scans across all aligned sections: PASS.
- The scans found and drove fixes for the existing identity metadata contrast, inactive tag contrast, and stale ChipMate login label assertion; the final focused section scan is green.

## Known Limitations

- G7 proves code, API integration, compiled bundle and real Storybook component runtime. Real VSIX installation/profile behavior remains G9.
- Analytics currently reads existing aggregate rows. Full event dictionary, Web/Kilo batching, retention, author-specific funnel UX and performance isolation remain G8 by plan.
- SSE reconnect, `Last-Event-ID` compensation and related-cache-only refresh remain G8 hardening.
- Microsoft Edge branded execution remains `USER_WAIVED / NOT_RUN`, not PASS.
- The broader dirty-worktree `bun run test:unit` and `bun run knip` failures documented in G5 remain unrelated; targeted Marketplace, component runtime, type, lint and compile checks pass.

## Next Recommended Gate

- G8: complete event ingestion and batching, pseudonymized retention and author/global funnels, 10,000-Skill/200-concurrency and render-isolation load tests, plus the full adversarial security corpus and SSE recovery.
