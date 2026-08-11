# qwen-direct Phase 3B/3C Offline Validation

This runbook validates the opt-in import definitions and root path autocomplete context sources on an offline VS Code machine with a connected openai-compatible provider exposing the exact `qwen-coder-30b0` model. Requests use the shared local CLI `/chipmate/qwen-fim` route. Do not run Bun or benchmark CLI commands on the offline machine.

## Scope

Included:

- Phase 3B import definitions context, default off.
- Phase 3C root path snippets context, default off.
- Collection-only diagnostics for both sources.
- Optional qwen-coder multifile FIM injection when context length is explicitly configured and safe.

Excluded:

- Clipboard, static context, recently visited ranges, diff snippets, IDE snippets.
- CompletionStreamer, GeneratorReuseManager, streaming, generic Continue template system.
- Chat, QA, Agent, RAG, CodeGraph, `semantic_search`, `codebase_analysis`, old autocomplete runtime.
- `/chipmate/fim`, `/chipmate/edit`, `/v1/chat/completions`.

## Required Base Settings

Configure and connect the provider in ChipMate first so its authentication is stored in SecretStorage. Do not put a provider endpoint or API key under `chipmate.autocomplete.*`.

```json
{
  "chipmate-code.new.autocomplete.provider": "<connected-provider-id>",
  "chipmate-code.new.autocomplete.model": "qwen-coder-30b0",
  "chipmate-code.new.autocomplete.enableAutoTrigger": true,
  "chipmate.autocomplete.qwen.trace": true,
  "chipmate.autocomplete.qwen.logLevel": "debug",
  "chipmate.autocomplete.qwen.logPromptPreview": false
}
```

Never share API keys, full prompts, full source, or full paths. qwen diagnostics keep `promptPreview=null`.

## Mode A: Default Unchanged

```json
{
  "chipmate.autocomplete.qwen.context.importDefinitions.enabled": false,
  "chipmate.autocomplete.qwen.context.importDefinitions.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.context.rootPath.enabled": false,
  "chipmate.autocomplete.qwen.context.rootPath.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.contextLength": 0
}
```

Expected:

- No import/root collection.
- No definition provider calls caused by qwen context.
- No snippet injection.
- `snippetsInjectedIntoPrompt=false`.
- Normal single-file qwen FIM prompt.

## Mode B: Collection Only

```json
{
  "chipmate.autocomplete.qwen.context.importDefinitions.enabled": true,
  "chipmate.autocomplete.qwen.context.importDefinitions.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.context.rootPath.enabled": true,
  "chipmate.autocomplete.qwen.context.rootPath.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.contextLength": 0
}
```

Expected:

- `importDefinitionsPayloadCount` or `rootPathPayloadCount` may be greater than zero.
- Request body remains unchanged.
- `importDefinitionsInjectedIntoPrompt=false`.
- `rootPathInjectedIntoPrompt=false`.
- No prompt/source/snippet content appears in diagnostics.

## Mode C: Injection Blocked

```json
{
  "chipmate.autocomplete.qwen.context.importDefinitions.enabled": true,
  "chipmate.autocomplete.qwen.context.importDefinitions.injectIntoPrompt": true,
  "chipmate.autocomplete.qwen.context.rootPath.enabled": true,
  "chipmate.autocomplete.qwen.context.rootPath.injectIntoPrompt": true,
  "chipmate.autocomplete.qwen.contextLength": 0
}
```

Expected:

- Collection may happen.
- `snippetInjectionBlockedReason=unknown-context-length`.
- `snippetsInjectedIntoPrompt=false`.
- Request body remains unchanged.

## Mode D: Injection Active

Use only after confirming qwen-coder context length.

```json
{
  "chipmate.autocomplete.qwen.context.importDefinitions.enabled": true,
  "chipmate.autocomplete.qwen.context.importDefinitions.injectIntoPrompt": true,
  "chipmate.autocomplete.qwen.context.rootPath.enabled": true,
  "chipmate.autocomplete.qwen.context.rootPath.injectIntoPrompt": true,
  "chipmate.autocomplete.qwen.contextLength": 32768
}
```

Expected:

- `promptRendererMode=qwen-multifile-fim` when selected snippets exist.
- `snippetsInjectedIntoPrompt=true`.
- `importDefinitionsInjectedIntoPrompt` or `rootPathInjectedIntoPrompt` may be true.
- Diagnostics show counts/tokens/timeouts only.
- VS Code ghost text still renders and accepts normally.

## Safety Checks

- Import parsing is bounded to approximately the first 10,000 bytes / 100 lines.
- Root path program nodes do not generate arbitrary snippets.
- Definition targets are filtered before range reads.
- Sensitive or ignored files should not produce snippets.
- If `rootPathBlockedReason` is not `none`, root path injection should remain inactive.

## What To Send Back

For each manual case, send:

- Settings mode.
- Language/file type.
- Cursor location.
- Expected vs actual ghost text.
- Whether Tab accepted.
- `requestId`.
- Redacted diagnostics export.

Do not send API keys, full source files, full prompts, snippet content, endpoint host, or full absolute paths.

## Phase 3D Additional Diagnostics

Phase 3D does not enable new sources. It only hardens selection and prompt
planning for existing sources.

Expected count-only diagnostics when trace debug is enabled:

- `snippetSelectionEnabled`
- `snippetSelectionTotalPayloadCount`
- `snippetSelectionTotalSelectedCount`
- `snippetSelectionTotalSelectedTokens`
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

The qwen injection priority is deterministic:

```text
recentlyEdited -> recentlyOpened -> importDefinitions -> rootPath
```

Same-file snippets are deduped only when rendering the qwen multifile prompt.
Per-source payload and selected counts should still reflect collection and
selection before injection-time dedupe.

If `recentlyOpenedFormattedCount` is greater than zero, opened-file context was
considered by the selector. If `recentlyOpenedTrimmedCount` is greater than
zero, retained opened snippets were bottom-pruned to fit budget.

If `snippetInjectionBlockedReason=insufficient-context-length`, the request
should stay on the unchanged single-file qwen FIM prompt. qwen blocks injection
when the rebuilt multifile prompt still exceeds budget; this is a qwen/ChipMate
safety adapter and not exact generic Continue `renderPromptWithTokenLimit`
parity.
