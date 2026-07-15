# qwen-direct Phase 3D Offline Validation

Phase 3D hardens existing qwen-direct autocomplete context selection. It does
not add new context sources.

## Included

- recently edited range snippets
- recently opened file snippets
- import definition snippets
- root path snippets
- source-aware selection diagnostics
- injection-time same-file dedupe
- recently opened formatting and trimming diagnostics
- cache lookup/put invariant checks

## Excluded

- clipboard context
- static context
- recently visited ranges
- diff snippets
- IDE snippets
- streaming
- `CompletionStreamer`
- `GeneratorReuseManager`
- persistent SQLite cache
- generic Continue template system

## Pre-Gate Result

Before Phase 3D changes, run the 3B/3C targeted tests:

```bash
bun test tests/unit/qwen-autocomplete-import-definitions.test.ts
bun test tests/unit/qwen-autocomplete-root-path.test.ts
bun test tests/unit/qwen-autocomplete-snippets.test.ts
bun test tests/unit/qwen-autocomplete-prompt-rendering.test.ts
bun test tests/unit/qwen-autocomplete-diagnostics.test.ts
bun test tests/unit/qwen-autocomplete-cache.test.ts
bun test tests/unit/qwen-autocomplete-manifest.test.ts
bun test tests/unit/autocomplete-runtime-isolation.test.ts
```

Phase 3D should only be considered valid if this pre-gate passes. Root path is
implemented in the current baseline; if `rootPathBlockedReason` appears during
manual testing, treat root path as blocked for that request only.

## Settings Modes

Configure a connected openai-compatible provider with the exact `qwen-coder-30b0` model, then select it through the unified autocomplete settings. Provider authentication remains in ChipMate SecretStorage.

### Default unchanged

```json
{
  "kilo-code.new.autocomplete.provider": "<connected-provider-id>",
  "kilo-code.new.autocomplete.model": "qwen-coder-30b0",
  "kilo-code.new.autocomplete.enableAutoTrigger": true,
  "kilo.autocomplete.qwen.context.recentlyEdited.enabled": false,
  "kilo.autocomplete.qwen.context.recentlyOpened.enabled": false,
  "kilo.autocomplete.qwen.context.importDefinitions.enabled": false,
  "kilo.autocomplete.qwen.context.rootPath.enabled": false,
  "kilo.autocomplete.qwen.contextLength": 0
}
```

Expected:

- no context collection
- no snippet injection
- normal single-file qwen FIM
- `snippetsInjectedIntoPrompt=false`
- `promptPreview=null`

### Collection only

Enable one or more context sources, but leave every `injectIntoPrompt` setting
false.

Expected:

- payload and selected counts may be greater than zero
- HTTP request body remains unchanged
- prompt remains single-file qwen FIM
- cache put uses the non-injection qwen adapter behavior

### Injection active

Use only after confirming qwen-coder context length.

```json
{
  "kilo.autocomplete.qwen.contextLength": 32768,
  "kilo.autocomplete.qwen.context.recentlyEdited.enabled": true,
  "kilo.autocomplete.qwen.context.recentlyEdited.injectIntoPrompt": true,
  "kilo.autocomplete.qwen.context.recentlyOpened.enabled": true,
  "kilo.autocomplete.qwen.context.recentlyOpened.injectIntoPrompt": true,
  "kilo.autocomplete.qwen.context.importDefinitions.enabled": true,
  "kilo.autocomplete.qwen.context.importDefinitions.injectIntoPrompt": true,
  "kilo.autocomplete.qwen.context.rootPath.enabled": true,
  "kilo.autocomplete.qwen.context.rootPath.injectIntoPrompt": true
}
```

Expected:

- `promptRendererMode=qwen-multifile-fim` when selected snippets survive budget
- `snippetSelectionInjectedSources` lists only injected sources
- same-file entries appear once in the rendered prompt
- no prompt, snippet content, source content, endpoint host, API key, or full path
  appears in diagnostics

## Diagnostics To Check

Key aggregate fields:

- `snippetSelectionTotalPayloadCount`
- `snippetSelectionTotalSelectedCount`
- `snippetSelectionDroppedByBudgetCount`
- `snippetSelectionDroppedDuplicateFileCount`
- `snippetSelectionDroppedInvalidCount`
- `snippetSelectionInjectedCount`
- `snippetSelectionInjectedSources`
- `snippetSelectionAdapterPriority`
- `snippetSelectionBudgetRemaining`
- `recentlyOpenedFormattedCount`
- `recentlyOpenedTrimmedCount`
- `baseSnippetSelectedCount`
- `baseSnippetInjectedCount`

The qwen injection priority is:

```text
recentlyEdited -> recentlyOpened -> importDefinitions -> rootPath
```

This is qwen/Kilo adapter behavior. Continue's selection order is different and
is documented in the parity ledger.

## Failure Signs

- `promptPreview` is not `null`.
- Diagnostics include source text, snippets, full prompt, full paths, endpoint
  host, `Authorization`, or API key.
- Collection-only mode changes the request body.
- `contextLength=0` still injects snippets.
- Duplicate same-file entries appear in a rendered qwen multifile prompt.
- `/kilo/fim`, `/kilo/edit`, or `/v1/chat/completions` appears in runtime
  request logs.

## Budget Fallback

If active qwen multifile FIM rendering still exceeds the explicit qwen context
budget after adapter pruning, qwen blocks injection and falls back unchanged.
This is a qwen/Kilo safety adapter deviation from Continue
`renderPromptWithTokenLimit`, which prunes prefix/suffix and rebuilds. Do not
interpret this fallback as exact generic Continue renderer parity.

## What To Send Back

Send:

- settings mode
- language/file type
- cursor position
- expected vs actual ghost text
- whether Tab accepted
- `requestId`
- redacted diagnostics export

Do not send API keys, full source files, full prompts, snippet content, endpoint
host, or full absolute paths.
