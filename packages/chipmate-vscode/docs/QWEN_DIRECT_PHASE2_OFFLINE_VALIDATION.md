# qwen-direct Phase 2 Offline Validation

This runbook validates a Phase 2 release-candidate VSIX on an offline machine with a connected openai-compatible provider that exposes the exact `qwen-coder-30b0` model. The extension sends autocomplete through the bundled CLI `/chipmate/qwen-fim` route; do not run the benchmark CLI on the offline machine, and do not install Bun there.

## Phase 2 Scope

Included:

- qwen-direct autocomplete through the shared local CLI connection.
- Continue-style HelperVars, tokenizer, and prompt token budget behavior.
- Continue AutocompleteLruCache-style in-memory autocomplete reuse.
- Redacted qwen-direct autocomplete diagnostics.
- Pure snippet selection scaffolding.
- Recently edited range collection and selection, default off.
- Opt-in qwen-coder multifile FIM prompt injection for recently edited snippets only.
- Phase 3A opt-in recently opened file context collection/selection/injection, default off.
- Phase 3B/3C opt-in import definitions and root path context collection/selection/injection, default off.

Excluded:

- Clipboard, static context, recently visited ranges.
- CompletionStreamer, GeneratorReuseManager, streaming, and generic Continue templates.
- Chat, QA, Agent, RAG, CodeGraph, `semantic_search`, `codebase_analysis`, and old autocomplete runtime.
- `/chipmate/fim`, `/chipmate/edit`, and `/v1/chat/completions`.

## Install The VSIX

Use the VSIX that matches the test machine:

- macOS Apple Silicon: `chipmate-<version>-darwin-arm64.vsix`
- Windows x64 baseline: `chipmate-<version>-win32-x64-baseline.vsix`

Install through the UI:

1. Open VS Code.
2. Open Extensions.
3. Select `...`.
4. Select `Install from VSIX...`.
5. Choose the VSIX file.
6. Reload VS Code when prompted.

Or install through the CLI:

```bash
code --install-extension <path-to-vsix> --force
```

Do not uninstall the previous extension first unless explicitly requested; use upgrade install.

## Required qwen Settings

First configure and connect an openai-compatible provider in ChipMate. Store its authentication through ChipMate SecretStorage and ensure its model list contains the exact ID `qwen-coder-30b0`. Then select that provider through the unified autocomplete settings:

Configure these in the VS Code Settings UI or `settings.json`:

```json
{
  "chipmate-code.new.autocomplete.provider": "<connected-provider-id>",
  "chipmate-code.new.autocomplete.model": "qwen-coder-30b0",
  "chipmate-code.new.autocomplete.enableAutoTrigger": true
}
```

Requirements:

- The selected provider must be connected and use `@ai-sdk/openai-compatible`.
- The provider must expose the exact model ID `qwen-coder-30b0`.
- The provider base URL must support the non-streaming `/completions` operation used by the CLI.
- Do not put an endpoint or API key under `chipmate.autocomplete.*`.
- Do not share API keys in logs, screenshots, chat, or issue comments.

## Diagnostics

Enable diagnostics only while testing:

```json
{
  "chipmate.autocomplete.qwen.trace": true,
  "chipmate.autocomplete.qwen.logLevel": "debug",
  "chipmate.autocomplete.qwen.logPromptPreview": false,
  "chipmate.autocomplete.qwen.logCompletionPreview": true
}
```

Open logs:

1. Command Palette.
2. Run `ChipMate: Show qwen-direct Autocomplete Logs`.
3. Select Output channel `ChipMate qwen-direct autocomplete`.

Export logs:

1. Command Palette.
2. Run `ChipMate: Export qwen-direct Autocomplete Diagnostics`.
3. Save the `.jsonl` file.

Diagnostics must not contain:

- API keys or Authorization headers.
- Endpoint host.
- Full prompt or prompt preview.
- Snippet content.
- Source code.
- Full file paths.

Expected safe fields include:

- `requestId`
- `phase`
- `providerID`
- `transport=cli-qwen-fim`
- `connectionState`
- `httpStatus`
- `pathHash`
- `fullPrefixChars`, `prunedPrefixChars`, `estimatedPromptTokens`
- `snippetTotalCount`, `selectedSnippetCount`
- `recentlyEditedPayloadCount`, `recentlyEditedSelectedCount`
- `recentlyOpenedPayloadCount`, `recentlyOpenedSelectedCount`
- `snippetsInjectedIntoPrompt`
- `promptRendererMode`
- `snippetInjectionBlockedReason`
- `renderedPromptChars`
- `promptPreview: null`

## Settings Modes

### Mode A: Default Unchanged

```json
{
  "chipmate.autocomplete.qwen.context.recentlyEdited.enabled": false,
  "chipmate.autocomplete.qwen.context.recentlyEdited.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.context.recentlyOpened.enabled": false,
  "chipmate.autocomplete.qwen.context.recentlyOpened.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.contextLength": 0
}
```

Expected:

- No recently edited collection.
- No recently opened collection.
- No snippet injection.
- `snippetsInjectedIntoPrompt=false`.
- `promptPreview=null`.
- Normal single-file qwen FIM prompt.

### Mode B: Collection Only

```json
{
  "chipmate.autocomplete.qwen.context.recentlyEdited.enabled": true,
  "chipmate.autocomplete.qwen.context.recentlyEdited.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.context.recentlyOpened.enabled": false,
  "chipmate.autocomplete.qwen.context.recentlyOpened.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.contextLength": 0
}
```

Expected:

- Tracker may collect recently edited ranges.
- Selected snippet count may be greater than zero.
- No injection.
- Request body remains unchanged from single-file qwen FIM mode.
- `promptPreview=null`.

### Mode C: Injection Blocked

```json
{
  "chipmate.autocomplete.qwen.context.recentlyEdited.enabled": true,
  "chipmate.autocomplete.qwen.context.recentlyEdited.injectIntoPrompt": true,
  "chipmate.autocomplete.qwen.context.recentlyOpened.enabled": false,
  "chipmate.autocomplete.qwen.context.recentlyOpened.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.contextLength": 0
}
```

Expected:

- `snippetInjectionBlockedReason=unknown-context-length`.
- `snippetsInjectedIntoPrompt=false`.
- Request body remains unchanged from single-file qwen FIM mode.

### Mode D: Injection Active

Use only after confirming the real qwen-coder context length.

```json
{
  "chipmate.autocomplete.qwen.context.recentlyEdited.enabled": true,
  "chipmate.autocomplete.qwen.context.recentlyEdited.injectIntoPrompt": true,
  "chipmate.autocomplete.qwen.context.recentlyOpened.enabled": false,
  "chipmate.autocomplete.qwen.context.recentlyOpened.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.contextLength": 32768
}
```

Expected:

- `snippetsInjectedIntoPrompt=true`.
- `promptRendererMode=qwen-multifile-fim`.
- `renderedPromptChars` is greater than single-file mode.
- Diagnostics contain no prompt, snippet content, source text, full file path, endpoint host, API key, or Authorization header.
- VS Code ghost text still works.

### Mode E: Recently Opened Collection Only

```json
{
  "chipmate.autocomplete.qwen.context.recentlyOpened.enabled": true,
  "chipmate.autocomplete.qwen.context.recentlyOpened.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.context.recentlyOpened.maxFiles": 20,
  "chipmate.autocomplete.qwen.context.recentlyOpened.fileReadTimeoutMs": 80,
  "chipmate.autocomplete.qwen.contextLength": 0
}
```

Expected:

- Tracker may collect recently opened files after activation.
- Active editor changes update recency; closing a file removes it.
- Request body remains unchanged from single-file qwen FIM mode.
- `recentlyOpenedPayloadCount` and `recentlyOpenedSelectedCount` may be greater than zero.
- `recentlyOpenedInjectedIntoPrompt=false`.
- `promptPreview=null`.

### Mode F: Recently Opened Injection Active

Use only after confirming the real qwen-coder context length.

```json
{
  "chipmate.autocomplete.qwen.context.recentlyOpened.enabled": true,
  "chipmate.autocomplete.qwen.context.recentlyOpened.injectIntoPrompt": true,
  "chipmate.autocomplete.qwen.contextLength": 32768
}
```

Expected:

- `recentlyOpenedInjectedIntoPrompt=true` when selected opened snippets exist.
- `snippetsInjectedIntoPrompt=true`.
- `promptRendererMode=qwen-multifile-fim`.
- Current, ignored, sensitive, empty, failed, and timed-out file reads are skipped.
- Diagnostics contain no opened file content, prompt, snippet content, source text, full path, endpoint host, API key, or Authorization header.

## Manual Scenarios

For every scenario, capture:

- caseId
- file type
- cursor position
- settings mode
- expected
- actual
- did ghost text show
- did Tab accept
- requestId
- screenshot optional

| Case | Setup | Mode | Action | Expected ghost text | Expected diagnostics | Failure signs |
|---|---|---|---|---|---|---|
| 1. Basic return expression | Open a small C/C++ function with a blank return line. | A | Place cursor after indentation and pause. | A short return expression or no suggestion. | `promptRendererMode=disabled`, `snippetsInjectedIntoPrompt=false`, `promptPreview=null`. | Transport is not `cli-qwen-fim`, prompt preview appears, or no lifecycle logs when trace is enabled. |
| 2. If condition completion | Start an `if (` statement in a C/C++ function. | A | Pause after partial condition. | Condition-oriented ghost text may appear. | `multilineAllowed` reflects classifier result and transport is `cli-qwen-fim`. | Markdown fences, special token leakage, or stale response replacing unrelated text. |
| 3. Struct pointer/member completion | Define or reference a struct pointer near cursor. | A | Type `ptr->` and pause. | Member-like suggestion may appear. | `pathHash` present, full path absent. | Full file path or source text appears in diagnostics. |
| 4. Function name partial completion | Type a known function prefix in current file. | A | Pause after partial identifier. | Ghost text completes the remaining suffix without duplicating typed prefix. | `rangePreview` present, `insertFirstLinePreview` may show completion preview only. | Prefix echo or wide range replacement. |
| 5. Comment-to-code generation | Add a short local comment describing a next statement. | A | Pause below the comment. | Code-like suggestion may appear. | `promptPreview=null`, prompt chars/token counts present. | Prompt/source text appears in logs. |
| 6. Suffix brace/paren scenario | Put cursor before existing closing brace or paren. | A | Pause before suffix. | Completion should not duplicate suffix braces. | `suffixChars` and `prunedSuffixChars` are nonzero. | Suffix overlap or broken brace rendering. |
| 7. Recently edited helper used later | Edit a helper in one file, then move to a caller file. | B | Trigger autocomplete near caller logic. | Ghost text remains normal single-file behavior. | `recentlyEditedPayloadCount` or `recentlyEditedSelectedCount` may be greater than zero; `snippetsInjectedIntoPrompt=false`. | Any prompt injection while `injectIntoPrompt=false`. |
| 8. `.env` / ignored file safety | Open an ignored or sensitive file pattern. | B | Edit text and trigger autocomplete. | No qwen request for blocked sensitive content. | Guard or prefilter blocks; no stored source content. | Sensitive text appears in diagnostics or request is sent. |
| 9. Toggle recently edited on/off | Enable Mode B, edit a file, then switch back to Mode A. | A/B | Trigger autocomplete before and after toggle. | Mode A returns to no collection. | Counts reset or stop increasing after disable. | Listener keeps collecting after disable. |
| 10. Toggle injection on/off | Switch between Mode B and Mode D. | B/D | Trigger autocomplete with same cursor. | Injection only in Mode D when all gates pass. | Mode B has `snippetsInjectedIntoPrompt=false`; Mode D may show `true`. | Prompt renderer active when injection is disabled. |
| 11. Unknown contextLength blocked | Use Mode C. | C | Trigger autocomplete after recent edit. | Normal single-file ghost text behavior. | `snippetInjectionBlockedReason=unknown-context-length`, `snippetsInjectedIntoPrompt=false`. | Multifile renderer activates with `contextLength=0`. |
| 12. Valid contextLength injection active | Use Mode D with confirmed context length. | D | Trigger autocomplete after recent edit. | Ghost text still renders and can be accepted. | `promptRendererMode=qwen-multifile-fim`, `snippetsInjectedIntoPrompt=true`, no prompt content logged. | Prompt/snippet/source text appears in diagnostics. |
| 13. Cache hit after repeated prefix | Trigger autocomplete, dismiss, then trigger again at same prefix. | A or D | Repeat the same cursor/prefix. | Second request may be served faster from cache. | `cacheStatus=hit`, `cacheHit=true`, no qwen request-start for hit path. | Cache changes text semantics or crosses files unexpectedly. |
| 14. Large file / long prefix sanity | Open a large C/C++ file. | A | Trigger autocomplete near the end. | Suggestion appears or safely returns empty. | `maxPromptTokens=1024`, token estimates present, no full source logged. | Freeze, huge logs, or full prompt/source in diagnostics. |
| 15. Ghost text still renders | Use normal edit flow in C/C++ file. | A/B/C/D | Accept with Tab when ghost text appears. | Accepted text inserts at expected range. | `return-items` has `itemCount=1` when ghost text is shown. | Item count says one but no ghost text, or accepted range is wrong. |
| 16. Recently opened collection only | Open two C/C++ helper files, switch active editor between them, close one, then trigger autocomplete in a caller file. | E | Trigger autocomplete in caller file. | Ghost text remains normal single-file behavior. | `recentlyOpenedPayloadCount` or `recentlyOpenedSelectedCount` may be greater than zero; closed file should not keep increasing counts; `recentlyOpenedInjectedIntoPrompt=false`. | Listener active in Mode A, closed file still appears in counts, or request body changes in collection-only mode. |
| 17. Recently opened injection active | Open a helper file, then a caller file, and use confirmed context length. | F | Trigger autocomplete in caller file. | Ghost text still renders; opened file context may help only when selected and safe. | `recentlyOpenedInjectedIntoPrompt=true` when selected snippets exist, `promptRendererMode=qwen-multifile-fim`, no opened file content logged. | Prompt/source/snippet text appears in diagnostics, current file is injected as opened context, or ignored/sensitive files are read. |

## Source Sanity Expectations

Default behavior should be unchanged:

- `recentlyEdited.enabled=false`.
- `recentlyEdited.injectIntoPrompt=false`.
- `recentlyOpened.enabled=false`.
- `recentlyOpened.injectIntoPrompt=false`.
- `contextLength=0`.
- No recently edited collection by default.
- No recently opened collection by default.
- No snippet injection by default.
- `snippetsInjectedIntoPrompt=false`.
- `promptPreview=null`.
- Default path uses `buildQwenFimPrompt`.
- Default FIM prompt and HTTP request body remain byte-for-byte unchanged.
- qwen requests use the shared CLI `/chipmate/qwen-fim` route.

Injection requires all gates:

- `chipmate-code.new.autocomplete.enableAutoTrigger=true`.
- `chipmate-code.new.autocomplete.provider` identifies a connected provider.
- `chipmate-code.new.autocomplete.model=qwen-coder-30b0`.
- At least one source-specific collection and injection pair is enabled:
  `recentlyEdited.enabled=true` with `recentlyEdited.injectIntoPrompt=true`,
  or `recentlyOpened.enabled=true` with `recentlyOpened.injectIntoPrompt=true`.
- Model ID is exactly `qwen-coder-30b0`.
- `chipmate.autocomplete.qwen.contextLength > 0`.
- `availablePromptTokens >= maxPromptTokens`.
- Selected injectable snippets exist.

## Rollback Settings

To return to default single-file qwen FIM behavior:

```json
{
  "chipmate.autocomplete.qwen.context.recentlyEdited.enabled": false,
  "chipmate.autocomplete.qwen.context.recentlyEdited.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.context.recentlyOpened.enabled": false,
  "chipmate.autocomplete.qwen.context.recentlyOpened.injectIntoPrompt": false,
  "chipmate.autocomplete.qwen.contextLength": 0,
  "chipmate.autocomplete.qwen.trace": false,
  "chipmate.autocomplete.qwen.logLevel": "off"
}
```

To disable qwen-direct autocomplete entirely:

```json
{
  "chipmate-code.new.autocomplete.enableAutoTrigger": false
}
```

## Known Limitations

- The real smoke diagnostics validates one request, but repeated ghost-text quality still requires target-machine testing.
- Snippet injection is opt-in and recently-edited-only.
- Opened files, imports, root path snippets, clipboard, static context, and recently visited ranges are not included.
- Streaming, CompletionStreamer, and GeneratorReuseManager are not included.
- Chat and QA provider behavior is separate from qwen-direct autocomplete.

## Send Back For Debug

Send only redacted artifacts:

- Exported qwen-direct autocomplete diagnostics `.jsonl`.
- VSIX version and filename.
- Settings mode used: A, B, C, or D.
- Manual scenario caseId.
- Whether ghost text showed.
- Whether Tab accepted.
- Relevant `requestId`.
- Screenshot if useful, with secrets and source-sensitive content hidden.

Do not send:

- API key.
- Authorization header.
- Full endpoint host if sensitive.
- Full prompt.
- Source files.
- Snippet content.
- Full absolute file paths.
