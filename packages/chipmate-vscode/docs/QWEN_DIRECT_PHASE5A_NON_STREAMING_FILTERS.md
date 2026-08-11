# Qwen Direct Phase 5A Non-Streaming Filters

Phase 5A hardens qwen-direct autocomplete filter and postprocess behavior while keeping production generation non-streaming.

## Goal

The current target is Continue autocomplete / inline completion / tab completion parity minus streaming.

Production qwen-direct autocomplete remains:

```text
/v1/completions
stream: false
```

The internal endpoint was manually tested with streaming and returned SSE data plus `[DONE]`, but streamed chunks contained empty `choices[].delta={}` with no `choices[].text` and no `delta.content`. Therefore `streamUsableForAutocomplete=false`, and Phase 5A does not implement `CompletionStreamer`, `GeneratorReuseManager`, streaming `fullStop`, or streaming cancellation parity.

## Continue Source Paths

Source of truth:

```text
continuedev/continue@eaa23c5a9de86049dff765f635c18f61d1d043bb
```

Inspected files:

- `core/autocomplete/filtering/streamTransforms/lineStream.ts`
- `core/autocomplete/filtering/streamTransforms/charStream.ts`
- `core/autocomplete/filtering/streamTransforms/StreamTransformPipeline.ts`
- `core/autocomplete/postprocessing/index.ts`
- `core/autocomplete/templating/getStopTokens.ts`
- `core/autocomplete/templating/AutocompleteTemplate.ts`
- `core/autocomplete/generation/CompletionStreamer.ts`
- `core/autocomplete/CompletionProvider.ts`

## Runtime Order

qwen-direct preserves this order:

```text
raw choices[0].text
  -> filterQwenCompletionDetailed / filterQwenCompletion wrapper
  -> postprocessQwenCompletion
  -> selectedCompletionInfo validation
  -> render/range
  -> cache put
```

Rejected filter results do not proceed to render or cache put.

## Source-Mapped Non-Streaming Filters

`filterQwenCompletionDetailed` returns a structured result with redacted diagnostics metadata:

```ts
type QwenNonStreamingFilterResult = {
  text: string
  rejected: boolean
  trimmed: boolean
  reasons: QwenNonStreamingFilterReason[]
  inputChars: number
  outputChars: number
}
```

The compatibility wrapper `filterQwenCompletion(...) => string` remains available for existing callers and tests.

Source-mapped behaviors include:

- stop tokens and qwen/Continue FIM markers
- suffix-start echo truncation from `stopAtStartOf`
- stop lines and exact line-below matches
- repeating-line stop
- empty comment removal
- comment-prefixed path line removal, for example `// Path:`
- Continue skip prefixes and skip lines
- first blank line skipping from `filterLeadingNewline`
- double-newline stop
- English explanation removal using Continue source phrase lists only
- similar line below stop
- trailing whitespace trimming
- markdown fence boundary handling

## qwen/ChipMate Adapter Deviations

Continue stream transforms can call `fullStop()` and stop generation. qwen-direct receives the full non-streaming response, so `fullStop()`-dependent behavior is represented as post-response truncation or rejection only.

Adapter constraints:

- no streaming route
- no `CompletionStreamer`
- no `GeneratorReuseManager`
- no generator reuse
- no streaming cancellation parity
- no new custom autocomplete heuristics
- no arbitrary English filtering
- no broad first-newline truncation
- no arbitrary `Path:` removal without the current language comment prefix

Markdown fences are intentionally handled in two places:

- stream-filter-equivalent logic may stop at fence boundaries
- `postprocessQwenCompletion` may strip leading/trailing code fences and keep usable code

## Diagnostics

Diagnostics are count-only for filters:

- `nonStreamingFilterEnabled`
- `nonStreamingFilterApplied`
- `nonStreamingFilterReasons`
- `nonStreamingFilterInputChars`
- `nonStreamingFilterOutputChars`
- `nonStreamingFilterRejected`
- `nonStreamingFilterTrimmed`
- `nonStreamingFilterStopTokenHit`
- `nonStreamingFilterSimilarLineHit`
- `nonStreamingFilterRepeatingLineHit`
- `nonStreamingFilterMarkdownFenceHit`
- `nonStreamingFilterPathLineHit`
- `nonStreamingFilterAdapterMode`

Diagnostics must not include prompt text, full completion text, snippet content, source code, full paths, endpoint host, API keys, or Authorization headers. qwen prompt previews remain `null`.

## Phase 5B/5C Boundary

Phase 5B/5C keeps the Phase 5A runtime order unchanged:

```text
raw choices[0].text
  -> filterQwenCompletionDetailed / filterQwenCompletion wrapper
  -> postprocessQwenCompletion
  -> selectedCompletionInfo validation
  -> render/range
  -> cache put
```

Multiline classification and security/prefilter decisions are source-mapped in
their own files and do not introduce streaming, `CompletionStreamer`,
`GeneratorReuseManager`, or new context sources. Production qwen-direct
autocomplete remains `/v1/completions` with `stream:false`.

## Still Not Implemented

- streaming
- `CompletionStreamer`
- `GeneratorReuseManager`
- streaming `fullStop`
- streaming cancellation parity
- clipboard context
- static context
- recently visited ranges
- diff snippets
- IDE snippets
- persistent SQLite cache
- generic Continue template system
