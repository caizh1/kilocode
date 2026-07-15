# G8 Security Evidence

Date: 2026-07-12

Status: PASS

## Attack matrix

- Archive paths: relative traversal, absolute paths, links, invalid checksum, truncated entry, compressed-size limit, extracted-size limit, per-file limit, file-count limit, nested/hidden archives.
- Content: private keys and credential patterns, executable magic and dangerous binary extensions, malformed and oversized PNG dimensions, invalid UTF-8.
- Markdown: script/iframe/object/embed/form/input/style/meta/link/svg/math elements, event handlers, `javascript:` and `data:text/html` URLs.
- Identity: cookie writes require same Origin/Host and CSRF; server derives the pseudonymous user rather than trusting event input; non-owners cannot read publication runs, submit patches, unpublish, or view another author's funnel.
- Deep links: Kilo accepts only the configured origin, strict route/token/run shapes, one-time intents, revision-pinned archives, and same-origin download URLs.

## Commands and results

- `npm run --workspace @chipmate/skill-spec test`: 6/6 PASS.
- `npm run --workspace @chipmate/market-api test`: 14/14 PASS.
- `bun test tests/unit/marketplace-api.test.ts tests/unit/marketplace-uri.test.ts tests/unit/marketplace-archive.test.ts tests/unit/marketplace-analytics.test.ts`: 13/13 PASS.
- `npm run lint && npm test && npm run build`: server lint PASS; API 14/14, Web 3/3, contracts 4/4, DB 3/3, Skill spec 6/6; all workspace builds PASS.

No API key, Skill body, full IP address, raw client identifier, or real workspace path is written into analytics events. Edge browser execution remains `USER_WAIVED / NOT_RUN` and is not represented as PASS.
