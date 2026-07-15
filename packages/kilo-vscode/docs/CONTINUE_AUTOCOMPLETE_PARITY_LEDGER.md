# Continue Autocomplete Parity Ledger

Phase: 2D-0 Continue autocomplete parity audit, updated by Phase 2C HelperVars/token budget parity and Phase 2D AutocompleteLruCache parity

This document audits the current qwen-direct autocomplete implementation against Continue autocomplete source behavior. It is the parity ledger for staged autocomplete-only runtime changes and does not imply snippets/context retrieval, streaming, or old runtime reactivation.

Phase 2C replaced the qwen-direct HelperVars-lite prompt pruning path with a qwen-owned Continue source-mapped HelperVars/token budget adapter. It still does not implement cache, snippets/context retrieval, streaming, `CompletionStreamer`, `GeneratorReuseManager`, old runtime activation, or old `/kilo/fim`/`/kilo/edit` paths.

Phase 2D ports the source-confirmed `AutocompleteLruCache` prefix/completion matching semantics into a qwen-owned in-memory adapter. It still does not implement SQLite persistence, `GeneratorReuseManager`, `CompletionStreamer`, streaming, document.version/model/config hash keys, backward deletion reuse, or old runtime activation.

Phase 3A ports Continue recently opened file autocomplete context into a qwen-owned VS Code tracker and bounded read adapter. It is default-off, memory-only, excludes current/ignored/sensitive files, keeps collection separate from injection, and does not enable import/root/clipboard/static/recently visited context.

Phase 3B/3C ports Continue import definitions and root path autocomplete context into qwen-owned adapters. Both are default-off, memory-only, bounded by timeout/cache settings, use guarded definition/range reads, and inject snippets only through the existing explicit qwen-coder multifile FIM gates.

Phase 5A hardens qwen-direct non-streaming filter/postprocess parity. It keeps production qwen autocomplete on `/v1/completions` with `stream:false`, maps feasible Continue stream filters into a structured full-response filter result, preserves the compatibility `filterQwenCompletion` wrapper, and documents every `fullStop`-dependent behavior as qwen/Kilo non-streaming truncation or rejection rather than exact streaming parity.

Phase 5B/5C hardens multiline classification and security/prefilter gating. Multiline follows the actual upstream `shouldCompleteMultiline` source, including the selectedCompletionInfo behavior where code returns `true` even though the source comment says single-line. Security and prefilter remain separate diagnostic stages: current-file request guard, context-read guard, and prefilter decision each keep their own reason fields.

## Source Baseline

| Source | Commit / path | Use in this audit |
|---|---|---|
| Continue upstream | `continuedev/continue@eaa23c5a9de86049dff765f635c18f61d1d043bb` | Source of truth for current Continue autocomplete provider, LRU cache, streaming, generator reuse, helper vars, snippets, filtering, postprocess, and ignore/security behavior. |
| Local Continue subset | `packages/kilo-vscode/src/services/autocomplete/continuedev/core/autocomplete/**` | Local copy for HelperVars, prefix/suffix, tokenizer helpers, snippets/context, postprocess, line stream filters, language metadata, ignore/security checks, and test harness services. |
| Local old autocomplete runtime | `packages/kilo-vscode/src/services/autocomplete/classic-auto-complete/**` | Previous Kilo/Continue-style VS Code provider. Used only to distinguish old suggestions-history and pending-request behavior from upstream `AutocompleteLruCache`. Must not be re-enabled by this phase. |
| qwen-direct runtime | `packages/kilo-vscode/src/services/qwen-autocomplete/**` | Current isolated qwen-direct provider under audit. |

The local Continue subset does not contain upstream `core/autocomplete/CompletionProvider.ts`, `core/autocomplete/util/AutocompleteLruCache.ts`, `core/autocomplete/generation/CompletionStreamer.ts`, or `core/autocomplete/generation/GeneratorReuseManager.ts`. Those files were inspected from upstream commit `eaa23c5a9de86049dff765f635c18f61d1d043bb`.

## Legend

| Code | Meaning |
|---|---|
| A | Continue original behavior ported directly. |
| B | Necessary Kilo/qwen-direct adapter around Continue behavior. |
| C | Temporary simplification or replacement implemented by us. |
| D | Continue autocomplete capability missing from qwen-direct. |

Allowed recommendations: `Keep`, `Replace with Continue parity`, `Adapter acceptable, document tests`, `Audit further`, `Implement in later phase`, `Do not port, out of autocomplete scope`, `Remove`.

Risk levels: `Low`, `Medium`, `High`, `Blocking`.

## Continue Parity Ledger

| qwen-direct file/function | Current responsibility | Corresponding Continue source path/function/commit | Category | Verbatim equivalent | Semantic equivalent | Difference | Reason | Risk | Recommended action | Later Phase |
|---|---|---|---|---|---|---|---|---|---|---|
| `index.ts` / `registerQwenAutocompleteProvider` | Register isolated qwen provider and qwen diagnostics commands. | Upstream VS Code integration around `CompletionProvider`, plus local old `registerAutocompleteProvider`; commit `eaa23c5a`. | B | No | Partial | Registers qwen-only provider and diagnostics; does not construct Continue `CompletionProvider` or old `AutocompleteServiceManager`. | Kilo/qwen-direct isolation and old runtime safety. | Low | Adapter acceptable, document tests | 2D-0 |
| `index.ts` / `QwenAutocompleteRegistration.sync` | Enable/disable qwen provider based on Kilo qwen settings. | Upstream config-driven provider activation; commit `eaa23c5a`. | B | No | Partial | Uses `kilo.autocomplete` settings and qwen selector instead of Continue config handler. | Kilo settings and VSIX integration. | Low | Adapter acceptable, document tests | 2D-0 |
| `KiloQwenInlineCompletionProvider.provideInlineCompletionItems` | Main qwen request lifecycle. | `core/autocomplete/CompletionProvider.ts` / `provideInlineCompletionItems`; commit `eaa23c5a`. | C | No | Partial | Uses non-streaming `/v1/completions`, local lifecycle, no snippets, no `CompletionStreamer`, no `AutocompleteOutcome`. Phase 2D cache lookup now follows the inspected order after debounce/helper/prompt-built and before qwen request-start. | Phase 1 qwen-direct baseline avoided old runtime and streaming; Phase 2D ports only source-confirmed LRU cache semantics. | High | Replace with Continue parity | 2E/streaming |
| `KiloQwenInlineCompletionProvider.gate` | Enabled, prefilter, cancellation, guard, selectedCompletionInfo validation, debounce. | `CompletionProvider.provideInlineCompletionItems`, `shouldPrefilter`, `isSecurityConcern`, `AutocompleteDebouncer`; commit `eaa23c5a`. | C | No | Partial | qwen gate order differs: local prefilter/guard/selected validation before debounce; upstream security then options then debounce then HelperVars/prefilter. Phase 5C keeps prefilter decision, current-file request guard, and context-read guard reasons separate. | Non-streaming provider adaptation and safety-first bootstrap. | Medium | Audit further | 2D-0/5C |
| `KiloQwenInlineCompletionProvider.start` | Abort previous qwen request and track request identity. | `CompletionStreamer` and `AutocompleteLoggingService` abort controllers; commit `eaa23c5a`. | B | No | Partial | qwen aborts one current non-streaming fetch; upstream cancellation is tied to completion id, logging service, stream generator, and `fullStop`. | `/v1/completions` non-streaming endpoint. | Medium | Adapter acceptable, document tests | 2D-0 |
| `KiloQwenInlineCompletionProvider.fresh` | Reject stale responses by token, abort signal, request id, document version, and cursor. | Upstream token abort check in `CompletionProvider` and streaming cancellation; commit `eaa23c5a`. | C | No | Partial | Upstream inspected source does not show document.version/cursor stale check in cache/reuse path; qwen adds local document/version guard. | Non-streaming full response can arrive after cursor moves. | Medium | Audit further | 2D-0 |
| `KiloQwenInlineCompletionProvider.cancelled` / `empty` | Return empty items with diagnostics. | Upstream returns `undefined` for no completion; commit `eaa23c5a`. | B | No | Yes | qwen returns `[]` for VS Code provider and records diagnostics. | VS Code inline provider contract and observability. | Low | Adapter acceptable, document tests | 2D-0 |
| `KiloQwenInlineCompletionProvider.validSelectedCompletionInfo` | Validate selected completion info before use. | `constructInitialPrefixSuffix` selectedCompletionInfo handling; commit `eaa23c5a`. | C | No | Partial | qwen adds local minimum typed length and `selected.text.startsWith(document text)` validation. | Guard against invalid VS Code selected completion state. | Medium | Audit further | 2D-0 |
| `KiloQwenInlineCompletionProvider.logDone` / `logError` | Legacy console-style short request logging. | `AutocompleteLoggingService`; commit `eaa23c5a`. | C | No | No | qwen has lightweight console log, not Continue logging outcome/accept/display lifecycle. | Bootstrap observability before full parity. | Medium | Replace with Continue parity | Later logging phase |
| `autocompleteLruCache.ts` / `QwenAutocompleteLruCache.get` and `put` | In-memory qwen-owned LRU prefix/completion cache. | `core/autocomplete/util/AutocompleteLruCache.ts` / `get`, `put`; commit `eaa23c5a`. | B | No | Yes for matching | Ports truncation, longest cached prefix search, typed-delta validation, remaining suffix return, timestamp update, capacity eviction, and completion-string value. Does not persist to SQLite. | Kilo/qwen boundary forbids persisting source-derived prefixes/completions to disk in Phase 2D. | Medium | Adapter acceptable, document tests | 2D |
| `autocompleteLruCache.ts` / `truncateSqliteLikePattern` | Source-equivalent prefix truncation before cache lookup/put. | `core/indexing/refreshIndex.ts` / `truncateSqliteLikePattern`; commit `eaa23c5a`. | B | No | Yes | qwen-owned port only; does not import refreshIndex, indexing, SQLite, or old runtime code. | Runtime isolation and no indexing dependency. | Low | Keep | 2D |
| `KiloQwenInlineCompletionProvider.lookupCache` / `putCache` | Wire cache into qwen lifecycle. | `CompletionProvider.provideInlineCompletionItems` cache calls; commit `eaa23c5a`. | B | No | Partial | Lookup uses `cache.get(helper.prunedPrefix)`. Put uses rendered prefix only when Phase 2E-4 qwen multifile injection is active; otherwise it keeps the qwen adapter `cache.put(helper.prunedPrefix, processed)`. Cache hits still go through qwen render. | qwen-direct now has qwen-coder rendered prefix only for recently edited injection; generic Continue `AutocompleteOutcome` is still not ported. | Medium | Adapter acceptable, document tests | 2E-4 |
| `AutocompleteDebouncer.delayAndShouldDebounce` | Resolve superseded debounce requests as cancelled. | Upstream `core/autocomplete/util/AutocompleteDebouncer`; commit `eaa23c5a`. | C | No | Partial | qwen resolves replaced promises with `true`; local comment says Continue clears old timeout but does not resolve old promise. | VS Code provider promises must not hang in qwen-direct runtime. | Medium | Adapter acceptable, document tests | 2D-0 |
| `QwenFimClient.complete` | Call configured qwen `/v1/completions` endpoint. | Continue `ILLM.streamFim` / `streamComplete` called by `CompletionStreamer`; commit `eaa23c5a`. | B | No | Partial | qwen uses direct fetch, OpenAI-compatible completions JSON, `stream: false`, no chat fallback. | Company internal qwen endpoint. | Medium | Adapter acceptable, document tests | 2D-0 |
| `QwenFimClient.headers` | Add optional Authorization header. | Continue provider-specific LLM auth. | B | No | Partial | qwen reads Kilo setting API key and sends bearer header. | qwen-direct endpoint auth. | Low | Adapter acceptable, document tests | 2D-0 |
| `QwenFimClient.parseJson` / `record` / `responseSummary` | Parse qwen completion response safely. | Provider-specific LLM response handling in Continue. | B | No | Partial | qwen only accepts `choices[0].text`; explicitly disables chat/completions fallback. | Endpoint contract safety. | Medium | Adapter acceptable, document tests | 2D-0 |
| `fimTemplates.ts` / `buildQwenFimPrompt` | Build qwen FIM prompt. | Upstream qwen/coder FIM prompt source at commit `eaa23c5a`; local template subset has Mercury/Codestral in `AutocompleteTemplate.ts`. | B | No | Yes for qwen format | Directly emits `<\|fim_prefix\|>prefix<\|fim_suffix\|>suffix<\|fim_middle\|>`; no snippets/file separators. | qwen-direct single request body. | Medium | Adapter acceptable, document tests | 2E |
| `qwenMultifileFimRenderer.ts` / `buildQwenPromptPlan` and `renderQwenMultifileFimPromptWithTokenLimit` | Gate and render qwen-coder multifile FIM prompt for selected recently edited and recently opened snippets. | `core/autocomplete/templating/index.ts` / `renderPromptWithTokenLimit`; `core/autocomplete/templating/AutocompleteTemplate.ts` / `qwenMultifileFimTemplate`; commit `eaa23c5a`. | B | No | Partial | Inactive/blocked paths bypass the multifile renderer and call old `buildQwenFimPrompt`. Active path uses qwen-coder repo/file/FIM markers and rendered prefix. qwen adapter safety fallback blocks injection if the rebuilt prompt remains over budget instead of returning an oversized rebuilt prompt. | qwen-direct has no generic Continue `ILLM`, no generic template dispatch, and requires explicit `contextLength`; fallback is a safety adapter and not full generic renderer parity. | Medium | Adapter acceptable, document tests | 2E-4/3A |
| `fimTemplates.ts` / `getContinueAutocompleteStopTokens` | Return qwen-coder effective stop tokens. | `core/autocomplete/templating/AutocompleteTemplate.ts` qwen template-local stops plus `core/autocomplete/templating/getStopTokens.ts` common stops; commit `eaa23c5a`. | B | No | Yes for qwen-coder effective list | Flattens qwen template-local stops and Continue common stops (`/src/`, `#- coding: utf-8`, and markdown fence token) into one qwen-direct list; ignores model argument. | Only qwen-coder direct target today, and qwen-direct does not port generic `getStopTokens` dispatch. | Low | Adapter acceptable, document tests | 2E-4a |
| `constructPrefixSuffix.ts` / `constructInitialPrefixSuffix` | Build full prefix/suffix, including `selectedCompletionInfo.text`. | Local `continuedev/core/autocomplete/templating/constructPrefixSuffix.ts`; commit `eaa23c5a`. | A | No | Yes | qwen implementation uses VS Code document APIs and omits `injectDetails`. | qwen-direct input is VS Code document, no Continue IDE abstraction. | Low | Keep | 2D-0 |
| `helperVars.ts` / `createQwenAutocompleteHelper` | Build current-file helper vars and Continue-style pruned prefix/suffix. | `core/autocomplete/util/HelperVars.ts` / `HelperVars.create`; commit `eaa23c5a`. | B | No | Partial | Phase 2C now exposes `lang`, `workspaceUris`, `modelName`-driven token pruning, `prunedCaretWindow`, token estimates, and helper parity diagnostics. `treePath` remains `undefined`, and snippets/context retrieval/input/options objects are not fully ported. | Kilo/qwen-direct adapter keeps old runtime, AST, snippets, and context retrieval out of this phase. | Medium | Adapter acceptable, document tests | Later context/AST phase |
| `tokenPruning.ts` / `countTokens` | Count tokens with Continue source-mapped model-aware encoding. | `core/llm/countTokens.ts` / `countTokens`, `encodingForModel`; commit `eaa23c5a`. | A | No | Yes for autocomplete string path | qwen-owned source port imports local llama tokenizer and keeps only autocomplete-needed message/string counting surface. `qwen-coder-30b0` falls through Continue `autodetectTemplateType` to `chatml`, so `encodingForModel` uses llama encoding. | Runtime isolation and qwen-owned helper boundary. | Low | Keep | 2C |
| `tokenPruning.ts` / `pruneLinesFromTop` | Prune prefix lines from top by token budget. | `core/llm/countTokens.ts` / `pruneLinesFromTop`; commit `eaa23c5a`. | A | No | Yes | qwen-owned source port, not old runtime import. | Runtime isolation. | Low | Keep | 2C |
| `tokenPruning.ts` / `pruneLinesFromBottom` | Prune suffix lines from bottom by token budget. | `core/llm/countTokens.ts` / `pruneLinesFromBottom`; commit `eaa23c5a`. | A | No | Yes | qwen-owned source port, not old runtime import. | Runtime isolation. | Low | Keep | 2C |
| `tokenPruning.ts` / `prunePrefixSuffixWithTokenBudget` | Allocate prefix/suffix prompt budget using Continue `HelperVars.prunePrefixSuffix` formula. | `core/autocomplete/util/HelperVars.ts` / `prunePrefixSuffix`; commit `eaa23c5a`. | A | No | Yes | Uses `maxPromptTokens * prefixPercentage` for prefix and `min(maxPromptTokens - countTokens(prunedPrefix), maxSuffixPercentage * maxPromptTokens)` for suffix. | qwen-owned adapter around Continue formula. | Low | Keep | 2C |
| `recentlyOpened.ts` / `QwenRecentlyOpenedTracker` and `snippets` | Track recently opened file paths and read bounded opened-file context. | `core/autocomplete/util/openedFilesLruCache.ts`; `core/autocomplete/snippets/getAllSnippets.ts` / `getSnippetsFromRecentlyOpenedFiles`; commit `eaa23c5a`. | B | No | Partial | Uses qwen-owned VS Code open/active/close listeners and memory-only LRU metadata. Reads tracked files in parallel with bounded per-file timeout, excludes current file, skips empty/failed/timed-out reads, and runs qwen prefilter plus ignore/security guard before content reads. | qwen-direct cannot import Continue IDE/openedFilesLruCache runtime and must add Kilo safety filtering for ignored/sensitive files. | Medium | Adapter acceptable, document tests | 3A |
| `importDefinitions.ts` / `QwenImportDefinitionsTracker` | Collect import definition snippets for symbols near the cursor. | `core/autocomplete/context/ImportDefinitionsService.ts`; `ContextRetrievalService.getSnippetsFromImportDefinitions`; commit `eaa23c5a`. | B | No | Partial | Uses a qwen-owned memory LRU, active-editor warmup, bounded prefix parsing matching Continue includedRanges intent, VS Code definition adapter, and guarded range reads. If tree-sitter import query is unavailable, qwen may use a bounded include/import parser adapter; no whole-file scan. | qwen-direct cannot instantiate Continue context service or IDE facade; C/C++ import query coverage is incomplete locally, so bounded fallback is documented adapter behavior. | Medium | Adapter acceptable, document tests | 3B |
| `rootPathContext.ts` / `QwenRootPathTracker` | Collect root path snippets from AST path nodes. | `core/autocomplete/context/root-path-context/RootPathContextService.ts`; `ContextRetrievalService.getRootPathSnippets`; commit `eaa23c5a`. | B | No | Partial | Computes AST path only when root path context is enabled. Program nodes do not generate arbitrary snippets; non-program whitelisted nodes use root-path-context query, definition lookup, and guarded range reads. Uses memory LRU and returns blocked/empty when AST/query support is unavailable. | qwen-direct keeps HelperVars treePath undefined by default, so root path work is an enabled source adapter instead of generic HelperVars parity. | Medium | Adapter acceptable, document tests | 3C |
| `vscodeDefinitionAdapter.ts` / `lookupQwenDefinitions` and `readQwenRange` | Normalize VS Code definition results and read target ranges. | Continue `IDE.gotoDefinition` and `IDE.readRangeInFile`; commit `eaa23c5a`. | B | No | Partial | Normalizes `Location` and `LocationLink` to filepath/range before callers perform guarded reads. Uses VS Code command API instead of Continue IDE facade. | Required VS Code extension adapter while avoiding old autocomplete runtime and context services. | Medium | Adapter acceptable, document tests | 3B/3C |
| `KiloQwenInlineCompletionProvider.injectable` | Choose selected snippets that may enter qwen multifile prompt. | `core/autocomplete/templating/filtering.ts` / `getSnippets`; commit `eaa23c5a`. | B | No | Partial | Selection still processes recently opened before recently edited like Continue. At injection time only, qwen uses deterministic source priority `recentlyEdited -> recentlyOpened -> importDefinitions -> rootPath` and dedupes same-file snippets. | qwen/Kilo adapter deviation requested for same-file merged injection safety; not exact Continue parity. | Medium | Adapter acceptable, document tests | 3A/3B/3C |
| `streamFilters.ts` / `filterQwenCompletionDetailed` and `filterQwenCompletion` | Apply source-mapped non-streaming filter result before postprocess. | `core/autocomplete/generation/CompletionStreamer.ts`; `core/autocomplete/filtering/streamTransforms/StreamTransformPipeline.ts`; `charStream.ts`; `lineStream.ts`; commit `eaa23c5a`. | B | No | Partial | Ports feasible stream transforms to full-response filtering with stable reason codes and keeps wrapper compatibility. `fullStop()` is represented only as truncation/rejection after the response. Production order remains raw text -> filter -> postprocess -> selectedCompletionInfo validation -> render/range -> cache put. | Internal qwen endpoint is non-streaming for autocomplete because streamed chunks contain empty deltas. | Medium | Adapter acceptable, document tests | 5A |
| `streamFilters.ts` / `stopAtStopTokensText` | Trim text at configured stop tokens. | `charStream.ts` / `stopAtStopTokens`; `templating/getStopTokens.ts`; commit `eaa23c5a`. | B | No | Partial | Done after model response; upstream can stop generation earlier. Markdown fence stop-token behavior is distinct from postprocess fence stripping. | Non-streaming qwen transport. | Medium | Adapter acceptable, document tests | 5A |
| `streamFilters.ts` / `stopAtStartOfText` | Stop if completion starts echoing suffix. | `charStream.ts` / `stopAtStartOf`; commit `eaa23c5a`. | B | No | Partial | Uses the Continue suffix-start matching shape over the full string. It cannot call streaming `fullStop`, so it truncates the returned text. | Non-streaming qwen transport. | Medium | Adapter acceptable, document tests | 5A |
| `streamFilters.ts` / `stopAtLines`, `validatePatternInLine`, `stopAtLinesExact` | Stop at known stop lines and line below cursor. | `lineStream.ts` / `stopAtLines`, `validatePatternInLine`, `stopAtLinesExact`; commit `eaa23c5a`. | B | No | Partial | Source-mapped line validation is applied to the full response. It does not implement streaming cancellation. | Non-streaming qwen transport. | Medium | Adapter acceptable, document tests | 5A |
| `streamFilters.ts` / `stopAtRepeatingLines`, `noDoubleNewLine`, `filterLeadingNewline`, `stopAtSimilarLine` | Stop or trim common bad display output. | `lineStream.ts` functions; commit `eaa23c5a`. | B | No | Partial | Keeps `filterLeadingNewline` limited to skipping only the first blank line; keeps `stopAtSimilarLine` separate from `postprocess.ts` `rewritesLineAbove`. | Non-streaming qwen transport. | Medium | Adapter acceptable, document tests | 5A |
| `streamFilters.ts` / `avoidEmptyComments`, `avoidPathLine`, `skipPrefixes`, `skipLines`, `filterEnglishLinesAtStart`, `filterEnglishLinesAtEnd` | Remove source-mapped bad lines. | `lineStream.ts` functions and constants; commit `eaa23c5a`. | B | No | Partial | `avoidPathLine` requires the current language comment prefix such as `// Path:`. English explanation filtering uses only Continue source phrases, not arbitrary English text. | Non-streaming qwen transport and C/C++ qwen target. | Low | Adapter acceptable, document tests | 5A |
| `postprocess.ts` / `postprocessQwenCompletion` | Final postprocess and reject empty/repetition/markdown leakage. | Local `continuedev/core/autocomplete/postprocessing/index.ts`; commit `eaa23c5a`. | B | No | Partial | Ports core checks but adds qwen3/granite/gemini handling and slightly differs for Mercury prefix overlap. | qwen-direct model compatibility. | Medium | Audit further | 2D-0 |
| `postprocess.ts` / `processQwen3` | Strip qwen3 thinking tags. | No inspected Continue equivalent. | B | No | No | qwen-specific cleanup. | qwen model behavior. | Medium | Adapter acceptable, document tests | 2D-0 |
| `postprocess.ts` / `processGranite`, `processGemini`, `processCodestral`, `processMercury` | Model-specific completion cleanup. | Continue `postprocessCompletion`; commit `eaa23c5a`. | B | No | Partial | Some behaviors match Continue; qwen file carries additional local variants and missing `removePrefixOverlap` for Mercury. | Current qwen-direct compatibility. | Medium | Audit further | 2D-0 |
| `postprocess.ts` / `rewritesLineAbove`, `isExtremeRepetition`, `removeBackticks`, `lineIsRepeated`, `longestCommonSubsequence` | Shared postprocess filters. | Continue `postprocessing/index.ts`, `textSimilarity.ts`, `lcs.ts`; commit `eaa23c5a`. | A | No | Yes | Local copies rather than imports to keep qwen runtime isolated. | Avoid runtime import of old Continue subtree. | Low | Keep | 2D-0 |
| `range.ts` / `zeroWidthRange` | Create insertion range. | VS Code render behavior around Continue completion provider. | B | No | Yes | qwen helper only. | VS Code adapter. | Low | Keep | 2D-0 |
| `range.ts` / `renderQwenInlineCompletionItem` | Render qwen completion into VS Code inline item. | Continue VS Code extension rendering plus `processSingleLineCompletion`; commit `eaa23c5a`. | B | No | Partial | Handles selected completion start, single-line diff replacement, multiline line-end replacement, and `completeBracketPairs`. | Kilo/qwen VS Code adapter. | Medium | Adapter acceptable, document tests | 2D-0 |
| `processSingleLineCompletion.ts` / `processSingleLineCompletion` | Diff current text and model line to choose insert/range. | Continue `processSingleLineCompletion` and VS Code completion provider; commit `eaa23c5a`. | A | No | Yes | Local copy with same rule shape. | Runtime isolation. | Low | Keep | 2D-0 |
| `multiline.ts` / `classifyQwenMultiline`, `shouldCompleteMultilineQwen` | Decide whether qwen may show multiline text. | Upstream `classification/shouldCompleteMultiline.ts` and `AutocompleteLanguageInfo`; commit `eaa23c5a`. | B | No | Partial | Source-maps actual upstream branches: always/never, selectedCompletionInfo returns true, current single-line comment returns false, language `useMultiline` is applied when present, otherwise default true. The upstream comment claiming selectedCompletionInfo should always be single-line conflicts with the code and is documented as a source/comment mismatch. | qwen owns the VS Code helper adapter and supplies language metadata for C/C++, Python, Shell, and Gitea Workflow YAML. | Medium | Adapter acceptable, document tests | 5B |
| `guard.ts` / `decideQwenGuard`, `shouldGuardQwenDocument`, `shouldGuardQwenContextDocument` | Deny current-file requests and context reads for non-file/outside workspace/security/ignored files. | Continue `isSecurityConcern`; `DEFAULT_SECURITY_IGNORE_*`; `defaultFileAndFolderSecurityIgnores`; local old runtime `FileIgnoreController`; commit `eaa23c5a`. | B | No | Partial | Source-maps Continue security concern patterns and keeps `.kilocodeignore`/`.gitignore`, workspace containment, and fail-closed errors as stricter qwen/Kilo adapter behavior. Current-file guard and context-read guard remain separate sources in diagnostics. | Kilo file access safety without importing Continue context services or old provider runtime. | Medium | Adapter acceptable, document tests | 5C |
| `guard.ts` / `controllerFor`, `workspaceRootFor`, `contains` | Cache ignore controllers by workspace. | Old runtime `FileIgnoreController`; local shim. | B | No | Yes | Kilo workspace adapter. | Avoid repeated ignore initialization. | Low | Adapter acceptable, document tests | 2D-0 |
| `prefilter.ts` / `QWEN_DOCUMENT_SELECTOR` | Limit qwen provider to approved file-backed code scopes. | Upstream `shouldPrefilter`, language config, and disabled-language options. | C | No | Partial | Explicitly allows C/C++, Python, `.sh`, and YAML only below `.gitea/workflows`; local non-code exclusions and empty-file filtering remain. | Keep the Qwen request surface explicit and avoid sending arbitrary YAML configuration files. | Medium | Adapter acceptable, document tests | 5C |
| `prefilter.ts` / `decideQwenPrefilter`, `isQwenSupportedDocument`, `shouldPrefilterQwenDocument` | Reject disabled/unsupported/empty docs before request. | Upstream `shouldPrefilter`; `getConfigJsonPath`; commit `eaa23c5a`. | B | No | Partial | Source-maps exact Continue config path prefilter through `getConfigJsonPath` semantics and keeps qwen provider-scope scheme/ext/language rules as adapter behavior. It does not prefilter every project file named `config.json`. Empty-document check avoids full-source reads. | Narrow qwen-direct scope and no old runtime config handler import. | Medium | Adapter acceptable, document tests | 5C |
| `config.ts` / `readQwenAutocompleteConfig` | Read qwen autocomplete settings. | Continue `DEFAULT_AUTOCOMPLETE_OPTS`, config handler, LLM autocomplete options; commit `eaa23c5a`. | B | No | Partial | Kilo settings namespace, direct endpoint/model/apiKey, diagnostics settings. Phase 2C maps `maxPromptTokens=1024`, `prefixPercentage=0.3`, `maxSuffixPercentage=0.2`, `modelTimeout=150`, while `maxTokens` remains output-token request budget. Phase 2D adds `cache.enabled` and clamped `cache.maxEntries`; no TTL. Phase 2E-4 adds explicit `contextLength=0` and `recentlyEdited.injectIntoPrompt=false`. Phase 3A adds default-off `recentlyOpened` settings. Phase 3B/3C add default-off import/root collection/injection settings, bounded timeouts, and cache size clamps. | VSIX and qwen-direct setup; qwen-direct cannot infer Continue `ILLM.contextLength`, so snippet injection stays off until user sets it. | Low | Adapter acceptable, document tests | 2C/2D/2E-4/3A/3B/3C |
| `config.ts` / `qwenAutocompleteEnabled` | Gate provider by enabled/provider. | Continue config/model availability checks. | B | No | Yes | Kilo provider selector. | Kilo settings. | Low | Keep | 2D-0 |
| `types.ts` / qwen config and request types | Define isolated qwen runtime contracts. | Continue `AutocompleteInput`, `AutocompleteOutcome`, `TabAutocompleteOptions`; commit `eaa23c5a`. | B | No | Partial | qwen types are smaller and omit generic outcome/snippets/options fields, but now include qwen prompt renderer mode and snippet-injection blocked reason enums. | Isolated qwen runtime. | Medium | Audit further | 2D-0/2E-4 |
| `diagnostics.ts` / `emitQwenDiagnostic` | Opt-in qwen JSONL lifecycle diagnostics. | No Continue autocomplete capability; related to Kilo offline observability. | B | No | No | Side-channel only; no provider semantics changes allowed. Phase 2D adds redacted cache fields; Phase 2E-4 adds redacted prompt renderer/context length fields. Phase 2E-4a keeps prompt-related content to counts/chars/tokens and fixes `promptPreview` to `null` for qwen diagnostics. Phase 3A adds recently opened fields; Phase 3B/3C add import/root count-only fields. | Offline VSIX manual debug. | Low | Adapter acceptable, document tests | 2B'/2D/2E-4/2E-4a/3A/3B/3C |
| `diagnostics.ts` / redaction helpers and export | Redact endpoint host, apiKey, Authorization-like tokens, prompt/completion previews, paths. | No Continue autocomplete capability. | B | No | No | Kilo security/observability tool. | Offline support. | Low | Adapter acceptable, document tests | 2B' |
| `benchmark.ts` / `runBenchmark`, report helpers, fixture helpers | CLI/test-only qwen benchmark harness. | No Continue autocomplete runtime capability. | B | No | No | Must remain CLI/test-only and must not be imported by runtime activation/provider. Phase 2D keeps cache disabled by default in benchmark mode; cache benchmarking is explicit opt-in and repeat providers are isolated. | Regression and measurement tooling. | Low | Adapter acceptable, document tests | 2A/2D |
| `benchmark.ts` / real-mode validation and redaction | Run real endpoint benchmark with redacted reports. | No Continue autocomplete runtime capability. | B | No | No | External measurement harness only. | Baseline measurement. | Low | Adapter acceptable, document tests | 2A/2B |
| `package.json` / qwen settings and commands | Surface qwen config, diagnostics, benchmark script. | Continue config contribution model, Kilo product manifest. | B | No | Partial | Kilo/ChipMate visible commands and settings namespace. Phase 2D adds cache settings with `cache.enabled=true` and `cache.maxEntries=1000`. | VSIX product integration. | Low | Adapter acceptable, document tests | 2B'/2D |
| `tests/unit/autocomplete-runtime-isolation.test.ts` | Ensure old runtime is not activated. | No Continue capability; Kilo migration safety guard. | B | No | No | Asserts no `AutocompleteServiceManager` activation and old commands are shims. | Prevent old `/kilo/fim` runtime regression. | Low | Keep | 2D-0 |

Function/module ledger counts after Phase 5B/5C: A = 8, B = 31, C = 9, D = 0 in the table above. Missing Continue autocomplete capability gaps are listed separately below as D-class gaps.

Overall audit counts after Phase 5B/5C including missing autocomplete capabilities: A = 8, B = 31, C = 9, D = 16. The out-of-scope Chat/QA/Agent/Edit row is not counted as a D autocomplete gap.

## Phase 2C Changes To Prior C-Class Items

| Prior C-class item | Phase 2C status | Remaining difference | Risk after 2C | Recommendation | Phase |
|---|---|---|---|---|---|
| HelperVars-lite / current-file helper shape | Reduced to B adapter. | `treePath` remains `undefined`; snippets/context retrieval, full `AutocompleteInput`, full `TabAutocompleteOptions`, and AST path are still not ported. | Medium | Adapter acceptable, document tests | Later context/AST phase |
| Approximation token counting | Replaced with Continue source-mapped `countTokens`/`encodingForModel` path. | qwen-owned source port instead of importing the old runtime; qwen-coder uses Continue `chatml` -> llama encoding path. | Low | Keep | 2C |
| Approximate prefix pruning | Replaced with Continue `pruneLinesFromTop` behavior. | None for current autocomplete string path. | Low | Keep | 2C |
| Approximate suffix pruning | Replaced with Continue `pruneLinesFromBottom` behavior. | None for current autocomplete string path. | Low | Keep | 2C |
| qwen-direct prompt char budget defaults | Replaced as default behavior by Continue `maxPromptTokens/prefixPercentage/maxSuffixPercentage`. | `prefixChars`/`suffixChars` remain legacy compatibility settings but no longer drive default HelperVars prompt pruning. | Low | Adapter acceptable, document tests | 2C |

## Phase 2D Changes To Prior D-Class Items

| Prior D-class item | Phase 2D status | Remaining difference | Risk after 2D | Recommendation | Phase |
|---|---|---|---|---|---|
| `AutocompleteLruCache` / cache reuse | Reduced to B adapter. | qwen uses in-memory storage only; upstream SQLite persistence and flush/close lifecycle are intentionally not ported. qwen `put` uses `helper.prunedPrefix` with postprocessed completion because qwen-direct does not yet have Continue `outcome.prefix`. | Medium | Adapter acceptable, document tests | 2D |

## Current Non-Parity / Temporary Implementations

| Temporary implementation | Why it exists | Difference from Continue source | Possible impact | Recommendation | Phase |
|---|---|---|---|---|---|
| AST `treePath` omitted from HelperVars adapter | Phase 2C avoided AST/context retrieval and old runtime activation. | Continue `HelperVars.create` attempts tree path construction when AST is available. | Medium quality/explainability risk for language-structure-aware decisions that later phases may need. | Implement in later phase | Later context/AST phase |
| Full `AutocompleteInput`/`TabAutocompleteOptions` object parity omitted | Phase 2C only mapped prompt budget fields needed by qwen-direct helper. | Continue HelperVars stores richer `input`, `options`, `modelName`, `ide`, and workspace state. | Medium explainability/config parity risk. | Audit further | Later config/context phase |
| Non-streaming-compatible stream filter adapter | qwen endpoint remains `/v1/completions` with `stream: false`; streamed chunks currently contain empty deltas and are unusable for autocomplete text. | Continue filters are async stream transforms and can call `fullStop` to stop generation. Phase 5A maps feasible visible-output behavior to structured post-response truncation/rejection, but it does not stop model generation early. | Medium latency risk remains because bad generations are truncated only after completion. | Keep as documented adapter until streaming text chunks are usable | Streaming phase |
| qwen/Kilo stricter workspace and ignore guard | Needed safety before enabling qwen requests and context reads. | Continue has `isSecurityConcern`; qwen additionally requires workspace containment and `.kilocodeignore`/`.gitignore` access checks through a local shim. | Medium risk of over-blocking valid autocomplete in unusual workspaces, but safer than over-reading. | Adapter acceptable, document tests | 5C |
| Local debouncer adaptation | VS Code provider promises must not hang when superseded. | qwen resolves superseded debounce promises as cancelled; upstream debounce behavior in inspected source is not identical. | Medium latency/control-flow risk. | Adapter acceptable, document tests | 2D-0 |
| qwen provider-scope language support | qwen-direct targets approved C/C++, Python, Shell, and Gitea Workflow files. | Continue has broader `AutocompleteLanguageInfo`; qwen still uses an explicit allowlist and does not claim all-language parity. | Medium risk that unsupported languages or advanced language-specific context remain incomplete. | Adapter acceptable, document tests | 5C |
| qwen-direct stale response check | Non-streaming response may arrive after cursor/document changed. | Upstream inspected cache/reuse source does not show document.version as cache key or reuse guard. | Medium risk of over-rejecting or hiding valid completions, but protects display correctness. | Audit further | 2D-0 |
| qwen-only provider lifecycle | Needed direct qwen endpoint and old runtime isolation. | Continue provider builds options, HelperVars, snippets, prompt render, cache, stream filters, outcome logging in one source pipeline. | High explainability risk because phases do not map 1:1 to Continue. | Replace with Continue parity incrementally | 2C/2D/2E |

## Missing Continue Autocomplete Capabilities

| Capability | In autocomplete scope | Should port | Risk | Suggested phase | Depends on streaming endpoint | Notes |
|---|---|---|---|---|---|---|
| Full tokenizer / token budget parity | Yes | Implemented for qwen-direct current-file HelperVars in 2C; audit further for future context sources | Medium | 2C plus later context audit | No | Phase 2C maps Continue defaults, qwen-coder chatml -> llama tokenizer path, and HelperVars prefix/suffix formula. Future snippets/multi-file context will need another budget audit. |
| `CompletionStreamer` | Yes | Yes, later | High | Streaming phase | Yes | Current qwen endpoint is non-streaming. |
| Full stream filters | Yes | Partial non-streaming adapter implemented in 5A; full streaming remains later | High | Streaming phase | Yes | Phase 5A source-maps feasible visible-output behavior after full response. It still cannot call streaming `fullStop` or stop generation early. |
| `fullStop` | Yes | Yes, later | High | Streaming phase | Yes | Stops model generation, not just displayed text. |
| Streaming cancellation | Yes | Yes, later | High | Streaming phase | Yes | Current qwen uses fetch abort for one non-streaming request. |
| `GeneratorReuseManager` | Yes | Yes, later | High | Streaming phase | Yes | Streaming generator reuse, separate from LRU cache. Current non-streaming qwen-direct should not directly port it. |
| `AutocompleteLruCache` / cache reuse | Yes | Implemented as B adapter in 2D | Medium | 2D complete; audit after prompt rendering parity | No | Source-confirmed prefix/completion semantics are ported in memory. Upstream SQLite persistence is intentionally not ported; qwen `put` uses `helper.prunedPrefix` until `outcome.prefix` parity exists. |
| Snippets/context retrieval | Yes | Yes | High | 2E | No | `getAllSnippetsWithoutRace`, import definitions, root path context, static context. |
| Multi-file context | Yes | Yes | High | 2E | No | Requires prompt render/token budget parity first. |
| LSP definitions | Yes | Yes | Medium | 2E | No | Used by snippets/context service. |
| Import definitions | Yes | Yes | Medium | 2E | No | Continue context capability. |
| Recently edited ranges | Yes | Implemented adapter for tracker, payload, selection, and diagnostics; prompt injection deferred | Medium | 2E-2 plus later prompt rendering parity | No | qwen 2E-2 maps editor event ranges to Continue-style code snippets after qwen prefilter/guard and keeps collection default-off. Selected snippets are not injected into the FIM prompt until Continue prompt rendering parity is ported. |
| Recently visited ranges | Yes | Yes | Medium | 2E | No | Continue snippet source. |
| Recently opened files | Yes | Implemented as B adapter in 3A | Medium | 3A complete; audit after broader context parity | No | Default-off qwen-owned tracker and bounded file reader. Injection is opt-in through the qwen-coder multifile renderer and dedupes same-file opened/edited snippets by preferring edited as a documented qwen/Kilo adapter deviation. |
| Clipboard context | Unknown from inspected source | Audit further | Medium | Later context audit | No | Not confirmed in inspected autocomplete source. |
| Static context | Yes | Yes | Medium | 2E or later | No | Continue experimental static contextualization. |
| Full ignore/security concern parity | Yes | Partially implemented as qwen adapter in 5C | Medium | 5C plus later config parity | No | 5C source-maps Continue security concern patterns and separates prefilter/current-file/context-read reasons. Workspace containment and Kilo ignore are stricter adapters. |
| onlyMyCode / disabled-language behavior | Yes | Audit further | Medium | Later config parity | No | Needs full Continue config option audit. |
| Autocomplete-specific config parity | Yes | Yes | High | 2C/2D/2E | No | `TabAutocompleteOptions`, LLM autocomplete options, model options. |
| Chat, QA, Agent, Edit, webview, UI, slash commands, docs indexing | No | No | Low | None | No | Do not port, out of autocomplete scope. |

## Continue Cache / Reuse Behavior

### AutocompleteLruCache

Continue has `core/autocomplete/util/AutocompleteLruCache.ts` at commit `eaa23c5a9de86049dff765f635c18f61d1d043bb`.

Precise provider calls from inspected `CompletionProvider.ts`:

| Question | Source-confirmed answer |
|---|---|
| Does Continue have `AutocompleteLruCache`? | Yes. |
| Where is lookup performed? | In `CompletionProvider.provideInlineCompletionItems`, after debounce, HelperVars creation, prefiltering, snippets retrieval, and prompt rendering; before streaming/network generation. |
| Exact lookup call | `cache.get(helper.prunedPrefix)`. |
| Exact put call | `cache.put(outcome.prefix, outcome.completion)`. |
| What does the provider pass as lookup input? | `helper.prunedPrefix`. |
| What does the provider pass as put key input? | `outcome.prefix`, which is the rendered prompt prefix returned by `renderPromptWithTokenLimit`, not simply the raw local prefix. |
| Where does truncation happen? | Inside `AutocompleteLruCache`, not in `CompletionProvider`. |
| Internal key transform | `AutocompleteLruCache.get/put` call `truncateSqliteLikePattern(prefix)` on the passed prefix. |
| Internal value | Completion string. |
| Exact hit condition | Exact hit is a special case of longest-prefix match when the truncated query prefix equals a cached key and the cached completion starts with the empty typed delta. |
| Longest-prefix / typed-prefix reuse | `get` finds the longest cached key where `truncatedPrefix.startsWith(key)`, then checks `entry.value.startsWith(truncatedPrefix.slice(key.length))`, and returns the remaining suffix of `entry.value`. |
| Backspace reuse | Not supported by inspected `AutocompleteLruCache` source unless the shorter current prefix still starts with a cached key. The old classic suggestions history has explicit `backward_deletion`, but upstream `AutocompleteLruCache` does not show that same rule. |
| document.version participation | Unknown from inspected source. No document.version appears in inspected `AutocompleteLruCache` key or provider cache calls. |
| How VS Code document.version changes avoid damaging reuse | Unknown from inspected source. |
| When put happens | After a non-cache-hit completion is produced, postprocessed, found non-empty, and an `AutocompleteOutcome` is built. |
| When clear/invalidate happens | Capacity eviction and SQLite close/flush are visible. No explicit file/model/config invalidation was confirmed from inspected source. |
| Relationship to cancellation/stale | If token is aborted after streaming, provider returns before postprocess/outcome/cache put. No document-version stale relationship was confirmed. |
| Raw response, postprocessed text, or rendered completion? | Provider caches `outcome.completion`, after stream accumulation and optional `postprocessCompletion`; it is not raw provider JSON and not a VS Code rendered item. |
| Cross-file | Unknown from inspected source. The key is based on prefix passed to the cache, not an explicit file id. Rendered prompt prefix may include contextual file markers depending on template/context, but no explicit file key was confirmed. |
| Cross-model/config | Unknown from inspected source. No explicit model/config key was confirmed in `AutocompleteLruCache`. |
| Persistence | Upstream cache uses SQLite persistence and periodic flush. This conflicts with qwen-direct's current boundary of not persisting source code to disk. |

### qwen-direct Phase 2D implementation

| Item | qwen-direct behavior |
|---|---|
| Storage | In-memory `QwenAutocompleteLruCache`; no disk persistence, no SQLite, no indexing runtime import. |
| Capacity | Default and upstream-aligned capacity is `1000`; `cache.maxEntries` is clamped to `1..10000` so invalid settings cannot break autocomplete. |
| Lookup order | Existing qwen order remains: config/gate/debounce, HelperVars, prompt-built, then `cache.get(helper.prunedPrefix)`, then qwen `request-start` only on miss. Cache hit does not bypass debounce. |
| Lookup input | `helper.prunedPrefix`, matching the inspected Continue provider call. |
| Put input | Injection inactive/blocked/fallback path uses `cache.put(helper.prunedPrefix, processed)` as a qwen adapter. Active Phase 2E-4 recently edited snippet injection uses `cache.put(renderedPrefix, processed)`. Upstream uses `cache.put(outcome.prefix, outcome.completion)` after generic prompt rendering/outcome construction. |
| Cache value | Final nonempty postprocessed completion string before selectedCompletionInfo concatenation and VS Code render. Not raw qwen JSON, not prompt, not rendered `InlineCompletionItem`. |
| Cache hit rendering | Cached text still flows through existing `renderQwenInlineCompletionItem`; if cached rendering fails or throws, qwen falls through to the fresh request path. |
| Non-cacheable outcomes | Disabled, prefiltered, guard-blocked, cancelled, stale, qwen error, empty model response, empty-after-postprocess, render-rejected, and selected-completion-invalid outcomes are not inserted. |
| Benchmark isolation | Phase 2A benchmark keeps cache disabled by default. `--cache true` is explicit opt-in, and current benchmark repeats use fresh provider instances so repeat qwenCalled/latency metrics are not silently polluted. |
| Unsupported by design | No TTL, no document.version/model/endpoint/config hash key, no backward deletion reuse, no `GeneratorReuseManager`, no `CompletionStreamer`, no streaming, no snippets/context retrieval. |

### GeneratorReuseManager

Continue has `core/autocomplete/generation/GeneratorReuseManager.ts` at commit `eaa23c5a9de86049dff765f635c18f61d1d043bb`.

`GeneratorReuseManager` is separate from `AutocompleteLruCache`. It is streaming generator reuse, not LRU cache storage.

| Question | Source-confirmed answer |
|---|---|
| Does Continue have `GeneratorReuseManager`? | Yes. |
| Where is it used? | `CompletionStreamer.streamCompletionWithFilters`. |
| Reuse condition | Existing `pendingGeneratorPrefix + pendingCompletion` starts with the current prefix, and previous prefix length is less than or equal to current prefix length. |
| What is reused? | The current listenable streaming generator and already captured pending completion. |
| Typed-prefix handling | It computes `typedSinceLastGenerator = prefix.slice(pendingGeneratorPrefix.length)` and strips those typed characters from streamed chunks. |
| Backspace behavior | Comment says the length guard prevents reuse for backspace-like cases. |
| Multiline behavior | If not multiline, chunks are cut at the first newline. |
| qwen-direct applicability | Current qwen-direct is non-streaming, so this should not be directly ported until a streaming endpoint phase. |

### Local old classic provider suggestions history

The old Kilo classic provider has a separate in-memory suggestions history in `classic-auto-complete/AutocompleteInlineCompletionProvider.ts` and `inline-utils.ts`.

| Behavior | Source-confirmed answer |
|---|---|
| Lookup timing | Before skip/debounce/request, then again after debounced fetch. |
| Stored entry | `{ text, prefix, suffix }`. |
| Exact hit | `prefix === cached.prefix && suffix === cached.suffix`. |
| Partial typing hit | Current prefix starts with cached prefix, suffix is equal, and cached text starts with the typed delta. |
| Backward deletion hit | Cached prefix starts with current prefix and suffix is equal, returning deleted content plus cached text. |
| qwen-direct applicability | This is old provider behavior and must not be confused with upstream current `AutocompleteLruCache`. |

## Phase 2D Revised Plan

| Implementation item | Continue source behavior | Kilo/qwen-direct adapter | Semantic difference | Tests required | Risk |
|---|---|---|---|---|---|
| Add qwen cache only after Phase 2D-0 approval | Source behavior must come from `AutocompleteLruCache`, not invented keys. | Implemented isolated qwen-owned cache module, no old runtime import. | In-memory only is an unavoidable adapter difference. | Cache disabled/miss/hit/put tests added. | Medium |
| Lookup input | Provider calls `cache.get(helper.prunedPrefix)`. | Implemented after qwen debounce/helper/prompt-built and before qwen network request. | None for lookup input and order. | Cache hit waits debounce and skips qwen request tests added. | Medium |
| Put input | Provider calls `cache.put(outcome.prefix, outcome.completion)`. | Implemented as `cache.put(renderedPrefix, processed)` only when qwen-coder recently edited injection is active; inactive/blocked/fallback remains `cache.put(helper.prunedPrefix, processed)`. | qwen adapter remains because generic Continue `renderPromptWithTokenLimit`/`AutocompleteOutcome.prefix` parity is not ported. | Successful postprocess/render stores; active rendered-prefix and inactive adapter tests added. | Medium |
| Internal matching | Cache internally truncates passed prefix with `truncateSqliteLikePattern` and performs longest-prefix typed-delta matching. | Implemented source-equivalent qwen-owned port. | None for matching. | Exact hit, typed-prefix remaining suffix, mismatch, truncation, and LRU eviction tests added. | Low |
| Backspace behavior | Upstream `AutocompleteLruCache` does not show explicit backward deletion; old classic history does. | No backward deletion behavior implemented. | None. | Negative backward-deletion test added. | Low |
| Persistence | Upstream uses SQLite. | qwen Phase 2D stays in-memory. | Unavoidable adapter difference under current boundary. | No disk/runtime import test added. | Medium |
| Cache key scope | Inspected source does not confirm explicit file/model/config/document.version key. | No file/model/config/document.version hash keys added. | None, because unknowns are not implemented. | Tests follow source-confirmed behavior only. | Medium |
| Cancellation/stale relationship | Upstream avoids postprocess/cache put after token abort. | qwen does not cache cancelled, errored, stale, guard-blocked, empty, or render failure outcomes. | Adapter acceptable for non-streaming stale safety. | Guard/error/empty/stale/render-exception tests added. | Low |
| Generator reuse | `GeneratorReuseManager` is streaming-only and separate from LRU. | Not implemented in non-streaming qwen-direct cache. | None. | Absence/no legacy endpoint tests added or retained. | High |
| Diagnostics | Continue cache is not qwen diagnostics. | Added redacted side-channel cache fields only. | Adapter acceptable. | Redaction/cache diagnostics tests added. | Low |

Phase 2D uses the Phase 2C HelperVars/token budget adapter as its `helper.prunedPrefix` source. It does not invent cache keys, model/config hashes, document.version invalidation, or longest-prefix behavior beyond the source-confirmed `AutocompleteLruCache` semantics above.

## Validation Plan

Run from `packages/kilo-vscode` after this document-only change:

```bash
bun test tests/unit/qwen-autocomplete.test.ts tests/unit/qwen-autocomplete-manifest.test.ts tests/unit/autocomplete-runtime-isolation.test.ts
bun test tests/unit/qwen-autocomplete-benchmark.test.ts
bun test tests/unit/qwen-autocomplete-diagnostics.test.ts
bun test tests/unit/qwen-autocomplete-helpervars.test.ts
bun test tests/unit/qwen-autocomplete-cache.test.ts
bun run typecheck
bun run lint
bun run package
```

No real endpoint benchmark should run for Phase 2D-0.

## Known Limitations

- Phase 2D implemented in-memory `AutocompleteLruCache` parity for source-confirmed prefix/completion matching. It still did not implement snippets/context retrieval, streaming, `CompletionStreamer`, or `GeneratorReuseManager`.
- qwen cache persistence intentionally differs from upstream: no SQLite, no disk writes, and no source-derived prefix/completion persistence.
- qwen cache put uses `helper.prunedPrefix` and the postprocessed completion. Upstream uses `cache.put(outcome.prefix, outcome.completion)`, so this remains an adapter difference until prompt rendering/outcome parity is implemented.
- Phase 2C implemented current-file HelperVars/token budget parity for qwen-direct prompt pruning, but future snippets/multi-file context sources will need another budget parity pass when they are ported.
- Some qwen comments refer to Continue commit `eaa23c5a` sources that are not present in the local Continue subset. Those references are source-verified against upstream commit paths where available.
- `AutocompleteLruCache` cross-file, cross-model, cross-config, and document.version semantics are `Unknown from inspected source`; this document intentionally does not infer missing behavior.
- The local old classic provider's suggestions-history cache is Continue-style historical behavior, but it is not the same as upstream current `AutocompleteLruCache`.

## Phase 3D Selection / Formatting Hardening

Continue source paths used:

- `core/autocomplete/templating/filtering.ts`
- `core/autocomplete/templating/formatOpenedFilesContext.ts`
- `core/autocomplete/templating/validation.ts`
- `core/autocomplete/snippets/getAllSnippets.ts`
- `core/autocomplete/CompletionProvider.ts`

| qwen-direct behavior | Continue source mapping | Classification | Difference / risk | Action |
|---|---|---|---|---|
| Selection stage keeps payload, selected snippets, injectable snippets, and rendered prompt as separate steps. | `getSnippets(helper, payload)` feeds prompt rendering after collection. | B | qwen diagnostics expose extra count-only metadata. Provider semantics stay unchanged unless explicit injection is active. | Adapter acceptable, document tests |
| Continue selection priority is documented as clipboard, recently opened, recently visited, recently edited, diff, base. | `filtering.ts` snippet configs. | A | qwen keeps forbidden sources disabled and empty. | Keep |
| qwen injection priority is `recentlyEdited > recentlyOpened > importDefinitions > rootPath`. | Continue selection order processes recently opened before recently edited and shuffles base snippets. | B | qwen intentionally prefers latest edited ranges and deterministic import/root injection. Do not claim exact Continue priority parity. | Adapter acceptable, document tests |
| Same-file dedupe happens at injection time for rendered qwen multifile FIM prompt. | Continue uses `addedFilepaths` inside selection. | B | qwen preserves per-source collection/selection diagnostics before injection-time dedupe. | Adapter acceptable, document tests |
| Caret-window duplicate filtering applies only to base-like import/root snippets. | Continue filters `[rootPathSnippets, importDefinitionSnippets, staticSnippet]` with `filterSnippetsAlreadyInCaretWindow`. | A | Recently edited/opened snippets are not caret-window filtered. | Keep |
| Recently opened formatting considers up to 10 recent files, targets up to 5, ranks by recency and size when trimming, reduces count under `minTokensInSnippet=125`, and prunes retained content from the bottom. | `formatOpenedFilesContext.ts`. | B | qwen uses qwen tokenizer adapter and reports only counts; no content or full paths. | Adapter acceptable, document tests |
| Import definitions and root path are treated as qwen base-like snippets. | Continue base snippets include root path, import definitions, and static snippets. | B | qwen does not create or inject `staticSnippet`. | Adapter acceptable, document tests |
| Cache lookup remains `cache.get(helper.prunedPrefix)`. | `CompletionProvider.ts`. | A | None. | Keep |
| Cache put uses rendered prefix only when actual injection changes prompt; inactive, blocked, collection-only, or zero-surviving-snippet paths use existing non-injection qwen adapter behavior. | Upstream uses `cache.put(outcome.prefix, outcome.completion)`. | B | qwen does not rely on rendered prefix being equal to helper prefix in fallback modes. | Adapter acceptable, document tests |
| Active qwen multifile FIM injection blocks and falls back unchanged if rebuilt prompt still exceeds budget. | Continue `renderPromptWithTokenLimit` prunes prefix/suffix and rebuilds. | B | qwen/Kilo safety adapter: when rebuilt prompt is still too large, injection is blocked instead of returning an oversize prompt. Do not claim exact Continue renderer parity. | Adapter acceptable, document tests |
| Diagnostics report selection counts, dropped counts, injected count/source names, budget remaining, and opened/base counts. | Not a Continue runtime feature. | B | Count-only, redacted observability; must not affect request/filter/postprocess/render behavior. | Adapter acceptable, document tests |

Phase 3D still does not implement clipboard, static context, recently visited ranges, diff snippets, IDE snippets, streaming, `CompletionStreamer`, `GeneratorReuseManager`, persistent SQLite cache, or the generic Continue template system.
