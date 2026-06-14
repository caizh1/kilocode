import * as vscode from "vscode"
import { AutocompleteDebouncer } from "./AutocompleteDebouncer"
import {
  emitQwenDiagnostic,
  errorReason,
  type QwenCacheStatus,
  type QwenEmptyReason,
} from "./diagnostics"
import { QwenAutocompleteLruCache, type QwenAutocompleteCache } from "./autocompleteLruCache"
import { getContinueAutocompleteStopTokens } from "./fimTemplates"
import { QwenFimClient } from "./QwenFimClient"
import { readQwenAutocompleteConfig, qwenAutocompleteEnabled } from "./config"
import { shouldGuardQwenDocument, type QwenSafetyGuard } from "./guard"
import { createQwenAutocompleteHelper, type QwenAutocompleteHelperVars } from "./helperVars"
import { shouldCompleteMultilineQwen } from "./multiline"
import { firstLogLine, postprocessQwenCompletion } from "./postprocess"
import { shouldPrefilterQwenDocument } from "./prefilter"
import { buildQwenPromptPlan, type QwenPromptPlan } from "./qwenMultifileFimRenderer"
import { renderQwenInlineCompletionItem } from "./range"
import type { QwenRecentlyEditedSource } from "./recentlyEdited"
import {
  emptyQwenSnippetPayload,
  selectQwenSnippets,
  type QwenAutocompleteCodeSnippet,
  type QwenSnippetPayload,
  type QwenSnippetSelection,
} from "./snippets"
import { filterQwenCompletion } from "./streamFilters"
import { countTokens } from "./tokenPruning"
import type { QwenAutocompleteConfig, QwenRequestInfo } from "./types"

export { QWEN_DOCUMENT_SELECTOR, isQwenSupportedDocument } from "./prefilter"

type Deps = {
  client?: QwenFimClient
  debouncer?: AutocompleteDebouncer
  read?: () => QwenAutocompleteConfig
  guard?: QwenSafetyGuard
  cache?: QwenAutocompleteCache
  edited?: QwenRecentlyEditedSource
  log?: (message: string) => void
}

type Pending = QwenRequestInfo & {
  abort: AbortController
}

type Gate = {
  selected: vscode.SelectedCompletionInfo | undefined
  items?: vscode.InlineCompletionItem[]
}

type CacheResult = {
  hit: boolean
  returned: number | null
  status: QwenCacheStatus
  items?: vscode.InlineCompletionItem[]
}

type SnippetState = {
  payload: QwenSnippetPayload
  recent: QwenAutocompleteCodeSnippet[]
  selection: QwenSnippetSelection
}

export class KiloQwenInlineCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private readonly client: QwenFimClient
  private readonly debouncer: AutocompleteDebouncer
  private readonly read: () => QwenAutocompleteConfig
  private readonly guard: QwenSafetyGuard
  private readonly cache: QwenAutocompleteCache
  private readonly edited?: QwenRecentlyEditedSource
  private readonly log: (message: string) => void
  private current: Pending | null = null
  private seq = 0

  constructor(deps: Deps = {}) {
    this.client = deps.client ?? new QwenFimClient()
    this.debouncer = deps.debouncer ?? new AutocompleteDebouncer()
    this.read = deps.read ?? readQwenAutocompleteConfig
    this.guard = deps.guard ?? shouldGuardQwenDocument
    this.cache = deps.cache ?? new QwenAutocompleteLruCache()
    this.edited = deps.edited
    this.log = deps.log ?? ((message) => console.info(message))
  }

  dispose(): void {
    this.debouncer.dispose()
    this.edited?.dispose()
    this.current?.abort.abort()
    this.current = null
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    const id = this.nextId()
    const lifecycleStarted = Date.now()
    const cfg = this.read()
    const selected = context.selectedCompletionInfo
    this.emit(cfg, { requestId: id, phase: "provider-enter", document, position, selected })
    this.emit(cfg, { requestId: id, phase: "config-read", document, position, selected })
    const gate = await this.gate(cfg, id, document, position, selected, token, lifecycleStarted)
    if (gate.items) return gate.items

    const req = this.start(id, document, position)
    token.onCancellationRequested(() => req.abort.abort())
    const started = Date.now()
    const helper = createQwenAutocompleteHelper(document, position, gate.selected, {
      maxPromptTokens: cfg.maxPromptTokens,
      maxSuffixPercentage: cfg.maxSuffixPercentage,
      modelName: cfg.model,
      prefixPercentage: cfg.prefixPercentage,
    })
    const snippets = this.snippets(cfg, helper)
    const prompt = buildQwenPromptPlan({
      cfg,
      helper,
      snippets: this.recent(snippets),
    })
    const multiline = shouldCompleteMultilineQwen({ helper, position, selected: gate.selected })
    this.emit(cfg, {
      requestId: id,
      phase: "prompt-built",
      document,
      position,
      selected: gate.selected,
      prefixChars: helper.prunedPrefix.length,
      suffixChars: helper.prunedSuffix.length,
      helper,
      ...this.snippetFields(cfg, snippets, prompt),
      multilineAllowed: multiline,
      prompt: prompt.prompt,
    })

    const cached = this.lookupCache(
      cfg,
      id,
      document,
      position,
      context,
      gate.selected,
      started,
      helper,
      multiline,
      snippets,
      prompt,
    )
    if (cached.items) return cached.items

    let httpStatus: number | null = null
    try {
      this.emit(cfg, {
        requestId: id,
        phase: "request-start",
        document,
        position,
        selected: gate.selected,
        prefixChars: helper.prunedPrefix.length,
        suffixChars: helper.prunedSuffix.length,
        helper,
        ...this.cacheFields(cfg, cached.status, cached.hit, helper, cached.returned),
        ...this.snippetFields(cfg, snippets, prompt),
        multilineAllowed: multiline,
      })
      const raw = await this.client.complete({
        endpoint: cfg.endpoint,
        model: cfg.model,
        apiKey: cfg.apiKey,
        prompt: prompt.prompt,
        maxTokens: cfg.maxTokens,
        temperature: cfg.temperature,
        signal: req.abort.signal,
        onResponse: (info) => {
          httpStatus = info.status
        },
      })
      this.emit(cfg, {
        requestId: id,
        phase: "response",
        document,
        position,
        selected: gate.selected,
        prefixChars: helper.prunedPrefix.length,
        suffixChars: helper.prunedSuffix.length,
        helper,
        ...this.cacheFields(cfg, cached.status, cached.hit, helper, cached.returned),
        ...this.snippetFields(cfg, snippets, prompt),
        httpStatus,
        latencyMs: Date.now() - started,
        rawTextLength: raw.length,
        multilineAllowed: multiline,
        completion: raw,
      })
      if (!this.fresh(req, document, position, token)) {
        this.emit(cfg, {
          requestId: id,
          phase: "stale",
          document,
          position,
          selected: gate.selected,
          stale: true,
          latencyMs: Date.now() - started,
          rawTextLength: raw.length,
          helper,
          ...this.cacheFields(cfg, cached.status, cached.hit, helper, cached.returned),
          ...this.snippetFields(cfg, snippets, prompt),
          emptyReason: "stale",
        })
        return this.empty(cfg, id, document, position, gate.selected, started, "stale", helper, snippets, prompt)
      }
      const filtered = filterQwenCompletion({
        completion: raw,
        suffix: helper.prunedSuffix,
        stopTokens: getContinueAutocompleteStopTokens(cfg.model),
        helper,
        position,
        multiline,
      })
      const processed = postprocessQwenCompletion({
        completion: filtered,
        model: cfg.model,
        prefix: helper.prunedPrefix,
        suffix: helper.prunedSuffix,
      })
      this.emit(cfg, {
        requestId: id,
        phase: "postprocess",
        document,
        position,
        selected: gate.selected,
        prefixChars: helper.prunedPrefix.length,
        suffixChars: helper.prunedSuffix.length,
        helper,
        ...this.cacheFields(cfg, cached.status, cached.hit, helper, cached.returned),
        ...this.snippetFields(cfg, snippets, prompt),
        rawTextLength: raw.length,
        filteredTextLength: filtered.length,
        finalTextLength: processed?.length ?? 0,
        multilineAllowed: multiline,
        emptyReason: processed ? "none" : "empty-after-postprocess",
        completion: processed,
      })
      if (!processed) {
        return this.empty(
          cfg,
          id,
          document,
          position,
          gate.selected,
          started,
          "empty-after-postprocess",
          helper,
          snippets,
          prompt,
        )
      }
      const text = gate.selected ? gate.selected.text + processed : processed
      if (gate.selected && !text.startsWith(gate.selected.text)) {
        return this.empty(
          cfg,
          id,
          document,
          position,
          gate.selected,
          started,
          "selected-completion-invalid",
          helper,
          snippets,
          prompt,
        )
      }
      const item = renderQwenInlineCompletionItem(document, position, context, text)
      this.emit(cfg, {
        requestId: id,
        phase: "render",
        document,
        position,
        selected: gate.selected,
        prefixChars: helper.prunedPrefix.length,
        suffixChars: helper.prunedSuffix.length,
        helper,
        ...this.cacheFields(cfg, cached.status, cached.hit, helper, cached.returned),
        ...this.snippetFields(cfg, snippets, prompt),
        finalTextLength: text.length,
        itemCount: item ? 1 : 0,
        multilineAllowed: multiline,
        multilineShown: text.includes("\n"),
        range: item?.range,
        insertText: text,
        emptyReason: item ? "none" : "render-rejected",
      })
      if (!item) {
        return this.empty(cfg, id, document, position, gate.selected, started, "render-rejected", helper, snippets, prompt)
      }
      this.putCache(cfg, prompt, processed)
      this.emit(cfg, {
        requestId: id,
        phase: "return-items",
        document,
        position,
        selected: gate.selected,
        prefixChars: helper.prunedPrefix.length,
        suffixChars: helper.prunedSuffix.length,
        helper,
        ...this.cacheFields(cfg, cached.status, cached.hit, helper, cached.returned),
        ...this.snippetFields(cfg, snippets, prompt),
        finalTextLength: text.length,
        itemCount: 1,
        multilineAllowed: multiline,
        multilineShown: text.includes("\n"),
        range: item.range,
        insertText: text,
        latencyMs: Date.now() - started,
      })
      this.logDone(req, started, helper.prunedPrefix.length, helper.prunedSuffix.length, text)
      return [item]
    } catch (err) {
      if (req.abort.signal.aborted || token.isCancellationRequested) {
        return this.cancelled(cfg, id, document, position, gate.selected, started)
      }
      const reason = errorReason(err)
      this.emit(cfg, {
        requestId: id,
        phase: "error",
        document,
        position,
        selected: gate.selected,
        prefixChars: helper.prunedPrefix.length,
        suffixChars: helper.prunedSuffix.length,
        helper,
        ...this.cacheFields(cfg, cached.status, cached.hit, helper, cached.returned),
        ...this.snippetFields(cfg, snippets, prompt),
        httpStatus,
        latencyMs: Date.now() - started,
        emptyReason: reason,
        error: err,
      })
      this.logError(req, started, helper.prunedPrefix.length, helper.prunedSuffix.length, err)
      return this.empty(cfg, id, document, position, gate.selected, started, reason, helper, snippets, prompt)
    }
  }

  private lookupCache(
    cfg: QwenAutocompleteConfig,
    requestId: string,
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    selected: vscode.SelectedCompletionInfo | undefined,
    started: number,
    helper: QwenAutocompleteHelperVars,
    multiline: boolean,
    snippets: SnippetState,
    prompt: QwenPromptPlan,
  ): CacheResult {
    if (!cfg.cacheEnabled) return { hit: false, returned: null, status: "disabled" }
    try {
      this.cache.setMaxEntries(cfg.cacheMaxEntries)
      const completion = this.cache.get(helper.prunedPrefix)
      if (!completion) return { hit: false, returned: null, status: "miss" }
      return this.renderCached(
        cfg,
        requestId,
        document,
        position,
        context,
        selected,
        started,
        helper,
        multiline,
        completion,
        snippets,
        prompt,
      )
    } catch (err) {
      void err
      return { hit: false, returned: null, status: "miss" }
    }
  }

  private renderCached(
    cfg: QwenAutocompleteConfig,
    requestId: string,
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    selected: vscode.SelectedCompletionInfo | undefined,
    started: number,
    helper: QwenAutocompleteHelperVars,
    multiline: boolean,
    completion: string,
    snippets: SnippetState,
    prompt: QwenPromptPlan,
  ): CacheResult {
    const text = selected ? selected.text + completion : completion
    const item = renderQwenInlineCompletionItem(document, position, context, text)
    const base = this.cacheFields(cfg, item ? "hit" : "render-rejected", !!item, helper, completion.length)
    this.emit(cfg, {
      requestId,
      phase: "render",
      document,
      position,
      selected,
      prefixChars: helper.prunedPrefix.length,
      suffixChars: helper.prunedSuffix.length,
      helper,
      ...base,
      ...this.snippetFields(cfg, snippets, prompt),
      finalTextLength: text.length,
      itemCount: item ? 1 : 0,
      multilineAllowed: multiline,
      multilineShown: text.includes("\n"),
      range: item?.range,
      insertText: text,
      emptyReason: item ? "none" : "render-rejected",
    })
    if (!item) return { hit: false, returned: completion.length, status: "render-rejected" }
    this.emit(cfg, {
      requestId,
      phase: "return-items",
      document,
      position,
      selected,
      prefixChars: helper.prunedPrefix.length,
      suffixChars: helper.prunedSuffix.length,
      helper,
      ...base,
      ...this.snippetFields(cfg, snippets, prompt),
      finalTextLength: text.length,
      itemCount: 1,
      multilineAllowed: multiline,
      multilineShown: text.includes("\n"),
      range: item.range,
      insertText: text,
      latencyMs: Date.now() - started,
    })
    this.logDone(
      {
        id: requestId,
        path: vscode.workspace.asRelativePath(document.uri, false),
        line: position.line,
        character: position.character,
        version: document.version,
        abort: new AbortController(),
      },
      started,
      helper.prunedPrefix.length,
      helper.prunedSuffix.length,
      text,
    )
    return { hit: true, returned: completion.length, status: "hit", items: [item] }
  }

  private cacheFields(
    cfg: QwenAutocompleteConfig,
    status: QwenCacheStatus,
    hit: boolean,
    helper: QwenAutocompleteHelperVars,
    returned: number | null,
  ): Record<string, unknown> {
    return {
      cacheEnabled: cfg.cacheEnabled,
      cacheStatus: status,
      cacheHit: hit,
      cacheEntryCount: this.cache.size(),
      cacheLookupPrefixChars: helper.prunedPrefix.length,
      cacheReturnedChars: returned,
    }
  }

  private snippets(cfg: QwenAutocompleteConfig, helper: QwenAutocompleteHelperVars): SnippetState {
    const payload = emptyQwenSnippetPayload()
    const recent = this.edited?.snippets(cfg) ?? []
    payload.recentlyEditedRangeSnippets = recent
    const selection = selectQwenSnippets(helper, payload, {
      includeRecentlyEditedRanges: cfg.recentlyEditedEnabled,
      maxPromptTokens: cfg.maxPromptTokens,
      modelName: cfg.model,
    })
    return { payload, recent, selection }
  }

  private snippetFields(cfg: QwenAutocompleteConfig, state: SnippetState, prompt?: QwenPromptPlan): Record<string, unknown> {
    const selected = this.recent(state)
    return {
      snippetScaffoldEnabled: true,
      snippetTotalCount: state.selection.totalCount,
      selectedSnippetCount: state.selection.selectedCount,
      snippetTokenBudget: state.selection.snippetTokenBudget,
      selectedSnippetTokens: state.selection.selectedSnippetTokens,
      recentlyEditedEnabled: cfg.recentlyEditedEnabled,
      recentlyEditedTrackedRangeCount: this.edited?.count() ?? 0,
      recentlyEditedPayloadCount: state.payload.recentlyEditedRangeSnippets.length,
      recentlyEditedSelectedCount: selected.length,
      recentlyEditedSelectedTokens: selected.reduce((sum, snippet) => sum + countTokens(snippet.content, cfg.model), 0),
      recentlyEditedInjectIntoPrompt: cfg.recentlyEditedInjectIntoPrompt,
      contextLength: cfg.contextLength,
      availablePromptTokens: prompt?.availablePromptTokens ?? null,
      promptRendererMode: prompt?.promptRendererMode ?? "disabled",
      snippetInjectionBlockedReason: prompt?.snippetInjectionBlockedReason ?? "disabled",
      renderedPrefixChars: prompt?.renderedPrefixChars ?? null,
      renderedSuffixChars: prompt?.renderedSuffixChars ?? null,
      renderedPromptChars: prompt?.renderedPromptChars ?? null,
      estimatedRenderedPromptTokens: prompt?.estimatedRenderedPromptTokens ?? null,
      snippetsInjectedIntoPrompt: prompt?.snippetsInjectedIntoPrompt ?? false,
    }
  }

  private recent(state: SnippetState): QwenAutocompleteCodeSnippet[] {
    return state.selection.snippets.filter((snippet) => state.recent.includes(snippet as QwenAutocompleteCodeSnippet)) as QwenAutocompleteCodeSnippet[]
  }

  private putCache(cfg: QwenAutocompleteConfig, prompt: QwenPromptPlan, completion: string): void {
    if (!cfg.cacheEnabled) return
    try {
      this.cache.setMaxEntries(cfg.cacheMaxEntries)
      this.cache.put(prompt.renderedPrefix, completion)
    } catch (err) {
      void err
    }
  }

  private nextId(): string {
    return `qwen-${Date.now()}-${++this.seq}`
  }

  private start(id: string, document: vscode.TextDocument, position: vscode.Position): Pending {
    this.current?.abort.abort()
    const req: Pending = {
      id,
      path: vscode.workspace.asRelativePath(document.uri, false),
      line: position.line,
      character: position.character,
      version: document.version,
      abort: new AbortController(),
    }
    this.current = req
    return req
  }

  private async blocked(document: vscode.TextDocument): Promise<boolean> {
    try {
      return await this.guard(document)
    } catch {
      return true
    }
  }

  private async gate(
    cfg: QwenAutocompleteConfig,
    requestId: string,
    document: vscode.TextDocument,
    position: vscode.Position,
    selected: vscode.SelectedCompletionInfo | undefined,
    token: vscode.CancellationToken,
    started: number,
  ): Promise<Gate> {
    if (!qwenAutocompleteEnabled(cfg)) {
      return { selected, items: this.empty(cfg, requestId, document, position, selected, started, "disabled") }
    }
    if (shouldPrefilterQwenDocument(document)) {
      return { selected, items: this.empty(cfg, requestId, document, position, selected, started, "prefiltered") }
    }
    if (token.isCancellationRequested) {
      return { selected, items: this.cancelled(cfg, requestId, document, position, selected, started) }
    }
    const blocked = await this.blocked(document)
    this.emit(cfg, {
      requestId,
      phase: "ignore-guard",
      document,
      position,
      selected,
      guardBlocked: blocked,
      emptyReason: blocked ? "guard-blocked" : "none",
    })
    if (blocked) {
      return { selected, items: this.empty(cfg, requestId, document, position, selected, started, "guard-blocked") }
    }
    if (selected && !validSelectedCompletionInfo(document, selected)) {
      return {
        selected,
        items: this.empty(cfg, requestId, document, position, selected, started, "selected-completion-invalid"),
      }
    }
    if (token.isCancellationRequested) {
      return { selected, items: this.cancelled(cfg, requestId, document, position, selected, started) }
    }
    const debounced = await this.debouncer.delayAndShouldDebounce(cfg.debounceMs)
    this.emit(cfg, {
      requestId,
      phase: "debounce",
      document,
      position,
      selected,
      debounceMs: cfg.debounceMs,
      cancelled: debounced,
      emptyReason: debounced ? "cancelled" : "none",
    })
    if (debounced) {
      return { selected, items: this.empty(cfg, requestId, document, position, selected, started, "cancelled") }
    }
    if (token.isCancellationRequested) {
      return { selected, items: this.cancelled(cfg, requestId, document, position, selected, started) }
    }
    return { selected }
  }

  private cancelled(
    cfg: QwenAutocompleteConfig,
    requestId: string,
    document: vscode.TextDocument,
    position: vscode.Position,
    selected: vscode.SelectedCompletionInfo | undefined,
    started: number,
  ): vscode.InlineCompletionItem[] {
    this.emit(cfg, {
      requestId,
      phase: "cancelled",
      document,
      position,
      selected,
      cancelled: true,
      latencyMs: Date.now() - started,
      emptyReason: "cancelled",
    })
    return this.empty(cfg, requestId, document, position, selected, started, "cancelled")
  }

  private empty(
    cfg: QwenAutocompleteConfig,
    requestId: string,
    document: vscode.TextDocument,
    position: vscode.Position,
    selected: vscode.SelectedCompletionInfo | undefined,
    started: number,
    emptyReason: QwenEmptyReason,
    helper?: QwenAutocompleteHelperVars,
    snippets?: SnippetState,
    prompt?: QwenPromptPlan,
  ): vscode.InlineCompletionItem[] {
    this.emit(cfg, {
      requestId,
      phase: "return-items",
      document,
      position,
      selected,
      cancelled: emptyReason === "cancelled",
      stale: emptyReason === "stale",
      latencyMs: Date.now() - started,
      itemCount: 0,
      helper,
      ...(snippets ? this.snippetFields(cfg, snippets, prompt) : {}),
      emptyReason,
      filterReason: emptyReason,
    })
    return []
  }

  private emit(cfg: QwenAutocompleteConfig, input: Omit<Parameters<typeof emitQwenDiagnostic>[0], "cfg">): void {
    try {
      emitQwenDiagnostic({ ...input, cfg })
    } catch (err) {
      void err
      // Diagnostics must never affect autocomplete behavior.
    }
  }

  private fresh(
    req: Pending,
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): boolean {
    return (
      !token.isCancellationRequested &&
      !req.abort.signal.aborted &&
      this.current?.id === req.id &&
      document.version === req.version &&
      position.line === req.line &&
      position.character === req.character
    )
  }

  private logDone(req: Pending, started: number, prefix: number, suffix: number, text: string): void {
    this.log(
      `[Kilo New] qwen-autocomplete requestId=${req.id} path=${quote(req.path)} line=${req.line + 1} character=${
        req.character + 1
      } latency=${Date.now() - started} prefixChars=${prefix} suffixChars=${suffix} firstLine=${quote(firstLogLine(text))}`,
    )
  }

  private logError(req: Pending, started: number, prefix: number, suffix: number, err: unknown): void {
    this.log(
      `[Kilo New] qwen-autocomplete requestId=${req.id} path=${quote(req.path)} line=${req.line + 1} character=${
        req.character + 1
      } latency=${Date.now() - started} prefixChars=${prefix} suffixChars=${suffix} error=${quote(summary(err))}`,
    )
  }
}

function validSelectedCompletionInfo(
  document: vscode.TextDocument,
  selected: vscode.SelectedCompletionInfo,
): boolean {
  const text = document.getText(selected.range)
  const typed = selected.range.end.character - selected.range.start.character
  if (typed < 4) return false
  return selected.text.startsWith(text)
}

function quote(value: string): string {
  return JSON.stringify(value.slice(0, 180))
}

function summary(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)
}
