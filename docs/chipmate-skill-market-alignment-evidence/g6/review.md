# G6 Review

Status: `PASS — CODE_AND_INTEGRATION_SCOPE`

## Changed Files

- `server/chipmate-word-render/packages/skill-spec/src/index.ts` and its tests.
- `server/chipmate-word-render/packages/market-db/src/{client,index,migrations,model,protocol,repo,worker}.ts` and DB tests.
- `server/chipmate-word-render/apps/api/src/{aligned,index}.ts` and API integration tests.
- `server/chipmate-word-render/apps/web/src/{main,styles}.tsx`, `apps/web/src/routes/publish.tsx`, and Chrome E2E coverage.
- `packages/chipmate-vscode/src/MarketplacePanelProvider.ts` and `src/extension.ts`.
- `packages/chipmate-vscode/src/services/marketplace/{api,archive,index,local-repair,repair,types,uri}.ts`.
- ChipMate Marketplace archive, API, local-repair, repair-output and URI unit tests.
- `packages/chipmate-vscode/webview-ui/src/components/marketplace/{MarketplaceView,marketplace.css}` and Marketplace message/type definitions.
- `.changeset/marketplace-unified-publication.md`.

## Design Summary

- Web and ChipMate submit the same gzip archive to one server-authoritative `PublicationRun`. Validation and repair rules live only in `@chipmate/skill-spec`; clients display the returned `ValidationReport` and do not duplicate it.
- The Worker validates and snapshots the upload, applies deterministic normalization only to that snapshot, writes immutable release archives, assigns monotonically increasing revisions, stores optional valid SemVer, enforces owner identity, deduplicates equal hashes, and binds retries to an idempotency key plus source hash.
- Format normalization covers the root `SKILL.md` name, frontmatter, normalized metadata, generated `skill.json`, UTF-8/NFC/newlines and ignored files while preserving the Markdown body semantics.
- Static security validation rejects unsafe/duplicate paths, absolute and drive paths, links, malformed/truncated tar headers, file/count/compressed/extracted limits, nested archives by extension or magic, secrets, executable formats, dangerous Markdown HTML/URLs, malformed or oversized PNG/JPEG/WebP files, and unsupported file types. `scripts/` is reported and never executed.
- A valid snapshot publishes without a second confirmation. Semantic failure remains `NEEDS_AI_CONFIRMATION`; no release is visible before an explicitly selected, non-expired, exact-hash AI patch passes complete server revalidation.
- Render Service contains no model call or model credentials. ChipMate opens a temporary session on the current Provider only after an explicit consent dialog, sends only the necessary normalized `SKILL.md`, treats it as untrusted input, parses bounded JSON, shows a VS Code diff, and uploads the patch only after a second explicit confirmation.
- Web repair links carry only the configured origin and random publication run ID. Server ownership and an eight-hour repair window gate snapshot access; the AI patch itself expires after ten minutes. Web also provides complete manual repair/re-upload instructions when ChipMate is unavailable.
- Applying deterministic fixes to local files is optional. ChipMate verifies safe paths and exact before/after hashes, opens each diff, and writes only after a modal confirmation; validation and automatic publication never mutate the source directory.

## Commands Run

- `npm run check`
  - Result: PASS; generated contracts current, TypeScript and ESLint pass, API 12/12, Web 3/3, contracts 4/4, DB 3/3 and skill-spec 4/4.
- `npm run build`
  - Result: PASS; first route JavaScript `80.09 KiB` gzip, CSS `5.94 KiB` gzip, publish route `5.11 KiB` gzip.
- `npm run test:e2e:web:chrome`
  - Result: PASS, 7/7 including authenticated publication and shared validation report UI. Edge remains user-waived / `NOT_RUN`.
- `bun run typecheck`
  - Result: PASS for `packages/chipmate-vscode` extension and webview.
- `bun run lint`
  - Result: PASS for `packages/chipmate-vscode`.
- `bun test tests/unit/marketplace-*.test.ts`
  - Result: PASS, 47/47.
- `bun run compile`
  - Result: PASS; a fresh local CLI was built and smoke-tested, SDK regenerated, and extension/webview bundles compiled.
- `bun run check-chipmate-change`
  - Result: PASS.
- `bun run script/extract-source-links.ts`
  - Result: completed; 104 unique URLs recorded. The generated file also reflects unrelated existing working-tree URL changes.
- `bun run script/check-md-table-padding.ts`
  - Result: PASS, 399 Markdown files checked.

## Test Results

- The same archive submitted through a Web session and ChipMate Bearer identity returns an identical `ValidationReport`; a second content hash returns `UNCHANGED` at the existing revision: PASS.
- Idempotency retry, idempotency key/content conflict, increasing revision, duplicate SemVer conflict, immutable release trigger, owner read/update/unpublish rejection and unpublish: PASS.
- Missing/lowercase `SKILL.md`, frontmatter/metadata/JSON/text normalization, ignored-file removal and unchanged body meaning: PASS.
- Secret, Markdown XSS/dangerous URL, symlink, hidden nested archive, executable magic, malformed image, tar header/truncation, path and size guards: implementation covered; representative integration/unit cases PASS.
- Semantic failure is not published; unconfirmed and expired AI patches are rejected; exact before/after hashes are enforced; confirmed patch is fully revalidated and auto-published: PASS.
- A normalized semantic failure with zero deterministic edits still exposes a short-lived, owner-only `SKILL.md` repair fragment: PASS.
- ChipMate publication archive is deterministic and does not read or change local files; local repair planning filters unsafe/stale/no-op patches without writing: PASS.
- Repair deep links reject wrong origin/path/run shape; AI output parser rejects non-JSON and oversized/short content: PASS.
- Web `/publish` login returns to the publication page, reports status/revision/SHA/issues, explains snapshot-only repair, passes axe and does not change the upload fixture: PASS.

## Known Limitations

- G6 closes code and integration scope. A real packaged VSIX, real VS Code profile, real current Provider response, and deployed New API identity remain G9 runtime checks; no claim of real-provider AI execution is made here.
- Microsoft Edge branded execution remains `USER_WAIVED / NOT_RUN`, not PASS.
- The broader dirty-worktree `bun run test:unit` and `bun run knip` failures documented in G5 remain outside this Gate; targeted Marketplace tests, typecheck, lint, compile and affected guards pass.
- Full adversarial corpus, concurrency, retention, SSE reconnect and performance/security load testing remain G8.

## Next Recommended Gate

- G7: complete the ChipMate Marketplace aligned-v1 information architecture, legacy capability hiding, version/favorite/install/publication surfaces, diagnostics and eventual analytics entry point without removing Agent/MCP tabs.
