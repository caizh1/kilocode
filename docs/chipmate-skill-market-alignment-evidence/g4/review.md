# G4 Review

Status: `PASS_WITH_USER_WAIVER`

## Changed Files

- `server/chipmate-word-render/apps/api/src/aligned.ts`
- `server/chipmate-word-render/apps/api/src/index.ts`
- `server/chipmate-word-render/apps/api/src/start.ts`
- `server/chipmate-word-render/apps/api/test/aligned.test.ts`
- `server/chipmate-word-render/apps/web/src/main.tsx`
- `server/chipmate-word-render/apps/web/src/styles.css`
- `server/chipmate-word-render/apps/web/src/state.ts`
- `server/chipmate-word-render/apps/web/src/shared.tsx`
- `server/chipmate-word-render/apps/web/src/routes/{detail,status}.tsx`
- `server/chipmate-word-render/apps/web/e2e/market.spec.ts`
- `server/chipmate-word-render/playwright.web.config.ts`
- `server/chipmate-word-render/tsconfig.e2e.json`
- `server/chipmate-word-render/apps/web/vite.config.ts`
- `server/chipmate-word-render/apps/web/public/assets/*`
- `server/chipmate-word-render/packages/contracts/src/schema.ts`
- `server/chipmate-word-render/packages/market-db/src/{model,repo,protocol,worker,client}.ts`
- Generated Web and ChipMate aligned-v1 contract clients.
- `server/chipmate-word-render/design-qa.md`

## Design Summary

- Worker-backed read-only aligned-v1 routes now own capabilities, catalog, detail, releases, files, categories, authors, status, ETag/304 and the initial catalog invalidation SSE event.
- Tar files are inspected inside the Market DB Worker with safe path handling, text/image preview allowlists and binary metadata fallback.
- React/Vite implements the selected spatial gallery direction with real ChipMate assets, generated WebP hero/background art, responsive Liquid Glass surfaces and Phosphor icons.
- Home, directory, pagination, detail, revision history, file preview and status surfaces use real API data; future install/publish actions are visibly disabled instead of pretending to work.
- Theme state defaults to the OS, cycles through dark/light/system, and persists manual selection. Valid optional author icon/gallery metadata flows from legacy JSON through SQLite to API and Web.

## Commands Run

- `npm run check`
- `npm run build`
- `npm --workspace @chipmate/market-api test`
- `npm --workspace @chipmate/market-web run build`
- `npm run test:e2e:web:chrome`
- `npm run test:e2e:web:edge`
- `bun run typecheck`
- `bun test tests/unit/marketplace-generated-contract.test.ts`
- `bun run check-chipmate-change`
- In-app browser interaction and screenshot QA at `1440×1024` and `390×844`.
- Google Chrome 150 headless screenshot smoke at `1440×1024`.

## Test Results

- Server contract generation, TypeScript and ESLint: PASS.
- Server tests: 18 tests across API/Web/contracts/DB/spec packages, all PASS.
- Fastify API integration: 8/8 PASS, including ETag/304, SSE, pagination, author artwork, file preview and legacy compatibility.
- ChipMate generated contract typecheck and targeted unit: PASS.
- In-app browser: search, filter, sort, detail, revision, file preview, theme and status refresh PASS; final clean tab has 0 console errors and 0 warnings.
- Accessibility baseline: 0 missing alt attributes, 0 unnamed buttons, 0 unlabelled fields, 0 targets below 24×24, one h1, no horizontal overflow.
- Performance sample: 76,985 bytes gzip initial JavaScript and 5,127 bytes gzip CSS; detail and status are hashed dynamic chunks of 3,458 and 1,608 bytes gzip. LCP is 588ms, CLS is 0 and no Event Timing entry exceeded 16ms.
- Visual comparison: PASS after one density correction loop; see `reference-vs-implementation-final.png`.
- Google Chrome 150: PASS with real `chrome-home-1440x1024.png`.
- Playwright Chrome project: 5/5 PASS, including light/dark axe, LCP/INP/CLS, the complete read-only journey, theme persistence, 390px layout, keyboard focus, reduced motion and a >=55fps animation budget.
- Playwright Edge project: implemented with the same five tests; USER_WAIVED / NOT_RUN because `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` is absent and the user explicitly instructed on 2026-07-12 to skip Edge testing for now.

## Runtime Evidence

- `home-1440x1024-final.png`
- `directory-1440x1024.png`
- `detail-1440x1024.png`
- `home-mobile-390x844.png`
- `reference-vs-implementation-final.png`
- `chrome-home-1440x1024.png`
- `server/chipmate-word-render/design-qa.md`

## Known Limitations

- Branded Microsoft Edge execution remains NOT_RUN. The user explicitly waived it on 2026-07-12, so it remains visible as a known limitation without blocking G4 approval; this is not an Edge PASS claim.
- SSE currently emits `catalog.invalidated`; favorite, installation, publication and analytics event types belong to later gates.
- Identity, favorites, install synchronization, publishing and analytics remain deliberately disabled.
- Docker/Linux runtime evidence remains NOT_RUN because the local Docker daemon is unavailable.

## Next Recommended Gate

- Start G5 identity/favorite/install synchronization. Add branded Edge evidence later only if the user restores that requirement.
