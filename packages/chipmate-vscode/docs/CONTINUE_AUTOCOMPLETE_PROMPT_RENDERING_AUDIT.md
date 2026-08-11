# Continue Autocomplete Prompt Rendering Audit

Phase: 2E-3

Source of truth: `continuedev/continue@eaa23c5a9de86049dff765f635c18f61d1d043bb`

This audit is documentation-only. It does not change qwen-direct runtime
behavior, prompt construction, request bodies, cache behavior, filtering,
postprocess, range rendering, Chat, Agent, RAG, CodeGraph, `semantic_search`,
`codebase_analysis`, the old autocomplete runtime, `/chipmate/fim`, `/chipmate/edit`,
or `/v1/chat/completions`.

## Inspected Sources

| Area | Source |
|---|---|
| Provider lifecycle | [`core/autocomplete/CompletionProvider.ts`](https://raw.githubusercontent.com/continuedev/continue/eaa23c5a9de86049dff765f635c18f61d1d043bb/core/autocomplete/CompletionProvider.ts) |
| Prompt rendering | [`core/autocomplete/templating/index.ts`](https://raw.githubusercontent.com/continuedev/continue/eaa23c5a9de86049dff765f635c18f61d1d043bb/core/autocomplete/templating/index.ts) |
| Model templates | [`core/autocomplete/templating/AutocompleteTemplate.ts`](https://raw.githubusercontent.com/continuedev/continue/eaa23c5a9de86049dff765f635c18f61d1d043bb/core/autocomplete/templating/AutocompleteTemplate.ts) |
| Snippet filtering | [`core/autocomplete/templating/filtering.ts`](https://raw.githubusercontent.com/continuedev/continue/eaa23c5a9de86049dff765f635c18f61d1d043bb/core/autocomplete/templating/filtering.ts) |
| Snippet formatting | [`core/autocomplete/templating/formatting.ts`](https://raw.githubusercontent.com/continuedev/continue/eaa23c5a9de86049dff765f635c18f61d1d043bb/core/autocomplete/templating/formatting.ts) |
| Stop tokens | [`core/autocomplete/templating/getStopTokens.ts`](https://raw.githubusercontent.com/continuedev/continue/eaa23c5a9de86049dff765f635c18f61d1d043bb/core/autocomplete/templating/getStopTokens.ts) |
| Token safety buffer | [`core/llm/countTokens.ts`](https://raw.githubusercontent.com/continuedev/continue/eaa23c5a9de86049dff765f635c18f61d1d043bb/core/llm/countTokens.ts) |
| qwen-direct current behavior | `packages/chipmate-vscode/src/services/qwen-autocomplete/**` |

The local Continue subset contains readable `AutocompleteTemplate.ts` and
`filtering.ts`, but it does not contain the full upstream `CompletionProvider.ts`
or `templating/index.ts`. Those were inspected from the upstream commit above.

## Continue Rendering Lifecycle

Continue `CompletionProvider.provideInlineCompletionItems` does the relevant
autocomplete work in this order:

1. Prepare autocomplete LLM and autocomplete options.
2. Apply security-concern file blocking.
3. Apply debounce unless forced.
4. Create `HelperVars`.
5. Run prefiltering.
6. Collect snippet payload and workspace dirs.
7. Call `renderPromptWithTokenLimit({ snippetPayload, workspaceDirs, helper, llm })`.
8. Use the returned `prompt`, rendered `prefix`, rendered `suffix`, and
   `completionOptions`.
9. Lookup cache with `cache.get(helper.prunedPrefix)`.
10. Generate on cache miss, then optionally postprocess.
11. Build `AutocompleteOutcome`.
12. Store non-cache outcomes with `cache.put(outcome.prefix, outcome.completion)`.

This means snippets enter the final prompt before cache lookup and before the
network request. The rendered `prefix` returned by prompt rendering is also part
of the eventual cache put path.

## Continue Snippet Selection And Rendering

`renderPromptWithTokenLimit` delegates setup to `preparePromptContext`:

- `prefix` starts as `helper.input.manuallyPassPrefix || helper.prunedPrefix`.
- `suffix` starts as `""` when manually passing prefix, otherwise
  `helper.prunedSuffix`.
- Empty suffix is normalized to `"\n"`.
- `reponame` is derived from the first workspace dir or `"myproject"`.
- `getTemplateForModel(helper.modelName)` selects the model template unless a
  custom template option exists.
- `getSnippets(helper, snippetPayload)` chooses the final selected snippets.

`buildPrompt` then does one of two things:

- If the template has `compilePrefixSuffix`, it lets the template compile
  selected snippets into prefix/suffix.
- Otherwise, it formats snippets as comments and prepends them to the prefix.

For qwen-coder, upstream `getTemplateForModel` chooses
`qwenMultifileFimTemplate` when the lowercased model includes both `qwen` and
`coder`. That template has `compilePrefixSuffix`, so qwen-coder snippets are not
inserted through the generic comment-formatting path.

## qwen-coder Multifile FIM Template

Continue `qwenMultifileFimTemplate` behavior:

- If no snippets are selected, return the original `prefix` and `suffix`.
- If snippets exist, compute shortest unique relative paths for all selected
  snippet filepaths plus the current filepath.
- Render selected snippets as repository-level context:
  - `<|repo_name|>{reponame}`
  - repeated `<|file_sep|>{relativePath}\n{snippet.content}`
  - current file marker with `<|file_sep|>{currentRelativePath}`
- Insert an internal separator:
  `<|system_separator_istruction_repository_level|>`.
- Final prompt keeps qwen FIM markers around the current file hole:
  `<|fim_prefix|>{currentPrefix}<|fim_suffix|>{suffix}<|fim_middle|>`.

The resulting rendered prefix is different from raw `helper.prunedPrefix` when
snippets are selected. This is the main reason qwen-direct cannot keep using the
current `helper.prunedPrefix` cache-put adapter once snippet injection is active.

## Token Limit And Context Length

Continue `renderPromptWithTokenLimit` uses `llm.contextLength` to compute the
maximum allowed rendered prompt size:

```text
safetyBuffer = min(1000, contextLength * 0.02)
reservedCompletionTokens = llm.completionOptions.maxTokens ?? DEFAULT_MAX_TOKENS
maxAllowedPromptTokens = contextLength - reservedCompletionTokens - safetyBuffer
```

It counts tokens for the rendered prompt. If the prompt is too large, it
proportionally drops tokens from the pre-render prefix and suffix, then rebuilds
the prompt.

qwen-direct currently does not have a source-mapped Continue `ILLM` object or
trusted `contextLength`. It only has qwen request output `maxTokens` and Phase 2C
input prompt budgeting (`maxPromptTokens`, `prefixPercentage`,
`maxSuffixPercentage`). Therefore qwen-direct must not infer a context length
from the endpoint or model name.

Phase 2E-4 must add an explicit setting:

```text
chipmate.autocomplete.qwen.contextLength = 0
```

`0` means unknown. Unknown context length must disable snippet injection.

Even when `contextLength > 0`, injection must remain disabled unless:

```text
availablePromptTokens = contextLength - maxTokens - min(1000, contextLength * 0.02)
availablePromptTokens >= maxPromptTokens
```

Here `maxTokens` is the generation output token setting
`chipmate.autocomplete.qwen.maxTokens`, and `maxPromptTokens` is the Phase 2C prompt
input budget. This ensures context length covers generation output tokens,
Continue-style safety buffer, and the minimum qwen prompt budget before snippets
can be injected.

## Current qwen-direct Behavior

Before Phase 2E-4, qwen-direct provider behavior was:

- Builds HelperVars and selected snippets.
- Selected snippets were diagnostics-only.
- Builds prompt with:
  `buildQwenFimPrompt({ prefix: helper.prunedPrefix, suffix: helper.prunedSuffix })`.
- Emitted `snippetsInjectedIntoPrompt=false`.
- Sends only the configured `/v1/completions` request body.
- Keeps cache lookup at `cache.get(helper.prunedPrefix)`.
- Stored successful completions with `cache.put(helper.prunedPrefix,
  processed)`.

Phase 2E-4 changes this only when recently edited prompt injection is explicitly
enabled and safe:

- Inactive and blocked paths still call the old `buildQwenFimPrompt` directly.
- Active paths use `renderQwenMultifileFimPromptWithTokenLimit` for qwen-coder
  multifile FIM.
- Only selected recently edited snippets can be injected.
- No other context source is read or injected.

qwen-direct still does not use:

- `renderPromptWithTokenLimit`
- generic Continue template rendering
- `AutocompleteOutcome.prefix`
- opened/import/root/clipboard/static/recently visited snippets

This is intentional after Phase 2E-4 because qwen-direct ports only the
qwen-coder multifile FIM rendering behavior, not the generic Continue template
system.

## Cache Interaction

Continue cache behavior around prompt rendering:

| Step | Continue behavior |
|---|---|
| Lookup | `cache.get(helper.prunedPrefix)` |
| Rendered prompt | `renderPromptWithTokenLimit` returns `prompt`, rendered `prefix`, rendered `suffix` |
| Put | `cache.put(outcome.prefix, outcome.completion)` |
| `outcome.prefix` source | Rendered prefix returned by prompt rendering |

qwen-direct stores with this adapter when injection is inactive, blocked, or
falls back:

```text
cache.put(helper.prunedPrefix, processed)
```

When 2E-4 activates qwen-coder multifile FIM snippet injection, the rendered
prefix can include repository context and `<|file_sep|>` sections. In that
active-injection path, qwen-direct cache put uses the rendered prefix:

```text
cache.put(renderedPrefix, processed)
```

Cache lookup should remain source-mapped to Continue:

```text
cache.get(helper.prunedPrefix)
```

This keeps lookup parity while making cache storage reflect the actual rendered
prompt prefix used to produce the completion. The inactive/blocked fallback
`helper.prunedPrefix` put behavior remains a qwen adapter.

## Phase 2E-4 Implementation

Phase 2E-4 implements only a qwen-owned qwen-coder multifile FIM rendering
adapter. It does not port the generic Continue template system.

### Settings

Added:

```text
chipmate.autocomplete.qwen.contextLength = 0
chipmate.autocomplete.qwen.context.recentlyEdited.injectIntoPrompt = false
```

Semantics:

- `recentlyEdited.enabled=true` only means collection and selection are enabled.
- Prompt injection additionally requires
  `recentlyEdited.injectIntoPrompt=true`.
- Injection also requires a valid `contextLength` that satisfies the safety
  formula above.
- Defaults keep qwen prompt and HTTP request body byte-for-byte unchanged.

### Renderer Adapter

Added `renderQwenMultifileFimPromptWithTokenLimit` and
`buildQwenPromptPlan` with these constraints:

- Source-map only Continue qwen-coder multifile FIM behavior.
- Use only selected recently edited snippets.
- Preserve qwen FIM markers:
  `<|fim_prefix|>`, `<|fim_suffix|>`, `<|fim_middle|>`.
- Preserve repository markers:
  `<|repo_name|>`, `<|file_sep|>`, and
  `<|system_separator_istruction_repository_level|>`.
- Do not support Codestral, StarCoder, Mercury, generic Handlebars templates, or
  model-template dispatch.
- Do not collect or inject opened files, imports, root path snippets, clipboard,
  static context, recently visited ranges, Chat, RAG, Agent, CodeGraph,
  `semantic_search`, or `codebase_analysis`.
- qwen adapter safety fallback: if the active prompt still exceeds token budget
  after source-mapped prefix/suffix pruning and rebuild, qwen-direct blocks
  injection and falls back to the old single-file prompt. This differs from
  generic Continue `renderPromptWithTokenLimit`, which returns the rebuilt
  prompt, and must not be claimed as full generic renderer parity.

### Provider Integration

When injection is inactive or unsafe:

- Keep current `buildQwenFimPrompt` behavior.
- Keep request body byte-for-byte unchanged.
- Keep `snippetsInjectedIntoPrompt=false`.
- Keep cache put as the current adapter.
- Completely bypass `renderQwenMultifileFimPromptWithTokenLimit`.

When injection is active and safe:

- Use qwen-coder multifile FIM renderer output for prompt.
- Report `snippetsInjectedIntoPrompt=true`.
- Keep endpoint contract `/v1/completions`.
- Use rendered prefix for cache put.
- Keep final postprocess, filtering, range, render, and selectedCompletionInfo
  behavior unchanged.

### Diagnostics

Add redacted/count-only fields:

```text
contextLength
availablePromptTokens
promptRendererMode
snippetInjectionBlockedReason
renderedPrefixChars
renderedSuffixChars
renderedPromptChars
estimatedRenderedPromptTokens
recentlyEditedInjectIntoPrompt
snippetsInjectedIntoPrompt
```

Do not log snippet content, full prompt, full source, full paths, API keys,
Authorization headers, or endpoint hosts.

### Tests

Required tests:

- Defaults keep FIM prompt byte-for-byte unchanged.
- Defaults keep HTTP request body byte-for-byte unchanged.
- `recentlyEdited.enabled=true` alone does not inject snippets.
- `recentlyEdited.injectIntoPrompt=true` with `contextLength=0` does not inject.
- `contextLength > 0` but insufficient for `maxTokens`, safety buffer, and
  `maxPromptTokens` does not inject.
- Valid `contextLength` plus both recently edited settings injects only selected
  recently edited snippets.
- Golden prompt test asserts the complete qwen-coder multifile FIM prompt string,
  including all newlines and marker order.
- Rendered prefix is used for cache put only when injection is active.
- Active prompt that remains over budget after qwen adapter pruning falls back
  unchanged and does not drop individual snippets.
- Diagnostics are redacted and content-free.
- Forbidden imports and systems remain absent:
  `getAllSnippetsWithoutRace`, `ContextRetrievalService`, opened/import/root/
  clipboard/static/recently visited context, ChipMate RAG, `semantic_search`,
  `codebase_analysis`, Chat, Agent, CodeGraph, old runtime, `/chipmate/fim`,
  `/chipmate/edit`, `/v1/chat/completions`.

## Phase 2E-4 Validation Plan

Run from `packages/chipmate-vscode` after this doc-only audit:

```bash
bun test tests/unit/qwen-autocomplete.test.ts tests/unit/qwen-autocomplete-manifest.test.ts tests/unit/autocomplete-runtime-isolation.test.ts
bun test tests/unit/qwen-autocomplete-benchmark.test.ts
bun test tests/unit/qwen-autocomplete-diagnostics.test.ts
bun test tests/unit/qwen-autocomplete-helpervars.test.ts
bun test tests/unit/qwen-autocomplete-cache.test.ts
bun test tests/unit/qwen-autocomplete-snippets.test.ts
bun test tests/unit/qwen-autocomplete-recently-edited.test.ts
bun test tests/unit/qwen-autocomplete-prompt-rendering.test.ts
bun run typecheck
bun run lint
bun run package
```

Do not run a real endpoint benchmark for Phase 2E-4.
