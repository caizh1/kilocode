# Continue Autocomplete Context Selection Audit

Phase: 2E-0

Source of truth: `continuedev/continue@eaa23c5a9de86049dff765f635c18f61d1d043bb`

This audit is documentation-only. It does not change qwen-direct runtime behavior,
cache behavior, request bodies, filtering, postprocess, range rendering, Chat,
Agent, RAG, CodeGraph, `semantic_search`, `codebase_analysis`, the old
autocomplete runtime, `/chipmate/fim`, `/chipmate/edit`, or `/v1/chat/completions`.

## Inspected Sources

| Area | Upstream source | Local subset inspected | Notes |
|---|---|---|---|
| Provider lifecycle | `core/autocomplete/CompletionProvider.ts` | `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/autocomplete` subset lacks the full provider. | Upstream provider is the lifecycle source of truth. |
| Snippet collection | `core/autocomplete/snippets/getAllSnippets.ts` | `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/autocomplete/snippets/getAllSnippets.ts` | Local subset matches the source shape for payload fields and collection calls. |
| Snippet filtering | `core/autocomplete/templating/filtering.ts` | `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/autocomplete/templating/filtering.ts` | Local subset adds `maxSnippetPercentage` to remaining-token calculation; upstream eaa23c5a uses remaining prompt tokens directly. |
| Snippet validation | `core/autocomplete/templating/validation.ts` | `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/autocomplete/templating/validation.ts` | Filters empty snippets, stale clipboard snippets, and Continue output channel snippets. |
| Recently opened formatting | `core/autocomplete/templating/formatOpenedFilesContext.ts` | `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/autocomplete/templating/formatOpenedFilesContext.ts` | Token-budgets and trims opened-file snippets after collection. |
| Context retrieval | `core/autocomplete/context/ContextRetrievalService.ts` | `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/autocomplete/context/ContextRetrievalService.ts` | Delegates to import definitions, root path context, and static context. |
| Import definitions | `core/autocomplete/context/ImportDefinitionsService.ts` | `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/autocomplete/context/ImportDefinitionsService.ts` | Requires tree-sitter, workspace checks, LSP `gotoDefinition`, and `readRangeInFile`. |
| Root path snippets | `core/autocomplete/context/root-path-context/RootPathContextService.ts` | `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/autocomplete/context/root-path-context/RootPathContextService.ts` | Requires `HelperVars.treePath`, tree-sitter queries, LSP definitions, and range reads. |
| Static context | `core/autocomplete/context/static-context/StaticContextService.ts` | `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/autocomplete/context/static-context/StaticContextService.ts` | High-risk TypeScript/static-context path. Deferred. |
| Helper input | `core/autocomplete/util/HelperVars.ts`, `core/autocomplete/util/types.ts` | Same local subset paths. | Current qwen-direct Phase 2C covers current-file helper/token budget parity, but not context sources. |
| Defaults | `core/util/parameters.ts` | `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/util/parameters.ts` | Upstream eaa23c5a has `maxPromptTokens=1024`; local subset currently shows `2048`. Treat upstream as source of truth. |
| VS Code trackers | Continue VS Code extension autocomplete services | `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/vscode-test-harness/src/autocomplete/recentlyEdited.ts`, `RecentlyVisitedRangesService.ts` | Reference only. Do not re-enable the old ChipMate autocomplete runtime. |
| Old ChipMate classic adapter | Not source of truth for qwen-direct | `packages/chipmate-vscode/src/services/autocomplete/classic-auto-complete/getProcessedSnippets.ts` | Shows prior integration shape but imports `getAllSnippetsWithoutRace`; qwen-direct must not reuse this path in 2E-1. |

## Continue Provider Context Lifecycle

Continue autocomplete context is gathered inside `CompletionProvider.provideInlineCompletionItems`
after the current request has passed setup, debounce, helper construction, and
prefiltering:

1. Prepare autocomplete LLM and options.
2. Block security-concern filepaths.
3. Apply debounce unless forced.
4. Apply autocomplete template option if present.
5. Build `HelperVars.create(input, options, llm.model, ide)`.
6. Run `shouldPrefilter(helper, ide)`.
7. In parallel, call `getAllSnippetsWithoutRace(...)` and `ide.getWorkspaceDirs()`.
8. Call `renderPromptWithTokenLimit({ snippetPayload, workspaceDirs, helper, llm })`.
9. Lookup cache with `cache.get(helper.prunedPrefix)`.
10. On cache miss, stream generation, then postprocess.
11. Store successful non-cache outcomes with `cache.put(outcome.prefix, outcome.completion)`.

For qwen-direct Phase 2E-1, only the pure payload/filtering/token-budget selection
scaffold is allowed. It must use empty payload arrays and must not call
`getAllSnippetsWithoutRace`, `ContextRetrievalService`, `getClipboardContent`,
opened-file reads, recently edited or visited trackers, import definitions,
root path context, or static context.

## Context Source Ledger

Classification:

- A: Low-risk autocomplete context or pure selection behavior to port soon.
- B: Medium-risk autocomplete context that needs qwen adapter and extra tests.
- C: High-risk autocomplete context to defer.
- D: Out of autocomplete scope; do not port.

| Context source | Continue source file/function | What it collects | Lifecycle timing | Filtering | Token budget | Requires IDE/LSP/indexing services | QA/RAG risk | Safe to port to qwen-direct | Class | Recommended phase |
|---|---|---|---|---|---|---|---|---|---|---|
| Current-file prefix/suffix context | `HelperVars.create`, `constructInitialPrefixSuffix`, `pruneLinesFromTop`, `pruneLinesFromBottom` | Current file prefix, suffix, pruned caret window. | Before prefilter and before snippets. | Existing qwen guard/prefilter plus Continue helper pruning. | Phase 2C helper budget: prefix and suffix use `maxPromptTokens`, `prefixPercentage`, and `maxSuffixPercentage`. | IDE read/workspace dirs only; AST optional. | None if kept current-file only. | Already handled by Phase 2C. | A | Done in Phase 2C; document only. |
| Pure snippet payload types | `SnippetPayload`, `AutocompleteSnippetType`, snippet interfaces | Empty structured slots for root path, imports, IDE snippets, edited ranges, visited ranges, diff, clipboard, opened files, static context. | Would be created before prompt rendering. | None when payload is empty. | None when payload is empty. | None if no collectors are invoked. | None. | Yes, but only with empty payloads in Phase 2E-1. | A | 2E-1 |
| Pure snippet filtering and token-budget selection | `getSnippets`, `isValidSnippet`, `formatOpenedFilesContext` | Filters and orders already-collected snippets. | After snippet payload collection, before prompt rendering. | Empty content removal, Continue output-channel removal, clipboard age check, duplicate file prevention, caret-window duplicate removal for base snippets. | Upstream eaa23c5a uses `maxPromptTokens - countTokens(helper.prunedCaretWindow, modelName)` with `TOKEN_BUFFER=10`; local subset caps by `maxSnippetPercentage`. | Pure except token counting. `formatOpenedFilesContext` is pure over already-collected opened-file snippets. | None if run over empty payloads. | Yes for 2E-1, but empty payload only. | A | 2E-1 |
| Recently edited ranges | `getSnippetsFromRecentlyEditedRanges`, `AutocompleteInput.recentlyEditedRanges`; VS Code reference `RecentlyEditedTracker`; qwen-coder multifile FIM template | Recent edited line ranges from the IDE input. | `getAllSnippetsWithoutRace` maps input ranges into code snippets; qwen 2E-4 injects only selected recently edited snippets after helper/snippet selection. | `useRecentlyEdited === false` disables collection; filtering later uses `experimental_includeRecentlyEditedRanges`; qwen additionally requires `recentlyEdited.injectIntoPrompt=true` and safe `contextLength`. | Final inclusion token-budgeted by `getSnippets`; qwen prompt injection also checks `contextLength - maxTokens - safetyBuffer >= maxPromptTokens`. | Needs VS Code edit tracker adapter. qwen 2E-2 uses editor event text after guard passes and does not call IDE `readFile`. qwen 2E-4 uses a qwen-owned renderer and does not read more files. | Low if sourced only from editor events and ignore-filtered. | Implemented as opt-in qwen adapter for tracker, payload, selection, diagnostics, and qwen-coder multifile FIM injection. Default remains off. | B | 2E-2 tracker/payload done; 2E-4 prompt injection done |
| Recently opened files | `openedFilesLruCache`, `getSnippetsFromRecentlyOpenedFiles`, `formatOpenedFilesContext` | Contents of recently opened files, excluding current file. | Collected in `getAllSnippetsWithoutRace`; formatted during filtering. qwen 3A collects through a qwen-owned tracker and feeds the existing selection scaffold. | `useRecentlyOpened === false` disables collection; source reads skip empty files; later validation filters empty snippets. qwen adds default-off collection, prefilter/ignore/security guard before reads, sensitive-file skips, and opt-in injection. | `formatOpenedFilesContext` considers up to 10 files, defaults to 5 used, ranks by recency and size, and trims by remaining tokens. | Needs opened-file LRU, bounded file reads, workspace/file access checks. qwen 3A uses VS Code open/active/close listeners and `workspace.fs.readFile` with timeout. | Medium if opened files contain sensitive ignored files. | Implemented as Phase 3A qwen adapter. Default remains off; no opened-file content is logged or persisted. | B | 3A |
| Import definitions | `ContextRetrievalService.getSnippetsFromImportDefinitions`, `ImportDefinitionsService` | Definitions for symbols around cursor that come from imports. | Collected in `getAllSnippetsWithoutRace` after `HelperVars`; qwen 3B collects through a qwen-owned source after helper construction. | `useImports === false` disables; qwen adds default-off collection/injection, bounded prefix parsing, ignore/security guard before target reads, and timeout/cache clamps. | Final inclusion token-budgeted by `getSnippets`; injection also uses qwen contextLength safety gates. | Requires tree-sitter import query or bounded fallback parser, VS Code definition adapter, and range reads. | Medium; can touch source outside current file but still autocomplete-specific. | Implemented as Phase 3B qwen adapter. Default remains off; no import content is logged or persisted. | B | 3B |
| Root path snippets | `ContextRetrievalService.getRootPathSnippets`, `RootPathContextService.getContextForPath` | Definitions related to AST root path around cursor. | Collected in `getAllSnippetsWithoutRace` after `HelperVars`; qwen 3C computes AST path only when rootPath is enabled. | Program node primes/uses import definitions and does not emit arbitrary snippets; non-program whitelisted nodes use root-path query plus guarded definition/range reads. | Final inclusion token-budgeted by `getSnippets`; injection also uses qwen contextLength safety gates. | Requires AST path, tree-sitter root-path queries, VS Code definition adapter, and range reads. | Medium; autocomplete-specific but cross-file. | Implemented as Phase 3C qwen adapter when AST/query support is available; otherwise fail closed. | B | 3C |
| Recently visited ranges | `AutocompleteInput.recentlyVisitedRanges`; VS Code reference `RecentlyVisitedRangesService` | Recent visible editor ranges from other files. | Passed through `getAllSnippetsWithoutRace` from helper input. | Filtering uses `experimental_includeRecentlyVisitedRanges`; reference service excludes current file and Continue output channel. | Final inclusion token-budgeted by `getSnippets`. | Needs selection-change tracker and file reads. | High because upstream TODO notes recently visited ranges can include terminal/output windows if visible. | Defer until leakage handling is explicit. | C | Later context/security phase |
| Clipboard context | `getClipboardSnippets`, `isValidClipboardSnippet`, `experimental_includeClipboard` | Current clipboard text and copy timestamp. | `getAllSnippetsWithoutRace` collects clipboard snippets unconditionally, but final inclusion is controlled by filtering/options. | Filtering includes clipboard only when `experimental_includeClipboard` is truthy and rejects snippets older than 5 minutes. | Final inclusion token-budgeted by `getSnippets`. | Requires IDE clipboard access. | High privacy risk. | Defer for qwen-direct despite source-confirmed collection path. | C | Later explicit opt-in phase |
| Static context | `ContextRetrievalService.getStaticContextSnippets`, `StaticContextService` | Static TypeScript contextual snippets. | Collected only when `experimental_enableStaticContextualization` is true. | Gated by experimental option. Needs separate security review. | Final inclusion token-budgeted by `getSnippets`. | Requires static analysis helpers, workspace scanning, type definition/signature help, and range reads. | High; broad source scanning and complex adapter surface. | Defer. | C | Later high-risk phase |
| Diff snippets | `getDiffSnippets`, `experimental_includeDiff` | Git diff snippets. | Source function exists, but both `getAllSnippets` and `getAllSnippetsWithoutRace` currently use `[]` instead of calling it. | Disabled in source path with comment referencing Continue PR 5882. | Would be token-budgeted by `getSnippets` if enabled. | Would require diff cache. | Medium to high due size and source-disabled status. | Do not enable early. | C | Deferred unless upstream re-enables |
| IDE snippets | `getIdeSnippets`, `IDE_SNIPPETS_ENABLED=false` | IDE/LSP definitions found by provider-specific definition function. | Source path exists, but disabled by `IDE_SNIPPETS_ENABLED=false`. | If enabled, `onlyMyCode` filters to workspace dirs. | Final inclusion token-budgeted by `getSnippets`. | Requires `getDefinitionsFromLsp` adapter. | Medium. | Do not enable early because current upstream disables it. | C | Deferred unless source path changes |
| Continue Chat/QA/codebase retrieval | Non-autocomplete Continue systems | Chat/codebase retrieval context. | Outside autocomplete provider lifecycle. | Not applicable. | Not applicable. | Chat/RAG/indexing services. | High and out of scope. | Do not port. | D | Never in qwen autocomplete parity |
| ChipMate RAG, `semantic_search`, `codebase_analysis` | ChipMate Chat/Agent/RAG tooling | QA or agent evidence. | Outside qwen-direct autocomplete lifecycle. | Not source-equivalent to Continue autocomplete snippets. | Not applicable. | RAG/CodeGraph/search systems. | High and out of scope. | Do not reuse unless a future source-first audit proves equivalence. | D | Never by default |

## Continue Autocomplete vs Chat and RAG Boundaries

Continue autocomplete context selection is local to the inline completion provider
pipeline. The source-confirmed autocomplete path uses `HelperVars`, snippet
payloads, snippet filtering, prompt templating, and autocomplete-specific IDE
adapters.

It is not the same as Continue Chat, QA, slash commands, docs indexing, or
general codebase retrieval. ChipMate RAG, `semantic_search`, `codebase_analysis`,
Agent, Chat, and CodeGraph systems must remain outside qwen-direct autocomplete
unless a later source-first audit proves a specific autocomplete-equivalent
mapping. No such proof exists in Phase 2E-0.

## Phase 2E-1 Boundary

Phase 2E-1 must be pure scaffolding only:

- Port qwen-owned snippet payload types equivalent to Continue's
  `SnippetPayload` and `AutocompleteSnippet*` types.
- Port or wrap pure `getSnippets`/`isValidSnippet`/token-budget selection logic.
- Use empty payload arrays for every source.
- Do not call `getAllSnippetsWithoutRace`.
- Do not instantiate or call `ContextRetrievalService`.
- Do not read recently edited ranges.
- Do not read recently opened files.
- Do not read import definitions.
- Do not read root path context.
- Do not read clipboard.
- Do not read static context.
- Do not change qwen request body, FIM template, cache behavior, filters,
  postprocess, range, or render behavior.

Because the payload is empty, Phase 2E-1 should be semantically neutral for
autocomplete output except for explicit tests proving that the scaffold does not
change current behavior.

## Clipboard Finding

Continue's `getAllSnippetsWithoutRace` collects clipboard data by calling
`ide.getClipboardContent()` and returning a clipboard snippet with `content`,
`copiedAt`, and type `clipboard`. However, collection is not the same as final
prompt inclusion. `getSnippets` includes clipboard snippets only when
`experimental_includeClipboard` is truthy, and `isValidSnippet` rejects clipboard
items older than 5 minutes.

For qwen-direct, clipboard context is deferred because the default observability
and benchmark posture requires redaction and source/privacy minimization. A
future clipboard phase must be explicit opt-in and must prove no clipboard text
is logged or persisted.

## Recently Opened Files Finding

Continue stores opened files in `openedFilesLruCache` with max size 20. The
collector excludes the current file, reads candidate files in parallel, and uses
an 80 ms per-file timeout. `formatOpenedFilesContext` later ranks and trims the
already-collected snippets against the remaining prompt token budget.

Phase 3A implements this source as a qwen-owned adapter:

- Default settings register no listeners, seed no documents, store no paths,
  create no payloads, and inject no snippets.
- Tracking is active only when `chipmate.autocomplete.enabled=true`,
  `chipmate.autocomplete.provider=qwen-direct`, and
  `chipmate.autocomplete.qwen.context.recentlyOpened.enabled=true`.
- The tracker listens to opened documents, active-editor changes, and closed
  documents; active-editor events update recency, and close events remove paths.
- File reads are memory-only, parallel, bounded by
  `recentlyOpened.fileReadTimeoutMs` default `80`, and skip empty, failed, or
  timed-out reads.
- qwen prefilter plus ignore/security guard run before file content is read;
  guard errors fail closed.
- Ignored, sensitive, non-file, unsupported, and current files are skipped.
- Injection is separately gated by
  `recentlyOpened.injectIntoPrompt=true`, valid `contextLength`, and prompt
  budget safety.
- If recently edited and recently opened injection both provide the same
  filepath, qwen intentionally dedupes at injection time by preferring recently
  edited content. This differs from Continue's selection priority, where
  recently opened is processed before recently edited.

## Current Local Subset Differences

| Finding | Upstream eaa23c5a behavior | Local subset behavior | Audit action |
|---|---|---|---|
| `DEFAULT_AUTOCOMPLETE_OPTS.maxPromptTokens` | `1024` | `2048` in `packages/chipmate-vscode/src/services/autocomplete/continuedev/core/util/parameters.ts` | Treat upstream as source of truth for future parity decisions; do not change in Phase 2E-0. |
| Snippet token budget | `maxPromptTokens - countTokens(helper.prunedCaretWindow, modelName)` | Caps remaining tokens by `maxSnippetPercentage` in local `filtering.ts`. | Document as local subset difference; Phase 2E-1 must decide explicitly whether qwen follows upstream eaa23c5a or the local subset adapter. |
| `getAllSnippetsWithoutRace` | Used by upstream provider before prompt rendering. | Present in local subset and old classic adapter. | qwen-direct 2E-1 must not call it; later phases may source-map individual collectors. |
| Old classic `getProcessedSnippets` | Not qwen source of truth. | Imports `getAllSnippetsWithoutRace`, `ContextRetrievalService`, and old `VsCodeIde`. | Reference only; do not reuse or re-enable for qwen-direct. |

## Phase 2E Revised Plan

### Phase 2E-1: Pure Snippet Selection Scaffolding

Continue source behavior:

- `getSnippets(helper, payload)` orders and token-budgets already-collected
  snippet payloads.
- Snippet validation rejects empty snippets, stale clipboard snippets, and
  Continue output-channel snippets.

ChipMate/qwen-direct adapter:

- Add qwen-owned snippet payload/types and pure selection helper.
- Feed only empty payloads.
- Do not call any collector.
- Keep qwen diagnostics redacted if selection metrics are added.

Semantic difference:

- Temporary and intentional: no real context source is enabled.

Tests required:

- Empty payload returns no snippets.
- Empty scaffold leaves provider output and qwen request body unchanged.
- `getAllSnippetsWithoutRace`, clipboard, opened-file reads, import definitions,
  root path, static context, and trackers are not called.
- No `/chipmate/fim`, `/chipmate/edit`, or `/v1/chat/completions`.

Risk: Low.

### Phase 2E-2: Recently Edited Ranges

Continue source behavior:

- `getSnippetsFromRecentlyEditedRanges` maps `helper.input.recentlyEditedRanges`
  to code snippets when `useRecentlyEdited !== false`.
- Final inclusion is controlled by `experimental_includeRecentlyEditedRanges`
  and token budget selection.

ChipMate/qwen-direct adapter:

- Added a qwen-owned VS Code edit tracker and input adapter.
- Collection is default-off and zero-collection when disabled. No
  `onDidChangeTextDocument` listener is registered unless
  `chipmate.autocomplete.enabled=true`,
  `chipmate.autocomplete.provider=qwen-direct`, and
  `chipmate.autocomplete.qwen.context.recentlyEdited.enabled=true`.
- Apply qwen prefilter and ignore/security guard before edited line text is
  read into memory. Guard errors fail closed.
- Keep data in memory only; no disk persistence and no source content logs.
- Feed recently edited payloads through qwen's Phase 2E-1 snippet selection
  scaffold.
- Do not inject selected snippets into the qwen FIM prompt in 2E-2.
- Phase 2E-4 later injects selected recently edited snippets only when
  `recentlyEdited.injectIntoPrompt=true` and `contextLength` is safe.

Semantic difference:

- Adapter unavoidable because qwen-direct does not use Continue's VS Code
  extension runtime. qwen uses editor event text after guard passes instead of
  the Continue test-harness `ide.readFile` path.
- Prompt injection was deferred until Phase 2E-4, where qwen-direct added a
  qwen-coder-only multifile FIM adapter rather than generic Continue templates.

Tests required:

- Tracker bounds, stale range removal, ignored/sensitive file filtering,
  zero-listener disabled behavior, dispose lifecycle, token-budget selection,
  redacted diagnostics, and byte-for-byte unchanged FIM prompt/request body.

Risk: Medium.

### Phase 2E-4: Recently Edited qwen-coder Multifile FIM Injection

Continue source behavior:

- qwen-coder multifile FIM compiles selected snippets into repository/file
  sections before the current-file FIM hole.
- Prompt rendering returns a rendered prefix used by cache put.
- Context length comes from Continue `ILLM.contextLength`.

ChipMate/qwen-direct adapter:

- Add explicit `chipmate.autocomplete.qwen.contextLength`; `0` means unknown and
  blocks injection.
- Add `chipmate.autocomplete.qwen.context.recentlyEdited.injectIntoPrompt`; default
  `false`.
- Inject only selected recently edited snippets and only through the qwen-coder
  multifile FIM renderer.
- Keep inactive/blocked prompt and HTTP request body byte-for-byte unchanged.
- If qwen adapter pruning still exceeds the context budget, block injection and
  fall back unchanged instead of dropping individual snippets.

Semantic difference:

- qwen-direct does not port generic Continue `renderPromptWithTokenLimit` or
  model-template dispatch.
- qwen-direct uses a safety fallback when the active prompt remains too large
  after pruning; this is a qwen adapter, not full generic renderer parity.

Tests required:

- Golden full prompt string, unchanged inactive/blocked prompt and request body,
  context-length gating, rendered-prefix cache put, diagnostics redaction, and
  forbidden import/source scans.

Risk: Medium.

### Phase 3A: Recently Opened Files

Continue source behavior:

- `openedFilesLruCache` stores up to 20 file URIs.
- Collector excludes current file and reads candidates with an 80 ms per-file
  timeout.
- `formatOpenedFilesContext` ranks and trims snippets by recency, size, and
  remaining tokens.

ChipMate/qwen-direct adapter:

- Added qwen-owned opened-file LRU and bounded read adapter.
- Preserves read timeout with setting default `80` ms.
- Adds qwen prefilter plus ignore/security filtering before reads.
- Updates recency on active editor changes and removes closed files.
- Keeps collection and injection as separate opt-in settings.

Semantic difference:

- Security adapter is required because qwen-direct must not read ignored or
  sensitive files.
- Same-file injection dedupe prefers recently edited content over opened-file
  content as a qwen/ChipMate adapter deviation from Continue's opened-before-edited
  selection order.

Tests required:

- Current file exclusion, max entries, read timeout, ignored file exclusion,
  empty file skip, token trimming, no persistence, no logs with source content.
- Active editor recency update, closed-file removal, collection-only unchanged
  prompt/request body, blocked unknown context length, active injection, cache
  interaction, diagnostics redaction, and forbidden path isolation.

Risk: Medium.

### Phase 3B/3C: Import Definitions and Root Path Context

Continue source behavior:

- Import definitions use tree-sitter import queries, workspace membership checks,
  LSP `gotoDefinition`, and `readRangeInFile`.
- Root path snippets require `helper.treePath`, tree-sitter root-path queries,
  LSP definitions, language ignore patterns, and range reads.

ChipMate/qwen-direct adapter:

- Phase 3B adds a qwen-owned import definitions source with memory-only cache,
  bounded import parsing, VS Code definition lookup, guarded range reads, and
  count-only diagnostics.
- Import parsing prefers local tree-sitter/query infrastructure. If unavailable,
  a minimal bounded include/import parser is used only as qwen/ChipMate adapter
  behavior; it still uses definition lookup and range reads and does not scan
  whole files.
- Phase 3C adds a qwen-owned root path source. AST path and root-path queries
  run only when the source is enabled.
- Program AST nodes only prime/use import definitions and do not generate
  arbitrary snippets. Non-program whitelisted nodes use root-path-context query
  plus definition lookup and guarded range reads.
- Keep adapters qwen-owned and isolated from old autocomplete runtime.

Semantic difference:

- VS Code `vscode.executeDefinitionProvider` is a qwen/ChipMate adapter for
  Continue `IDE.gotoDefinition`.
- HelperVars still keeps `treePath` undefined by default; root path computes AST
  path inside the enabled source adapter instead of changing the default helper
  lifecycle.
- Injection-time source priority is qwen/ChipMate adapter behavior:
  recentlyEdited, recentlyOpened, importDefinitions, rootPath.

Tests required:

- Disabled zero work, bounded parse scope, cache clamp, non-file/sensitive skip,
  guard fail-closed, definition normalization, failed/empty/timeout reads, root
  path program-node behavior, whitelisted node handling, collection-only
  unchanged prompt/request body, active injection, cache interaction, diagnostics
  redaction, and forbidden path isolation.

Risk: Medium to High.

### Deferred Context

Clipboard, recently visited ranges, static context, diff snippets, and IDE
snippets remain deferred until explicit future phases. They must not be enabled
implicitly by Phase 2E-1.

## Validation Commands

Run from `packages/chipmate-vscode` after this audit document is written:

```bash
bun test tests/unit/qwen-autocomplete.test.ts tests/unit/qwen-autocomplete-manifest.test.ts tests/unit/autocomplete-runtime-isolation.test.ts
bun test tests/unit/qwen-autocomplete-benchmark.test.ts
bun test tests/unit/qwen-autocomplete-diagnostics.test.ts
bun test tests/unit/qwen-autocomplete-helpervars.test.ts
bun test tests/unit/qwen-autocomplete-cache.test.ts
bun run typecheck
bun run lint
```

Do not run a real endpoint benchmark for Phase 2E-0.

## Phase 3D Hardening Note

Phase 3D does not add a new context source. It hardens selection, formatting,
budgeting, diagnostics, and cache behavior for the sources that already exist:

- recently edited ranges
- recently opened files
- import definitions
- root path snippets

Continue source behavior reviewed for this pass:

- `core/autocomplete/templating/filtering.ts`
- `core/autocomplete/templating/formatOpenedFilesContext.ts`
- `core/autocomplete/templating/validation.ts`
- `core/autocomplete/snippets/getAllSnippets.ts`
- `core/autocomplete/CompletionProvider.ts`

The qwen selector keeps Continue's collection priority documented, but qwen
prompt injection uses a deterministic adapter priority:

```text
recentlyEdited -> recentlyOpened -> importDefinitions -> rootPath
```

This differs from Continue's selected-snippet processing order and exists so
the rendered qwen multifile FIM prompt prefers the freshest edited range for a
same-file conflict. Collection and selection diagnostics still preserve raw
per-source counts before injection-time dedupe.

Caret-window duplicate filtering remains source-mapped only for base-like
snippets: import definitions and root path snippets. It is not applied to
recently edited or recently opened snippets.

Recently opened formatting follows Continue intent:

- consider at most 10 recent files
- target up to 5 retained files
- rank by recency and size when trimming is needed
- reduce retained count if budget cannot satisfy `minTokensInSnippet=125`
- prune retained snippet content from the bottom

If an active qwen multifile FIM prompt still exceeds the explicit qwen context
budget after adapter pruning, qwen blocks injection and falls back unchanged.
This is a qwen/ChipMate safety adapter deviation from Continue
`renderPromptWithTokenLimit`, which prunes prefix/suffix and rebuilds.

Forbidden sources remain out of scope and must stay empty/non-collected:
clipboard, static context, recently visited ranges, diff snippets, and IDE
snippets.

## Phase 5A Non-Streaming Filter Note

Phase 5A does not add or enable any context source. It hardens the existing
qwen-direct non-streaming filter/postprocess path after `choices[0].text` is
received and before render/cache. The allowed context sources remain only:

- recently edited ranges
- recently opened files
- import definitions
- root path snippets

Production qwen-direct autocomplete remains `/v1/completions` with
`stream:false`. Continue `CompletionStreamer`, `GeneratorReuseManager`,
streaming `fullStop`, clipboard, static context, recently visited ranges, diff
snippets, and IDE snippets remain unimplemented.

## Phase 5B/5C Multiline And Security Note

Phase 5B/5C does not add or enable any context source. It hardens display
classification and safety gates for already implemented qwen-direct sources.

Continue source behavior used:

- `core/autocomplete/classification/shouldCompleteMultiline.ts`
- `core/autocomplete/constants/AutocompleteLanguageInfo.ts`
- `core/autocomplete/prefiltering/index.ts`
- `core/util/paths.ts` / `getConfigJsonPath`
- `core/indexing/ignore.ts` / `isSecurityConcern`,
  `DEFAULT_SECURITY_IGNORE_*`, and `defaultFileAndFolderSecurityIgnores`

qwen-direct keeps these decisions separate:

- prefilter decision, including exact Continue config path, unsupported
  language/extension, and empty-document reasons;
- current-file request guard, including security-concern, workspace, ignore,
  scheme, and fail-closed error reasons;
- context-read guard, used before recently opened/import definition/root path
  target content is read.

qwen-direct remains a narrower C/C++ provider-scope adapter. Unsupported
language/extension blocking is not full Continue language parity. Workspace
containment and `.chipmateignore`/`.gitignore` checks are stricter qwen/ChipMate
adapter behavior and are kept separate from Continue `isSecurityConcern`
mapping.
