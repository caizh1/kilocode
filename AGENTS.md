# AGENTS.md

Kilo CLI is an open source AI coding agent that generates code from natural language, automates tasks, and supports 500+ AI models.

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `main`.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- You may be running in a git worktree. All changes must be made in your current working directory — never modify files in the main repo checkout.

## Development Backlog

- `DEVELOPMENT_TODO.md` at the repository root is the authoritative cross-session development backlog for this project.
- When a session identifies a concrete, actionable development item and explicitly defers it, add it to or update it in `DEVELOPMENT_TODO.md` before finishing. Update an existing item instead of creating a duplicate.
- Keep completed or cancelled items in the backlog and update their status rather than deleting them.
- Do not add speculative or unverified risks, routine code TODO comments, or session-local implementation steps to the backlog.

## Build and Dev

- **Dev**: `bun run dev` (runs from root) or `bun run --cwd packages/opencode --conditions=browser src/index.ts`
- **Dev with params**: `bun dev -- help`
- **Extension**: `bun run extension` (build + launch VS Code with the extension in dev mode). Pass `--no-build` to skip the build.
- **Typecheck**: `bun turbo typecheck` (uses `tsgo`, not `tsc`). Includes the JetBrains plugin and requires Java 21; do not run `java -version` as a routine preflight. Only check Java when a Gradle/Java command fails with a Java-version or missing-Java error. If missing, install via SDKMAN: `sdk install java 21-tem && sdk use java 21-tem`. If SDKMAN is not installed, see https://sdkman.io/install.
- **Test**: `bun test` from `packages/opencode/` (NOT from root -- root blocks tests)
- **Single test**: `bun test ./test/tool/tool-define.test.ts` from `packages/opencode/`
- **CLI build artifact size check**: after `bun run script/build.ts --single --skip-install` in `packages/opencode/`, use `du -h dist/*/*/bin/kilo` (scoped package output lives under `dist/@kilocode/`)
- **SDK regen**: After changing server endpoints in `packages/opencode/src/server/`, run `./script/generate.ts` from root to regenerate `packages/sdk/js/`
- **Knip** (unused exports): `bun run knip` from `packages/kilo-vscode/`. CI runs this — all exported types/functions must be imported somewhere. Remove or unexport unused exports before pushing.
- **Source links**: After adding or changing URLs in `packages/kilo-vscode/`, `packages/kilo-vscode/webview-ui/`, or `packages/opencode/src/`, run `bun run script/extract-source-links.ts` from the repo root and commit the updated `packages/kilo-docs/source-links.md`. CI runs this check — the build fails if the file is stale.
- **kilocode_change check**: `bun run check-kilocode-change` from `packages/kilo-vscode/`. CI runs this — `kilocode_change` is a marker for upstream merge conflicts and must not appear in `packages/kilo-vscode/` or `packages/kilo-ui/` (these are entirely Kilo Code additions). Remove the markers before pushing.
- **opencode annotation check**: `bun run script/check-opencode-annotations.ts --worktree` from repo root when verifying local agent changes. CI runs `bun run script/check-opencode-annotations.ts` on PRs touching `packages/opencode/` — every Kilo-specific change in shared opencode files must be annotated with `kilocode_change` markers. Exempt paths (no markers needed): `packages/opencode/src/kilocode/`, `packages/opencode/test/kilocode/`, and any path containing `kilocode` in the name.
- **Effect facade ratchet**: Do not add runtime-backed Promise facades to shared `packages/opencode/src` Effect services; use service dependencies, `AppRuntime`, or Kilo-owned boundaries. Run `bun run script/check-opencode-promise-facades.ts` when touching service adapters.
- **workflow allowlist**: `bun run script/check-workflows.ts` from repo root. CI runs this as part of the annotations workflow — any `.yml` / `.yaml` file added to or removed from `.github/workflows/` must be reflected in the hardcoded list in `script/check-workflows.ts`. Prevents upstream-merged workflows from silently starting to run in our CI.
- **Backend/SDK programmatic testing**: see [TESTING.md](./TESTING.md) for spawning the local main-branch backend (`bun dev serve`) and driving it via `curl` — use this instead of `kilo serve` (prod binary) when testing backend fixes.

## VS Code Extension Packaging

- When the user asks to package the VS Code extension (`打包`) without explicitly narrowing the target, produce two VSIX artifacts by default: macOS and `win32-x64-baseline`.
- For local/internal VSIX or offline packaging, inject Word/Mermaid render service defaults only from ignored local inputs such as `.env.local`, `.kilo-render-defaults.local.json`, or the current shell environment. Never write private render endpoints into tracked source, `package.json`, `AGENTS.md`, README files, tests, documentation, or any diff intended for remote git. The concrete endpoint may exist only in ignored local files, the current process environment, generated local VSIX/offline artifacts, or the local VS Code/user environment.
- If local render defaults are present, package-time injection should set the packaged defaults for `kilo.documents.wordRender.remoteEndpoint` and `kilo.documents.mermaidRender.remoteEndpoint`, then restore tracked `package.json` defaults before the packaging script exits. Do not commit generated VSIX/offline artifacts unless explicitly requested.
- The Windows artifact must use the baseline x64 CLI/VSIX target for wider CPU compatibility; do not substitute the generic `win32-x64` target unless the user explicitly requests it.
- Every packaging run must build fresh target CLI artifacts first and package from those newly built `packages/opencode/dist/@kilocode/cli-*` outputs. Do not reuse CLI binaries, `bin/` directories, or files extracted from older VSIX artifacts; if a target CLI cannot be freshly built, report the blocker instead of producing a recycled package.
- For the default internal/offline Windows baseline package, run `bun script/build.ts --internal-offline` from `packages/kilo-vscode/`. This packages only `win32-x64-baseline` with the internal custom-provider-only UI/runtime and pruned resources; use the normal public packaging path only when the user explicitly asks for a public/multicloud package.
- The Windows baseline VSIX must bundle `extension/bin/rg.exe` and the LanceDB runtime under `extension/bin/lancedb/node_modules/` for offline Windows environments. Verify the final VSIX contains `extension/bin/lancedb/node_modules/@lancedb/lancedb/dist/index.js` and `extension/bin/lancedb/node_modules/@lancedb/lancedb-win32-x64-msvc/lancedb.win32-x64-msvc.node` so the CLI does not need to download ripgrep from GitHub or `@lancedb/lancedb` from npm at runtime.
- The default Windows baseline VSIX is a no-audio package: do not bundle `extension/bin/ffmpeg.exe` unless the user explicitly asks for speech or audio support. Chat, QA, RAG, CodeGraph, Agent Manager, and diff panels should still work without FFmpeg; speech/audio features may require a system FFmpeg or a separate audio-enabled package.
- Do not remove `extension/dist/*.js`; these are the extension runtime and webview bundles. Exclude `extension/dist/**/*.map` source maps by default to reduce package size unless the user explicitly asks for a debug package.
- The default internal Windows baseline VSIX only needs Simplified Chinese UI. When optimizing package size, build a Chinese-only language bundle that keeps `en` as the fallback dictionary and `zh` as the only non-English locale; do not bundle other locale dictionaries unless the user explicitly asks for multilingual, public-marketplace, or debug packaging. Do not delete source i18n files from the repo just to package a Chinese-only VSIX; prune or alias locale imports at build/package time.
- The default internal Windows baseline VSIX targets an offline intranet environment where only custom providers are usable. Do not surface Kilo/ChipMate Gateway, public "popular providers", or public model recommendations by default in the packaged internal build unless the user explicitly asks for a public/multicloud package. Prefer a custom-provider-only provider picker/settings experience, and use `enabled_providers`/provider config to restrict runtime provider lists instead of deleting provider source code. A minimal or pruned `models-snapshot.json` is acceptable for the internal package as long as custom provider configuration and model selection still work.
- For internal/offline indexing defaults, use `openai-compatible` with model `qwen3-embedding-8b`, dimension `2048`, and `lancedb` unless the user explicitly configures another embedding model or dimension.
- When verifying the Windows baseline VSIX, confirm it contains `extension/bin/kilo.exe`, `extension/bin/rg.exe`, `extension/bin/models-snapshot.json`, `extension/bin/tree-sitter/tree-sitter.wasm`, `extension/bin/lancedb/node_modules/@lancedb/lancedb/dist/index.js`, `extension/bin/lancedb/node_modules/@lancedb/lancedb-win32-x64-msvc/lancedb.win32-x64-msvc.node`, `extension/dist/extension.js`, `extension/dist/webview.js`, `extension/dist/agent-manager.js`, `extension/dist/diff-viewer.js`, and `extension/dist/diff-virtual.js`; confirm it does not contain `extension/bin/ffmpeg.exe` or `extension/dist/*.map` for the default no-audio package.
- Internal update hosting publishes each complete VSIX directly to the render-service packages host through a temporary file, verifies SHA-256 there, and atomically renames it to the final `.vsix` name. The service dynamically generates `/packages/manifest.json`; do not create or transfer `latest.json` or a wrapper `.tar.gz`.
- When creating Linux/offline deployment archives on macOS, do not use the system `tar` if the archive will be extracted on Linux. macOS `bsdtar` can preserve `com.apple.*` extended attributes such as `com.apple.provenance`, causing Linux extraction errors like `lsetxattr ... operation not supported`. Use a packaging path that strips Apple xattrs, such as Python `tarfile` with empty pax headers, and verify both outer archives and nested `.tar.gz` files with `gzip -dc <archive> | strings | rg 'com\\.apple|LIBARCHIVE\\.xattr|SCHILY\\.xattr|AppleDouble|__MACOSX'` before handoff.

## Quality Checks

Before saying an implementation is ready, run the smallest relevant checks that can catch lint, typecheck, and test failures for the touched package. Do not rely on manual extension launch to discover build problems. Fix failures you introduced before the final response, or state exactly which check is still failing or could not be run.

| Area | Checks |
|---|---|
| Root / cross-package | `bun run lint`, `bun run typecheck` |
| CLI | From `packages/opencode/`: `bun run typecheck`, `bun test` or targeted `bun test ./path/to/file.test.ts` |
| VS Code extension | From `packages/kilo-vscode/`: `bun run typecheck`, `bun run lint`, `bun run test:unit` or `bun run test` |
| Extension build/package | From `packages/kilo-vscode/`: `bun run compile` or `bun run package` when touching build, packaging, SDK, or webview integration paths |
| JetBrains plugin | From `packages/kilo-jetbrains/`: `./gradlew typecheck`, `./gradlew test`. Requires Java 21; do not run `java -version` as a routine preflight. Check Java only after a Java-version or missing-Java failure. |
| CI/local guards | Run affected guards documented above, such as `bun run knip`, `bun run check-kilocode-change`, `bun run script/check-opencode-annotations.ts --worktree`, or source link extraction |

Never run root `bun test`; the root script prints `do not run tests from root` and exits with code 1. Use package-level tests instead.

## Products

All products are clients of the **CLI** (`packages/opencode/`), which contains the AI agent runtime, HTTP server, and session management. Each client spawns or connects to a `kilo serve` process and communicates via HTTP + SSE using `@kilocode/sdk`.

| Product | Package | Description |
|---|---|---|
| Kilo CLI | `packages/opencode/` | Core engine. TUI, `kilo run`, `kilo serve`. Fork of upstream OpenCode. |
| Kilo VS Code Extension | `packages/kilo-vscode/` | VS Code extension. Bundles the CLI binary, spawns `kilo serve` as a child process. Includes the **Agent Manager** — a multi-session orchestration panel with git worktree isolation. |

**Agent Manager** refers to a feature inside `packages/kilo-vscode/` (extension code in `src/agent-manager/`, webview in `webview-ui/agent-manager/`). It is not a standalone product. See the extension's `AGENTS.md` for details.

In each VS Code extension host, one `KiloConnectionService` is created for the sidebar, every Kilo editor tab, and Agent Manager; it lazily starts and reuses one current `kilo serve` backend at a time. Agent Manager worktree sessions pass a directory context to this shared backend rather than starting one per worktree. State captured by the active service layer, such as Snapshot `trackState`, is shared across those requests; only directory-keyed `InstanceState` data is isolated.

Extension-specific settings should live in the Kilo extension settings, not default VS Code settings, unless they are intentionally VS Code-wide. Experimental flags should follow existing flag patterns, not VS Code settings; they usually belong in the Kilo Experimental settings section.

## VS Code 工具栏/图标规则

- VS Code 风格界面里的工具栏动作，不要设计自定义彩色图标。
- 除非周围原生 UI 已经使用圆形徽标，否则不要使用圆形徽标。
- 优先使用 VS Code Codicons 或项目已有的 `IconButton` 组件。
- 图标必须是单色、继承 `currentColor`，并遵循主题 token。
- 图标的尺寸、描边视觉重量、内边距、hover、active、disabled 和间距必须匹配现有工具栏动作。
- 如果在现有原生图标旁新增图标，必须先检查相邻图标的实现，并复用它们的样式。

## Package Instructions

- When a task primarily touches `packages/kilo-jetbrains/`, read `packages/kilo-jetbrains/AGENTS.md` before planning or editing. It covers split-mode architecture, IntelliJ source lookup, threading fundamentals, UI guidelines, and session component architecture.

## Monorepo Structure

Turborepo + Bun workspaces. The packages you'll work with most:

| Package | Name | Purpose |
|---|---|---|
| `packages/opencode/` | `@kilocode/cli` | Core CLI -- agents, tools, sessions, server, TUI. This is where most work happens. |
| `packages/sdk/js/` | `@kilocode/sdk` | Auto-generated TypeScript SDK (client for the server API). Do not edit `src/gen/` by hand. |
| `packages/kilo-vscode/` | `kilo-code` | VS Code extension with sidebar chat + Agent Manager. See its own `AGENTS.md` for details. |
| `packages/kilo-gateway/` | `@kilocode/kilo-gateway` | Kilo auth, provider routing, API integration |
| `packages/kilo-telemetry/` | `@kilocode/kilo-telemetry` | PostHog analytics + OpenTelemetry |
| `packages/kilo-i18n/` | `@kilocode/kilo-i18n` | Internationalization / translations |
| `packages/kilo-ui/` | `@kilocode/kilo-ui` | SolidJS component library shared by the extension webview and docs screenshot stories |
| `packages/util/` | `@opencode-ai/util` | Shared utilities (error, path, retry, slug, etc.) |
| `packages/plugin/` | `@kilocode/plugin` | Plugin/tool interface definitions |

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

- Keep things in one function unless composable or reusable
- Avoid unnecessary destructuring. Instead of `const { a, b } = obj`, use `obj.a` and `obj.b` to preserve context
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity

### Avoid let statements

Prefer `const`. Replace `let` + if/else assignment with a ternary or an IIFE. Reassignment is the only legitimate reason to reach for `let`.

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

### Avoid else statements

Prefer early returns (or an IIFE) over `else`. After an `if` that returns/throws, the `else` is redundant.

### No empty catch blocks

Never leave a `catch` block empty. An empty `catch` silently swallows errors and hides bugs. If you're tempted to write one, ask yourself:

1. Is the `try`/`catch` even needed? (prefer removing it)
2. Should the error be handled explicitly? (recover, retry, rethrow)
3. At minimum, log it via `log.error("...", { err })` so failures are visible — never `catch {}` or `catch (e) {}` with no body.

### Prefer single word naming

Default to a single-word name for variables, parameters, and helper functions. Reach for a multi-word name only when a single word would be genuinely ambiguous in context — not just because the longer name "reads nicer". The rule is about meaning, not character count: don't introduce camelCase compounds like `inputPID`, `existingClient`, `connectTimeout`, or `workerPath` when `pid`, `client`, `timeout`, or `path` is already clear from the surrounding code. See the "Naming Enforcement" section above for the preferred vocabulary.

## Testing

You MUST avoid using `mocks` as much as possible.
Tests MUST test actual implementation, do not duplicate logic into a test.

## Markdown Tables

Do not pad markdown table cells for column alignment. Use the compact form with single-space-padded content cells and a minimal separator row:

```
| Command | What it runs |
|---|---|
| `kilo serve` | The prod CLI on `$PATH`. |
```

Do **not** right-pad cells to line up columns:

```
| Command                       | What it runs             |
| ----------------------------- | ------------------------ |
| `kilo serve`                  | The prod CLI on `$PATH`. |
```

Padding makes every content change rewrite the entire table, which blows up diffs on untouched rows. Markdown files are excluded from prettier (see `.prettierignore`) so running the formatter won't re-pad them, and `script/check-md-table-padding.ts` enforces the rule in CI. Run `bun run script/check-md-table-padding.ts --fix` to auto-rewrite padded tables.

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) with scopes matching packages: `vscode`, `cli`, `agent-manager`, `sdk`, `ui`, `i18n`, `kilo-docs`, `gateway`, `telemetry`, `desktop`. Omit scope when spanning multiple packages.

## Commit and Push Hygiene

- Before committing or pushing, inspect the staged and unstaged file list and exclude files unrelated to the code change.
- Do not push local build/package artifacts, logs, screenshots, caches, temporary files, or transfer-only files. This includes packaged extension artifacts such as `*.vsix`, unless the user explicitly asks to commit that artifact and the repo already tracks it for release.
- If a packaging command creates artifacts while validating a change, leave those artifacts untracked or remove them before staging.

## Changesets

User-facing changes (features, fixes, breaking changes) require a changeset file for release notes. Prefer one concise changeset per PR, grouping related changes when possible. Run `bunx changeset add` or manually create `.changeset/<slug>.md`. Use `patch` for bug fixes, `minor` for new features, `major` for breaking changes. See `.changeset/README.md` for details.

Changeset descriptions appear directly in release notes and are read by end users. Keep them concise and feature-oriented — describe **what changed from the user's perspective**, not implementation details. Write in imperative mood (e.g. "Support exporting conversations as markdown" not "Add a new export handler that serializes session messages to .md files").

## Pull Requests

PR descriptions should explain **what** changed, **why** the change is needed, and the intent or constraints a reviewer cannot infer from the diff alone. Keep simple PRs brief, but give non-trivial changes enough context to stand on their own. Skip file-by-file inventories, test result summaries, and anything obvious from the code itself.

## GitHub Issues

When creating or managing GitHub issues for the VS Code extension or JetBrains plugin via `gh`, load `.kilo/skills/gh-issues/SKILL.md`. It covers templates, project boards (`VS Code Extension`, `Jetbrains Plugin`), title conventions, and the `gh auth refresh -s project` recovery path.

## Fork Merge Process

Kilo CLI is a fork of [opencode](https://github.com/anomalyco/opencode).

**Very important**: when planning or coding, update shared files with OpenCode as last resort! Everything is shared code from OpenCode, except folders that contain `kilo` in the name or have a parent directory that contains `kilo` in the name. Example of kilo specific folders: `packages/opencode/src/kilocode/` and `packages/kilo-docs/`. Always look for ways to implement your feature or fix in a way that minimizes changes to shared code.

### Minimizing Merge Conflicts

We regularly merge upstream changes from opencode. To minimize merge conflicts and keep the sync process smooth:

1. **Prefer `kilocode` directories** - Place Kilo-specific code in dedicated directories whenever possible:
   - `packages/opencode/src/kilocode/` - Kilo-specific source code
   - `packages/opencode/test/kilocode/` - Kilo-specific tests
   - `packages/kilo-gateway/` - The Kilo Gateway package

2. **Minimize changes to shared files** - When you must modify files that exist in upstream opencode, keep changes as small and isolated as possible.

3. **Use `kilocode_change` markers** - When modifying shared code, mark your changes with `kilocode_change` comments so they can be easily identified during merges.
   Do not use these markers in files within directories with kilo in the name

4. **Avoid restructuring upstream code** - Don't refactor or reorganize code that comes from opencode unless absolutely necessary.

5. **Mirror new config keys to the cloud schema** - When adding a `kilocode_change` key to `Config.Info` in `packages/opencode/src/config/config.ts`, also add the matching JSON Schema entry in `apps/web/src/app/config.json/extras.ts` in the [cloud repo](https://github.com/Kilo-Org/cloud). See [CLI Config Schema](packages/kilo-docs/pages/contributing/architecture/config-schema.md) for the step-by-step.

The goal is to keep our diff from upstream as small as possible, making regular merges straightforward and reducing the risk of conflicts.

### Git conflict style

`bun install` sets `merge.conflictStyle=zdiff3` repo-locally via `script/setup-git.ts` (wired into `postinstall`). Conflicts include the common ancestor between `|||||||` and `=======`, which is what `script/upstream/` and `mergiraf` rely on for structural resolution and what makes manual resolution on shared opencode files tractable. If you've overridden it in your user config, the repo-local setting takes precedence — don't override it back.

### Kilocode Change Markers

When editing shared upstream files, mark Kilo-specific lines with `kilocode_change` comments so future merges can find them. The basic forms are:

- Single line: `const value = 42 // kilocode_change`
- Multi-line block: wrap with `// kilocode_change start` / `// kilocode_change end`
- New file in a shared path: `// kilocode_change - new file` at the top
- JSX/TSX: use `{/* kilocode_change */}` (and `{/* kilocode_change start */}` / `end`)

Markers are NOT needed in paths that contain `kilocode` in the name (e.g. `packages/opencode/src/kilocode/`, `packages/opencode/test/kilocode/`) — these are entirely Kilo Code additions and won't conflict with upstream.

For decision rules on when to keep changes inline vs. extract Kilo logic, marker placement guidance, and verification commands, load `.kilo/skills/kilocode-merge-minimizer/SKILL.md`.

本仓库当前目标是把 `/Users/archer/Work/opencode` 中 ChipMate VS Code 插件的 C/C++ hybrid retrieval 能力迁入 Kilo Code，但迁移必须分阶段、小步、可测试。

## ChipMate Hybrid Retrieval Migration Rules

Hard constraints:

1. Do not implement or modify inline completion unless explicitly requested.
2. Do not change UI unless explicitly requested.
3. Do not replace the existing `semantic_search` tool.
4. Add deep C/C++ code understanding through a separate `codebase_analysis` tool.
5. Treat `/Users/archer/Work/opencode` as read-only reference material.
6. Prefer Kilo-owned paths:

   * `packages/kilo-indexing`
   * `packages/opencode/src/kilocode`
   * `packages/opencode/test/kilocode`
7. Avoid changing shared upstream opencode files. If this is unavoidable, explain why and run `bun run script/check-opencode-annotations.ts`.
8. Every phase must be small, reviewable, and testable.
9. Every codebase analysis result must include source-backed evidence with file path and line numbers where possible.
10. Always enforce evidence budget limits.
11. Avoid returning oversized evidence packs.
12. `graph-only` mode must not call embedding or vector search.
13. Do not add rerank provider or rerank settings in v1.
14. Do not automatically inject evidence into every prompt.
15. If modifying worker protocols or public exported types, add tests.
16. Every completed phase must report:

    * changed files
    * design summary
    * commands run
    * test results
    * known limitations
    * next recommended phase

Preferred phase order:

1. Public types and stub `queryEvidence`.
2. Worker protocol and `codebase_analysis` tool.
3. Graph sidecar lifecycle.
4. Parser/code graph migration.
5. Exact symbol and BM25 retrieval.
6. Graph expansion.
7. State-machine extraction.
8. Tool prompt tuning and conservative answer policy.
9. Optional rerank in a later phase.

Do not do multiple phases in one pass unless explicitly requested.
