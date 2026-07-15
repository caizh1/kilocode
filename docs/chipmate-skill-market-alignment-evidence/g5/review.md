# G5 Review

Status: `PASS — INTEGRATION_SCOPE`

## Changed Files

- `server/chipmate-word-render/apps/api/src/{aligned,identity}.ts`
- `server/chipmate-word-render/apps/api/test/aligned.test.ts`
- `server/chipmate-word-render/apps/web/src/{main,shared}.tsx` and `styles.css`
- `server/chipmate-word-render/apps/web/src/routes/detail.tsx`
- `server/chipmate-word-render/apps/web/e2e/market.spec.ts`
- `server/chipmate-word-render/packages/market-db/src/{client,index,migrations,model,protocol,repo,worker}.ts`
- `server/chipmate-word-render/packages/contracts/src/openapi.ts` and generated Web/Kilo clients.
- `packages/kilo-vscode/src/MarketplacePanelProvider.ts`
- `packages/kilo-vscode/src/extension.ts`
- `packages/kilo-vscode/src/services/marketplace/{api,index,installer,install-ui,registry,types,uri}.ts`
- `packages/kilo-vscode/webview-ui/src/components/marketplace/{ItemCard,marketplace.css}`
- Marketplace API, installer, URI and registry unit tests.
- `.changeset/marketplace-identity-install-sync.md`

## Design Summary

- Web login sends the New API key once to the existing server-side resolver, clears the input immediately, and retains only an HttpOnly `SameSite=Strict` random session cookie plus a non-secret in-memory/session CSRF token.
- Web cookie sessions and Kilo Bearer keys derive the same stable pseudonymous `MarketUser.id` from the resolved display identity. Raw keys are never written to SQLite, globalStorage, URLs or tracked defaults.
- Cookie writes require exact Origin/Host agreement and CSRF. Kilo writes require a server-resolved Bearer principal.
- Favorites and installation states are Worker-owned, emit `favorite.changed` / `installation.changed`, and are read by both surfaces through the same aligned-v1 API.
- Install intents are random, hash-at-rest, same-user, revision-pinned, one-time and five-minute-lived. The VS Code URI handler accepts only `vscode://chipmate.chipmate/marketplace/install` from the configured Market origin.
- Kilo validates the immutable download URL origin/path, response size, SHA-256, archive root, paths, links and root `SKILL.md`; install/update uses same-filesystem staging and backup rollback, while removal first atomically renames to a tombstone.
- Only pseudonymous installation metadata is atomically persisted under extension globalStorage. Startup recovery re-syncs current/global managed installations without storing project paths or credentials.

## Commands Run

- `npm run check`
  - Result: PASS; API 11/11, Web 3/3, contracts 4/4, DB 2/2, skill spec 1/1.
- `npm run build`
  - Result: PASS; initial Web JavaScript `79.80 KiB` gzip, CSS `5.57 KiB` gzip, detail route `4.25 KiB` gzip.
- `npm run test:e2e:web:chrome`
  - Result: PASS, 6/6. Edge remains user-waived / NOT_RUN.
- `bun run typecheck`
  - Result: PASS for `packages/kilo-vscode`.
- `bun run lint`
  - Result: PASS for `packages/kilo-vscode`.
- `bun run compile`
  - Result: PASS; fresh local CLI build, SDK regeneration and all extension/webview bundles completed.
- `bun test tests/unit/marketplace-*.test.ts`
  - Result: PASS, 42/42.
- `bun run check-kilocode-change`
  - Result: PASS.
- `bun run script/extract-source-links.ts`
  - Result: completed; the repository-wide generated list also reflects unrelated existing working-tree URL changes.
- `bun run test:unit`
  - Result: FAIL outside G5: 2811 passed, 75 failed, 1 error. Failures are concentrated in pre-existing concurrent Qwen/autocomplete, code-action branding, connection and migration work; all Marketplace tests pass.
- `bun run knip`
  - Result: FAIL outside the G5 runtime path: pre-existing Qwen/autocomplete unused items plus OpenAPI generator umbrella types `webhooks` / `$defs`.

## Test Results

- Same Web session / Kilo Bearer user ID, cookie attributes, raw-key non-persistence, Origin and CSRF rejection: PASS.
- Favorite Web write, Kilo Bearer read and live SSE invalidation: PASS.
- Kilo installation write and Web cookie-session read: PASS.
- Intent wrong-user rejection, expiry, replay rejection and immutable revision archive: PASS.
- URI origin/token/download-path rejection: PASS.
- SHA mismatch, unexpected root, staging cleanup, atomic first install and atomic update: PASS.
- globalStorage pseudonymization and new-registry recovery: PASS.
- Chrome login dialog clears the raw key and passes axe; complete G4 journey remains green: PASS 6/6.

## Known Limitations

- This Review closes G5 at code/integration scope. A real packaged VSIX, real VS Code profile and real New API deployment end-to-end remain explicitly deferred to G9 real-runtime validation.
- Microsoft Edge branded execution remains `USER_WAIVED / NOT_RUN`; it is not claimed as PASS.
- SSE reconnect/backoff and related-cache-only invalidation are not complete; they remain later hardening work.
- Full `test:unit` and `knip` are not checked because the dirty shared worktree has unrelated failures. Targeted Marketplace tests, typecheck, lint, compile and package guards pass.

## Next Recommended Gate

- G6: unified publication, validation, deterministic repair, immutable release and explicit AI-repair handoff.
