import * as vscode from "vscode"
import { AutocompleteDebouncer } from "./AutocompleteDebouncer"
import { buildQwenFimPrompt, getContinueAutocompleteStopTokens } from "./fimTemplates"
import { QwenFimClient } from "./QwenFimClient"
import { readQwenAutocompleteConfig, qwenAutocompleteEnabled } from "./config"
import { shouldGuardQwenDocument, type QwenSafetyGuard } from "./guard"
import { createQwenAutocompleteHelper } from "./helperVars"
import { shouldCompleteMultilineQwen } from "./multiline"
import { firstLogLine, postprocessQwenCompletion } from "./postprocess"
import { shouldPrefilterQwenDocument } from "./prefilter"
import { renderQwenInlineCompletionItem } from "./range"
import { filterQwenCompletion } from "./streamFilters"
import type { QwenAutocompleteConfig, QwenRequestInfo } from "./types"

export { QWEN_DOCUMENT_SELECTOR, isQwenSupportedDocument } from "./prefilter"

type Deps = {
  client?: QwenFimClient
  debouncer?: AutocompleteDebouncer
  read?: () => QwenAutocompleteConfig
  guard?: QwenSafetyGuard
  log?: (message: string) => void
}

type Pending = QwenRequestInfo & {
  abort: AbortController
}

export class KiloQwenInlineCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private readonly client: QwenFimClient
  private readonly debouncer: AutocompleteDebouncer
  private readonly read: () => QwenAutocompleteConfig
  private readonly guard: QwenSafetyGuard
  private readonly log: (message: string) => void
  private current: Pending | null = null
  private seq = 0

  constructor(deps: Deps = {}) {
    this.client = deps.client ?? new QwenFimClient()
    this.debouncer = deps.debouncer ?? new AutocompleteDebouncer()
    this.read = deps.read ?? readQwenAutocompleteConfig
    this.guard = deps.guard ?? shouldGuardQwenDocument
    this.log = deps.log ?? ((message) => console.info(message))
  }

  dispose(): void {
    this.debouncer.dispose()
    this.current?.abort.abort()
    this.current = null
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    const cfg = this.read()
    if (!qwenAutocompleteEnabled(cfg)) return []
    if (shouldPrefilterQwenDocument(document)) return []
    if (token.isCancellationRequested) return []
    if (await this.blocked(document)) return []
    const selected = context.selectedCompletionInfo
    if (selected && !validSelectedCompletionInfo(document, selected)) return []

    if (token.isCancellationRequested) return []
    if (await this.debouncer.delayAndShouldDebounce(cfg.debounceMs)) return []
    if (token.isCancellationRequested) return []

    const req = this.start(document, position)
    token.onCancellationRequested(() => req.abort.abort())
    const started = Date.now()
    const helper = createQwenAutocompleteHelper(document, position, selected)
    const prompt = buildQwenFimPrompt({
      prefix: helper.prunedPrefix,
      suffix: helper.prunedSuffix,
    })
    const multiline = shouldCompleteMultilineQwen({ helper, position, selected })

    try {
      const raw = await this.client.complete({
        endpoint: cfg.endpoint,
        model: cfg.model,
        apiKey: cfg.apiKey,
        prompt,
        maxTokens: cfg.maxTokens,
        temperature: cfg.temperature,
        signal: req.abort.signal,
      })
      if (!this.fresh(req, document, position, token)) return []
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
      if (!processed) return []
      const text = selected ? selected.text + processed : processed
      if (selected && !text.startsWith(selected.text)) return []
      const item = renderQwenInlineCompletionItem(document, position, context, text)
      if (!item) return []
      this.logDone(req, started, helper.prunedPrefix.length, helper.prunedSuffix.length, text)
      return [item]
    } catch (err) {
      if (req.abort.signal.aborted || token.isCancellationRequested) return []
      this.logError(req, started, helper.prunedPrefix.length, helper.prunedSuffix.length, err)
      return []
    }
  }

  private start(document: vscode.TextDocument, position: vscode.Position): Pending {
    this.current?.abort.abort()
    const req: Pending = {
      id: `qwen-${Date.now()}-${++this.seq}`,
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
