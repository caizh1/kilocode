import { afterEach, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import { buildQwenFimPrompt } from "../../src/services/qwen-autocomplete/fimTemplates"
import { createQwenAutocompleteHelper } from "../../src/services/qwen-autocomplete/helperVars"
import { KiloQwenInlineCompletionProvider } from "../../src/services/qwen-autocomplete/KiloQwenInlineCompletionProvider"
import { QwenFimClient } from "../../src/services/qwen-autocomplete/QwenFimClient"
import { qwenDiagnosticsForTests, resetQwenDiagnosticsForTests } from "../../src/services/qwen-autocomplete/diagnostics"
import {
  QwenRecentlyEditedTracker,
  type QwenRecentlyEditedSource,
} from "../../src/services/qwen-autocomplete/recentlyEdited"
import {
  QwenAutocompleteSnippetType,
  recentlyEditedRangesToQwenSnippets,
} from "../../src/services/qwen-autocomplete/snippets"
import type { QwenAutocompleteConfig, QwenFimCompleteInput } from "../../src/services/qwen-autocomplete/types"

type Pos = { line: number; character: number }
type Range = { start: Pos; end: Pos }
type Change = {
  range: vscode.Range
  text: string
}

const cfg: QwenAutocompleteConfig = {
  enabled: true,
  autoTrigger: true,
  provider: "qwen-direct",
  providerID: "qwen",
  model: "qwen-coder-30b0",
  debounceMs: 0,
  maxTokens: 128,
  maxPromptTokens: 1024,
  modelTimeout: 150,
  maxSuffixPercentage: 0.2,
  prefixPercentage: 0.3,
  temperature: 0.1,
  cacheEnabled: false,
  cacheMaxEntries: 1000,
  prefixChars: 12_000,
  suffixChars: 6_000,
  multifileContextEnabled: false,
  contextLength: 0,
  recentlyEditedEnabled: false,
  recentlyEditedInjectIntoPrompt: false,
  recentlyEditedMaxRanges: 3,
  recentlyEditedMaxRangeLines: 20,
  recentlyOpenedEnabled: false,
  recentlyOpenedInjectIntoPrompt: false,
  recentlyOpenedMaxFiles: 20,
  recentlyOpenedFileReadTimeoutMs: 80,
  importDefinitionsEnabled: false,
  importDefinitionsInjectIntoPrompt: false,
  importDefinitionsTimeoutMs: 100,
  importDefinitionsCacheSize: 10,
  rootPathEnabled: false,
  rootPathInjectIntoPrompt: false,
  rootPathTimeoutMs: 100,
  rootPathCacheSize: 100,
  trace: false,
  logLevel: "off",
  logPromptPreview: false,
  logCompletionPreview: true,
}

const originalText = vscode.workspace.onDidChangeTextDocument
const originalConfig = vscode.workspace.getConfiguration
const originalChange = vscode.workspace.onDidChangeConfiguration
const originalInline = vscode.languages.registerInlineCompletionItemProvider
const originalCommand = vscode.commands.registerCommand

afterEach(() => {
  ;(vscode.workspace as unknown as { onDidChangeTextDocument: typeof originalText }).onDidChangeTextDocument =
    originalText
  ;(vscode.workspace as unknown as { getConfiguration: typeof originalConfig }).getConfiguration = originalConfig
  ;(vscode.workspace as unknown as { onDidChangeConfiguration: typeof originalChange }).onDidChangeConfiguration =
    originalChange
  ;(
    vscode.languages as unknown as { registerInlineCompletionItemProvider: typeof originalInline }
  ).registerInlineCompletionItemProvider = originalInline
  ;(vscode.commands as unknown as { registerCommand: typeof originalCommand }).registerCommand = originalCommand
  resetQwenDiagnosticsForTests()
})

describe("qwen recently edited tracker", () => {
  it("does not register a listener when recently edited context is disabled", () => {
    const text = listeners()

    const tracker = new QwenRecentlyEditedTracker({
      read: () => ({ ...cfg, recentlyEditedEnabled: false }),
      guard: () => false,
    })

    expect(text.registered()).toBe(0)
    expect(tracker.count()).toBe(0)
    tracker.dispose()
  })

  it("records bounded supported file edits only after guard passes", async () => {
    let now = 1
    let allowed = false
    const text = listeners()
    const tracker = new QwenRecentlyEditedTracker({
      read: () => ({ ...cfg, recentlyEditedEnabled: true, recentlyEditedMaxRanges: 2, recentlyEditedMaxRangeLines: 2 }),
      guard: async () => {
        await Promise.resolve()
        allowed = true
        return false
      },
      now: () => now++,
    })
    const document = doc("int a;\nint b;\nint c;\nint d;\n", {
      lineAt: () => {
        expect(allowed).toBe(true)
      },
    })

    text.fire({ document, contentChanges: [change(0, 0, "int aa;\nint bb;\nint cc;")] })
    text.fire({ document, contentChanges: [change(2, 2, "int cc;")] })
    await tracker.flush()

    const snippets = tracker.snippets({ ...cfg, recentlyEditedEnabled: true })
    expect(snippets).toHaveLength(2)
    expect(snippets[0]!.content.split("\n").length).toBeLessThanOrEqual(2)
    expect(tracker.count()).toBe(2)
  })

  it("ignores unsupported schemes, unsupported documents, sensitive files, and guard-blocked files", async () => {
    const text = listeners()
    let guarded = 0
    const tracker = new QwenRecentlyEditedTracker({
      read: () => ({ ...cfg, recentlyEditedEnabled: true }),
      guard: () => {
        guarded++
        return true
      },
    })
    const fail = () => {
      throw new Error("line text should not be read")
    }

    text.fire({
      document: doc("secret", { path: "/repo/src/readme.md", languageId: "markdown", lineAt: fail }),
      contentChanges: [change()],
    })
    text.fire({ document: doc("secret", { scheme: "untitled", lineAt: fail }), contentChanges: [change()] })
    text.fire({ document: doc("secret", { path: "/repo/.env", lineAt: fail }), contentChanges: [change()] })
    text.fire({ document: doc("int a;", { lineAt: fail }), contentChanges: [change()] })
    await tracker.flush()

    expect(guarded).toBe(1)
    expect(tracker.count()).toBe(0)
  })

  it("records edits from newly supported script files", async () => {
    const text = listeners()
    const tracker = new QwenRecentlyEditedTracker({
      read: () => ({ ...cfg, recentlyEditedEnabled: true }),
      guard: () => false,
    })

    text.fire({
      document: doc("def add(a, b):\n    return a + b", {
        path: "/repo/src/add.py",
        languageId: "python",
      }),
      contentChanges: [change(1, 4, "return a + b")],
    })
    await tracker.flush()

    expect(tracker.count()).toBe(1)
  })

  it("fails closed on guard errors before storing edited text", async () => {
    const text = listeners()
    const tracker = new QwenRecentlyEditedTracker({
      read: () => ({ ...cfg, recentlyEditedEnabled: true }),
      guard: async () => {
        throw new Error("blocked")
      },
    })

    text.fire({
      document: doc("int secret;", {
        lineAt: () => {
          throw new Error("line text should not be read")
        },
      }),
      contentChanges: [change()],
    })
    await tracker.flush()

    expect(tracker.count()).toBe(0)
  })

  it("expires stale ranges and clears memory on dispose", async () => {
    let now = 0
    const text = listeners()
    const tracker = new QwenRecentlyEditedTracker({
      read: () => ({ ...cfg, recentlyEditedEnabled: true }),
      guard: () => false,
      now: () => now,
    })

    text.fire({ document: doc("int a;"), contentChanges: [change()] })
    await tracker.flush()
    expect(tracker.count()).toBe(1)

    now = 121_000
    expect(tracker.snippets({ ...cfg, recentlyEditedEnabled: true })).toEqual([])
    tracker.dispose()
    expect(text.disposed()).toBe(1)
    expect(tracker.count()).toBe(0)
  })

  it("maps recently edited ranges to Continue-style code snippets and respects useRecentlyEdited=false", () => {
    const ranges = [
      {
        filepath: "/repo/src/main.c",
        lines: ["int local;", "return local;"],
        timestamp: 1,
        symbols: new Set<string>(),
      },
    ]

    expect(recentlyEditedRangesToQwenSnippets(ranges)).toEqual([
      {
        filepath: "/repo/src/main.c",
        content: "int local;\nreturn local;",
        type: QwenAutocompleteSnippetType.Code,
      },
    ])
    expect(recentlyEditedRangesToQwenSnippets(ranges, { useRecentlyEdited: false })).toEqual([])
  })
})

describe("qwen recently edited provider integration", () => {
  it("keeps recently edited tracking available for manual Qwen invocation", async () => {
    let values = { ...cfg, enabled: true, provider: "qwen-direct" as const, recentlyEditedEnabled: false }
    const text = listeners()
    const config = configEvents(() => values)
    const inline = inlineRegistrations()

    const { registerQwenAutocompleteProvider } = await import("../../src/services/qwen-autocomplete")
    const reg = registerQwenAutocompleteProvider(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      connection(),
    )

    expect(inline.registered()).toBe(1)
    expect(text.registered()).toBe(0)

    values = { ...values, recentlyEditedEnabled: true }
    config.fire()
    expect(inline.registered()).toBe(2)
    expect(text.registered()).toBe(1)

    config.fire()
    expect(inline.registered()).toBe(2)
    expect(text.registered()).toBe(1)

    values = { ...values, autoTrigger: false }
    config.fire()
    expect(text.disposed()).toBe(0)

    values = { ...values, providerID: "" }
    config.fire()
    expect(text.disposed()).toBe(1)

    values = { ...values, providerID: "qwen", autoTrigger: true, recentlyEditedEnabled: true }
    config.fire()
    expect(text.registered()).toBe(2)

    reg.dispose()
    expect(config.disposed()).toBe(1)
  })

  it("keeps the CLI FIM request unchanged even with selected recently edited snippets", async () => {
    let request: QwenFimCompleteInput | undefined
    const document = doc("int main(void) {\n  \n}\n")
    const position = new vscode.Position(1, 2)
    const helper = createQwenAutocompleteHelper(document, position, undefined, {
      maxPromptTokens: cfg.maxPromptTokens,
      maxSuffixPercentage: cfg.maxSuffixPercentage,
      modelName: cfg.model,
      prefixPercentage: cfg.prefixPercentage,
    })
    const prompt = buildQwenFimPrompt({
      prefix: helper.prunedPrefix,
      suffix: helper.prunedSuffix,
    })
    const expected = {
      providerID: cfg.providerID,
      modelID: cfg.model,
      prompt,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
    }
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => ({ ...cfg, recentlyEditedEnabled: true, trace: true, logLevel: "debug" }),
      guard: () => false,
      client: {
        complete: async (input: QwenFimCompleteInput) => {
          request = input
          input.onResponse?.({ status: 200 })
          return "return ok;"
        },
      } as QwenFimClient,
      edited: fakeEdited("int helper(void) {\n  return 1;\n}"),
      log: () => {},
    })

    const items = await provider.provideInlineCompletionItems(
      document,
      position,
      {} as vscode.InlineCompletionContext,
      token() as vscode.CancellationToken,
    )

    expect(items).toHaveLength(1)
    expect(request).toMatchObject(expected)
    expect(request?.signal).toBeInstanceOf(AbortSignal)
    const logs = qwenDiagnosticsForTests().map((line) => JSON.parse(line) as Record<string, unknown>)
    const last = logs.at(-1)!
    expect(last.recentlyEditedEnabled).toBe(true)
    expect(last.recentlyEditedTrackedRangeCount).toBe(1)
    expect(last.recentlyEditedPayloadCount).toBe(1)
    expect(last.recentlyEditedSelectedCount).toBe(1)
    expect(last.recentlyEditedSelectedTokens).toEqual(expect.any(Number))
    expect(last.snippetsInjectedIntoPrompt).toBe(false)
    expect(JSON.stringify(logs)).not.toContain("int helper")
    provider.dispose()
  })

  it("does not import forbidden context sources or endpoints", () => {
    const root = path.join(__dirname, "../..")
    const source = [
      "src/services/qwen-autocomplete/recentlyEdited.ts",
      "src/services/qwen-autocomplete/snippets.ts",
      "src/services/qwen-autocomplete/KiloQwenInlineCompletionProvider.ts",
      "src/services/qwen-autocomplete/index.ts",
    ]
      .map((file) => readFileSync(path.join(root, file), "utf8"))
      .join("\n")

    expect(source).not.toContain("getAllSnippetsWithoutRace")
    expect(source).not.toContain("ContextRetrievalService")
    expect(source).not.toContain("getClipboardContent")
    expect(source).not.toContain("RecentlyVisitedRangesService")
    expect(source).not.toContain("StaticContextService")
    expect(source).not.toContain("semantic_search")
    expect(source).not.toContain("codebase_analysis")
    expect(source).not.toContain("/kilo/fim")
    expect(source).not.toContain("/kilo/edit")
    expect(source).not.toContain("/v1/chat/completions")
    expect(source).not.toContain("workspace.fs.readFile")
  })
})

function listeners() {
  const callbacks: Array<(event: { document: vscode.TextDocument; contentChanges: Change[] }) => void> = []
  let disposed = 0
  ;(vscode.workspace as unknown as { onDidChangeTextDocument: typeof originalText }).onDidChangeTextDocument = (
    callback,
  ) => {
    callbacks.push(callback as (event: { document: vscode.TextDocument; contentChanges: Change[] }) => void)
    return {
      dispose: () => {
        disposed++
      },
    }
  }
  return {
    disposed: () => disposed,
    fire: (event: { document: vscode.TextDocument; contentChanges: Change[] }) => {
      callbacks.forEach((callback) => callback(event))
    },
    registered: () => callbacks.length,
  }
}

function configEvents(read: () => QwenAutocompleteConfig) {
  let callback: ((event: { affectsConfiguration: (section: string) => boolean }) => void) | undefined
  let disposed = 0
  ;(vscode.workspace as unknown as { getConfiguration: typeof originalConfig }).getConfiguration = (
    section?: string,
  ) => {
    if (section === "kilo-code.new.autocomplete") {
      return {
        get: (key: string, fallback?: unknown) =>
          ({
            provider: read().providerID,
            model: read().model,
            enableAutoTrigger: read().autoTrigger,
          })[key] ?? fallback,
        update: async () => {},
      } as unknown as ReturnType<typeof originalConfig>
    }
    if (section !== "kilo.autocomplete") return originalConfig(section)
    return {
      get: (key: string, fallback?: unknown) => setting(read(), key) ?? fallback,
      update: async () => {},
    } as unknown as ReturnType<typeof originalConfig>
  }
  ;(vscode.workspace as unknown as { onDidChangeConfiguration: typeof originalChange }).onDidChangeConfiguration = (
    cb,
  ) => {
    callback = cb as (event: { affectsConfiguration: (section: string) => boolean }) => void
    return {
      dispose: () => {
        disposed++
      },
    }
  }
  ;(vscode.commands as unknown as { registerCommand: typeof originalCommand }).registerCommand = () => ({
    dispose: () => {},
  })
  return {
    disposed: () => disposed,
    fire: (target = "kilo.autocomplete") => callback?.({ affectsConfiguration: (section) => section === target }),
  }
}

function inlineRegistrations() {
  const providers: unknown[] = []
  ;(
    vscode.languages as unknown as { registerInlineCompletionItemProvider: typeof originalInline }
  ).registerInlineCompletionItemProvider = (_selector, provider) => {
    providers.push(provider)
    return { dispose: () => {} }
  }
  return {
    registered: () => providers.length,
  }
}

function connection() {
  return {
    getConnectionState: () => "connected",
  } as never
}

function setting(values: QwenAutocompleteConfig, key: string): unknown {
  const map: Record<string, unknown> = {
    "qwen.model": values.model,
    "qwen.debounceMs": values.debounceMs,
    "qwen.maxTokens": values.maxTokens,
    "qwen.maxPromptTokens": values.maxPromptTokens,
    "qwen.modelTimeout": values.modelTimeout,
    "qwen.maxSuffixPercentage": values.maxSuffixPercentage,
    "qwen.prefixPercentage": values.prefixPercentage,
    "qwen.temperature": values.temperature,
    "qwen.cache.enabled": values.cacheEnabled,
    "qwen.cache.maxEntries": values.cacheMaxEntries,
    "qwen.prefixChars": values.prefixChars,
    "qwen.suffixChars": values.suffixChars,
    "qwen.multifileContext.enabled": values.multifileContextEnabled,
    "qwen.contextLength": values.contextLength,
    "qwen.context.recentlyEdited.enabled": values.recentlyEditedEnabled,
    "qwen.context.recentlyEdited.injectIntoPrompt": values.recentlyEditedInjectIntoPrompt,
    "qwen.context.recentlyEdited.maxRanges": values.recentlyEditedMaxRanges,
    "qwen.context.recentlyEdited.maxRangeLines": values.recentlyEditedMaxRangeLines,
    "qwen.context.recentlyOpened.enabled": values.recentlyOpenedEnabled,
    "qwen.context.recentlyOpened.injectIntoPrompt": values.recentlyOpenedInjectIntoPrompt,
    "qwen.context.recentlyOpened.maxFiles": values.recentlyOpenedMaxFiles,
    "qwen.context.recentlyOpened.fileReadTimeoutMs": values.recentlyOpenedFileReadTimeoutMs,
    "qwen.context.importDefinitions.enabled": values.importDefinitionsEnabled,
    "qwen.context.importDefinitions.injectIntoPrompt": values.importDefinitionsInjectIntoPrompt,
    "qwen.context.importDefinitions.timeoutMs": values.importDefinitionsTimeoutMs,
    "qwen.context.importDefinitions.cacheSize": values.importDefinitionsCacheSize,
    "qwen.context.rootPath.enabled": values.rootPathEnabled,
    "qwen.context.rootPath.injectIntoPrompt": values.rootPathInjectIntoPrompt,
    "qwen.context.rootPath.timeoutMs": values.rootPathTimeoutMs,
    "qwen.context.rootPath.cacheSize": values.rootPathCacheSize,
    "qwen.trace": values.trace,
    "qwen.logLevel": values.logLevel,
    "qwen.logPromptPreview": values.logPromptPreview,
    "qwen.logCompletionPreview": values.logCompletionPreview,
  }
  return map[key]
}

function fakeEdited(content: string): QwenRecentlyEditedSource {
  return {
    count: () => 1,
    dispose: () => {},
    snippets: () => [
      {
        filepath: "/repo/src/recent.c",
        content,
        type: QwenAutocompleteSnippetType.Code,
      },
    ],
  }
}

function change(start = 0, end = 0, text = "int a;"): Change {
  return {
    range: new vscode.Range(new vscode.Position(start, 0), new vscode.Position(end, 0)),
    text,
  }
}

function doc(
  text: string,
  input: {
    languageId?: string
    lineAt?: () => void
    path?: string
    scheme?: string
    version?: number
  } = {},
) {
  const lines = text.split("\n")
  return {
    uri: {
      scheme: input.scheme ?? "file",
      fsPath: input.path ?? "/repo/src/main.c",
      path: input.path ?? "/repo/src/main.c",
    },
    languageId: input.languageId ?? "c",
    version: input.version ?? 1,
    lineCount: lines.length,
    lineAt: (value: number | Pos) => {
      input.lineAt?.()
      const line = typeof value === "number" ? value : value.line
      const current = lines[line] ?? ""
      return {
        text: current,
        range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, current.length)),
      }
    },
    getText: (range?: Range) => {
      if (!range) return text
      return text.slice(offset(lines, range.start), offset(lines, range.end))
    },
  } as unknown as vscode.TextDocument
}

function token() {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} }),
  }
}

function offset(lines: string[], pos: Pos): number {
  return lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.character
}
