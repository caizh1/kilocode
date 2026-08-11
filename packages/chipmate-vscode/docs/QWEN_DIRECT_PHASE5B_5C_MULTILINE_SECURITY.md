# Qwen Direct Phase 5B/5C Multiline And Security

Phase 5B/5C continues the target of Continue autocomplete / inline completion / tab completion parity minus streaming.

Production qwen-direct autocomplete remains:

```text
/v1/completions
stream: false
```

Streaming remains excluded because the internal qwen endpoint returns SSE and `[DONE]` for `stream=true`, but chunks contain empty `choices[].delta={}` with no `choices[].text` and no `delta.content`.

## Continue Source Paths

Source of truth:

```text
continuedev/continue@eaa23c5a9de86049dff765f635c18f61d1d043bb
```

Inspected files:

- `core/autocomplete/classification/shouldCompleteMultiline.ts`
- `core/autocomplete/constants/AutocompleteLanguageInfo.ts`
- `core/autocomplete/CompletionProvider.ts`
- `core/autocomplete/postprocessing/index.ts`
- `core/autocomplete/filtering/streamTransforms/lineStream.ts`
- `core/autocomplete/prefiltering/index.ts`
- `core/util/paths.ts`
- `core/indexing/ignore.ts`

## Phase 5B Multiline

qwen-direct source-maps the actual upstream `shouldCompleteMultiline` code:

- `multilineCompletions="always"` allows multiline.
- `multilineCompletions="never"` blocks multiline.
- `selectedCompletionInfo` returns true. The upstream comment says selected completion should be single-line, but the code returns true; qwen follows the code and documents the mismatch in the parity ledger.
- A current single-line comment blocks multiline, using language metadata such as `//` for C/C++.
- Language `useMultiline({ prefix, suffix })` applies when available.
- The default fallback is true.

qwen-direct remains a C/C++ provider-scope adapter. Broader Continue language parity is not claimed.

## Phase 5C Security / Prefilter

qwen-direct keeps three reason surfaces separate:

| Surface | Purpose |
|---|---|
| Prefilter decision | Disabled/unsupported/empty/current config file decisions before request. |
| Current-file request guard | Blocks the current file before any qwen request. |
| Context-read guard | Blocks recently opened/import definition/root path target reads before content is read. |

Continue mappings:

- `getConfigJsonPath()` is source-mapped as an exact path rule. A random project `config.json` is not blocked by this prefilter rule.
- `isSecurityConcern` uses Continue `DEFAULT_SECURITY_IGNORE_*` and `defaultFileAndFolderSecurityIgnores`.
- `shouldPrefilter` is mapped where it applies to qwen-direct.

qwen/ChipMate adapter deviations:

- qwen only supports C/C++ and headers in this provider.
- Workspace containment is stricter than generic Continue behavior.
- `.chipmateignore`/`.gitignore` checks are ChipMate adapter behavior.
- Guard exceptions fail closed.
- Context reads share the same safety semantics before source content is read.

## Diagnostics

Multiline diagnostics:

- `multilineClassifierMode`
- `multilineClassifierSource`
- `multilineAllowed`
- `multilineBlockedReason`
- `multilineLanguage`
- `multilineSingleLineComment`
- `multilineSelectedCompletionInfo`
- `multilineUseMultilineApplied`

Security/prefilter diagnostics:

- `guardEnabled`
- `guardDecision`
- `guardReason`
- `guardSource`
- `guardSchemeAllowed`
- `guardWorkspaceAllowed`
- `guardLanguageAllowed`
- `guardIgnored`
- `guardSensitive`
- `guardErrorFailClosed`
- `prefilterDecision`
- `prefilterReason`
- `prefilterLanguage`
- `prefilterExtension`
- `prefilterProviderEnabled`
- `contextReadGuardDecision`
- `contextReadGuardSkippedCount`

Diagnostics must not include prompt text, full completion text, source code, snippet content, full paths, endpoint host, API keys, or Authorization headers. qwen prompt previews remain `null`.

## Still Not Implemented

- streaming
- `CompletionStreamer`
- `GeneratorReuseManager`
- streaming `fullStop`
- clipboard context
- static context
- recently visited ranges
- diff snippets
- IDE snippets
- persistent SQLite cache
- generic Continue template system
