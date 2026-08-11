import { afterEach, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import type { QwenAutocompleteCache } from "../../src/services/qwen-autocomplete/autocompleteLruCache"
import { qwenDiagnosticsForTests, resetQwenDiagnosticsForTests } from "../../src/services/qwen-autocomplete/diagnostics"
import { buildQwenFimPrompt } from "../../src/services/qwen-autocomplete/fimTemplates"
import { createQwenAutocompleteHelper } from "../../src/services/qwen-autocomplete/helperVars"
import { ChipMateQwenInlineCompletionProvider } from "../../src/services/qwen-autocomplete/ChipMateQwenInlineCompletionProvider"
import { QwenFimClient } from "../../src/services/qwen-autocomplete/QwenFimClient"
import type { QwenRecentlyEditedSource } from "../../src/services/qwen-autocomplete/recentlyEdited"
import {
  QwenRecentlyOpenedTracker,
  recentlyOpenedFilesToQwenSnippets,
  type QwenRecentlyOpenedSource,
} from "../../src/services/qwen-autocomplete/recentlyOpened"
import {
  QwenAutocompleteSnippetType,
  type QwenAutocompleteCodeSnippet,
} from "../../src/services/qwen-autocomplete/snippets"
import type { QwenAutocompleteConfig, QwenFimCompleteInput } from "../../src/services/qwen-autocomplete/types"

type Pos = { line: number; character: number }
type Range = { start: Pos; end: Pos }

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

const originalOpen = vscode.workspace.onDidOpenTextDocument
const originalClose = vscode.workspace.onDidCloseTextDocument
const originalActive = vscode.window.onDidChangeActiveTextEditor
const originalConfig = vscode.workspace.getConfiguration
const originalChange = vscode.workspace.onDidChangeConfiguration
const originalCommand = vscode.commands.registerCommand
const originalDocs = vscode.workspace.textDocuments
const originalVisible = vscode.window.visibleTextEditors
const originalInline = vscode.languages.registerInlineCompletionItemProvider

afterEach(() => {
  ;(vscode.workspace as unknown as { onDidOpenTextDocument: typeof originalOpen }).onDidOpenTextDocument = originalOpen
  ;(vscode.workspace as unknown as { onDidCloseTextDocument: typeof originalClose }).onDidCloseTextDocument =
    originalClose
  ;(vscode.window as unknown as { onDidChangeActiveTextEditor: typeof originalActive }).onDidChangeActiveTextEditor =
    originalActive
  ;(vscode.workspace as unknown as { getConfiguration: typeof originalConfig }).getConfiguration = originalConfig
  ;(vscode.workspace as unknown as { onDidChangeConfiguration: typeof originalChange }).onDidChangeConfiguration =
    originalChange
  ;(vscode.commands as unknown as { registerCommand: typeof originalCommand }).registerCommand = originalCommand
  ;(vscode.workspace as unknown as { textDocuments: typeof originalDocs }).textDocuments = originalDocs
  ;(vscode.window as unknown as { visibleTextEditors: typeof originalVisible }).visibleTextEditors = originalVisible
  ;(
    vscode.languages as unknown as { registerInlineCompletionItemProvider: typeof originalInline }
  ).registerInlineCompletionItemProvider = originalInline
  resetQwenDiagnosticsForTests()
})

describe("qwen recently opened tracker", () => {
  it("does not register listeners, seed documents, or produce payload by default", async () => {
    const events = openedEvents()
    ;(vscode.workspace as unknown as { textDocuments: vscode.TextDocument[] }).textDocuments = [doc("int seed;")]
    ;(vscode.window as unknown as { visibleTextEditors: Array<{ document: vscode.TextDocument }> }).visibleTextEditors =
      [{ document: doc("int visible;", { path: "/repo/src/visible.c" }) }]
    let guarded = 0
    const tracker = new QwenRecentlyOpenedTracker({
      guard: () => {
        guarded++
        return false
      },
      read: () => cfg,
      readFile: async () => bytes("int opened;"),
    })

    expect(events.opened()).toBe(0)
    expect(events.active()).toBe(0)
    expect(events.closed()).toBe(0)
    expect(guarded).toBe(0)
    expect(tracker.count()).toBe(0)
    expect(await tracker.snippets({ ...cfg, recentlyOpenedEnabled: false }, doc("int main;"))).toEqual({
      skippedCount: 0,
      snippets: [],
    })
  })

  it("tracks bounded file opens, active editor recency updates, and closed file removal", async () => {
    const events = openedEvents()
    const tracker = new QwenRecentlyOpenedTracker({
      guard: () => false,
      read: () => ({ ...cfg, recentlyOpenedEnabled: true, recentlyOpenedMaxFiles: 2 }),
      readFile: async (uri) => bytes(`content ${uri.fsPath}`),
    })

    events.fireOpen(doc("int a;", { path: "/repo/src/a.c" }))
    events.fireOpen(doc("int b;", { path: "/repo/src/b.c" }))
    events.fireActive(doc("int a;", { path: "/repo/src/a.c" }))
    events.fireOpen(doc("int c;", { path: "/repo/src/c.c" }))
    await tracker.flush()

    expect(tracker.count()).toBe(2)
    const snippets = await tracker.snippets(
      { ...cfg, recentlyOpenedEnabled: true },
      doc("int current;", { path: "/repo/src/main.c" }),
    )
    expect(snippets.snippets.map((item) => item.filepath)).toEqual(["/repo/src/c.c", "/repo/src/a.c"])

    events.fireClose(doc("", { path: "/repo/src/a.c" }))
    expect(tracker.count()).toBe(1)
    tracker.dispose()
    expect(events.disposed()).toBe(3)
  })

  it("excludes current file and ignores unsupported, sensitive, blocked, empty, failed, and timed-out reads", async () => {
    const events = openedEvents()
    const tracker = new QwenRecentlyOpenedTracker({
      guard: (document) => {
        if (document.uri.fsPath.includes("blocked")) return true
        if (document.uri.fsPath.includes("error")) throw new Error("fail closed")
        return false
      },
      read: () => ({ ...cfg, recentlyOpenedEnabled: true, recentlyOpenedFileReadTimeoutMs: 1 }),
      readFile: async (uri) => {
        if (uri.fsPath.includes("empty")) return bytes("")
        if (uri.fsPath.includes("failed")) throw new Error("read failed")
        if (uri.fsPath.includes("slow")) return new Promise<Uint8Array>(() => {})
        return bytes(`int ${path.basename(uri.fsPath, ".c")};`)
      },
    })

    events.fireOpen(doc("int main;", { path: "/repo/src/main.c" }))
    events.fireOpen(doc("int other;", { path: "/repo/src/other.c" }))
    events.fireOpen(doc("notes", { languageId: "markdown", path: "/repo/src/readme.md" }))
    events.fireOpen(doc("secret", { path: "/repo/.env" }))
    events.fireOpen(doc("int blocked;", { path: "/repo/src/blocked.c" }))
    events.fireOpen(doc("int error;", { path: "/repo/src/error.c" }))
    events.fireOpen(doc("", { path: "/repo/src/empty.c" }))
    events.fireOpen(doc("int failed;", { path: "/repo/src/failed.c" }))
    events.fireOpen(doc("int slow;", { path: "/repo/src/slow.c" }))
    await tracker.flush()

    const result = await tracker.snippets(
      { ...cfg, recentlyOpenedEnabled: true, recentlyOpenedFileReadTimeoutMs: 1 },
      doc("int main;", { path: "/repo/src/main.c" }),
    )

    expect(result.snippets.map((item) => item.filepath)).toEqual(["/repo/src/other.c"])
    expect(result.skippedCount).toBeGreaterThanOrEqual(4)
  })

  it("collects newly supported Python and Shell files without reading hidden workflow paths", async () => {
    const events = openedEvents()
    const tracker = new QwenRecentlyOpenedTracker({
      guard: () => false,
      read: () => ({ ...cfg, recentlyOpenedEnabled: true }),
      readFile: async (uri) => bytes(`content ${uri.fsPath}`),
    })

    events.fireOpen(doc("def add():", { languageId: "python", path: "/repo/src/add.py" }))
    events.fireOpen(doc("#!/bin/sh", { languageId: "shellscript", path: "/repo/scripts/run.sh" }))
    events.fireOpen(doc("name: build", { languageId: "yaml", path: "/repo/.gitea/workflows/build.yml" }))
    await tracker.flush()

    const result = await tracker.snippets(
      { ...cfg, recentlyOpenedEnabled: true },
      doc("int current;", { path: "/repo/src/main.c" }),
    )
    expect(result.snippets.map((item) => item.filepath)).toEqual(["/repo/scripts/run.sh", "/repo/src/add.py"])
  })

  it("maps recently opened files to Continue-style code snippets and respects useRecentlyOpened=false", () => {
    const snippets = recentlyOpenedFilesToQwenSnippets([
      { filepath: "/repo/src/a.c", content: "int a;" },
      { filepath: "/repo/src/empty.c", content: "  " },
    ])

    expect(snippets).toEqual([
      {
        filepath: "/repo/src/a.c",
        content: "int a;",
        type: QwenAutocompleteSnippetType.Code,
      },
    ])
    expect(
      recentlyOpenedFilesToQwenSnippets([{ filepath: "/repo/src/a.c", content: "int a;" }], {
        useRecentlyOpened: false,
      }),
    ).toEqual([])
  })
})

describe("qwen recently opened provider integration", () => {
  it("keeps opened tracking available for manual Qwen invocation", async () => {
    let values = { ...cfg, enabled: true, provider: "qwen-direct" as const, recentlyOpenedEnabled: false }
    const events = openedEvents()
    const config = configEvents(() => values)
    const inline = inlineRegistrations()

    const { registerQwenAutocompleteProvider } = await import("../../src/services/qwen-autocomplete")
    const reg = registerQwenAutocompleteProvider(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      connection(),
    )

    expect(inline.registered()).toBe(1)
    expect(events.opened()).toBe(0)
    expect(events.active()).toBe(0)

    values = { ...values, recentlyOpenedEnabled: true }
    config.fire()
    expect(inline.registered()).toBe(2)
    expect(events.opened()).toBe(1)
    expect(events.active()).toBe(1)

    config.fire()
    expect(inline.registered()).toBe(2)
    expect(events.opened()).toBe(1)

    values = { ...values, autoTrigger: false }
    config.fire()
    expect(events.disposed()).toBe(0)

    values = { ...values, providerID: "" }
    config.fire()
    expect(events.disposed()).toBe(3)

    values = { ...values, providerID: "qwen", autoTrigger: true, recentlyOpenedEnabled: true }
    config.fire()
    expect(events.opened()).toBe(2)

    reg.dispose()
    expect(config.disposed()).toBe(1)
  })

  it("keeps the CLI FIM request unchanged in collection-only mode", async () => {
    let request: QwenFimCompleteInput | undefined
    const document = doc("int main(void) {\n  \n}\n")
    const position = new vscode.Position(1, 2)
    const helper = createQwenAutocompleteHelper(document, position, undefined, opts(cfg))
    const prompt = buildQwenFimPrompt({ prefix: helper.prunedPrefix, suffix: helper.prunedSuffix })
    const expected = {
      providerID: cfg.providerID,
      modelID: cfg.model,
      prompt,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
    }
    const provider = new ChipMateQwenInlineCompletionProvider({
      read: () => ({ ...cfg, recentlyOpenedEnabled: true, trace: true, logLevel: "debug" }),
      guard: () => false,
      client: {
        complete: async (input: QwenFimCompleteInput) => {
          request = input
          input.onResponse?.({ status: 200 })
          return "return ok;"
        },
      } as QwenFimClient,
      opened: fakeOpened([snippet("/repo/src/opened.c", "int opened_helper(void) { return 1; }")]),
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
    expect(last.recentlyOpenedEnabled).toBe(true)
    expect(last.recentlyOpenedPayloadCount).toBe(1)
    expect(last.recentlyOpenedSelectedCount).toBe(1)
    expect(last.recentlyOpenedInjectedIntoPrompt).toBe(false)
    expect(JSON.stringify(logs)).not.toContain("opened_helper")
    provider.dispose()
  })

  it("blocks opened snippet injection when contextLength is unknown", async () => {
    const output = await runProvider({
      config: {
        ...cfg,
        recentlyOpenedEnabled: true,
        recentlyOpenedInjectIntoPrompt: true,
        contextLength: 0,
        trace: true,
        logLevel: "debug",
      },
      opened: fakeOpened([snippet("/repo/src/opened.c", "int opened_helper(void) { return 1; }")]),
    })

    expect(output.prompt).toBe(output.single)
    expect(output.logs.at(-1)?.snippetInjectionBlockedReason).toBe("unknown-context-length")
    expect(output.logs.at(-1)?.snippetsInjectedIntoPrompt).toBe(false)
  })

  it("injects selected recently opened snippets when all gates pass", async () => {
    const output = await runProvider({
      config: {
        ...cfg,
        contextLength: 8192,
        recentlyOpenedEnabled: true,
        recentlyOpenedInjectIntoPrompt: true,
        trace: true,
        logLevel: "debug",
      },
      opened: fakeOpened([snippet("/repo/src/opened.c", "int opened_helper(void) { return 1; }")]),
    })

    expect(output.prompt).toContain("<|repo_name|>")
    expect(output.prompt).toContain("<|file_sep|>opened.c")
    expect(output.prompt).toContain("opened_helper")
    expect(output.logs.at(-1)).toMatchObject({
      promptRendererMode: "qwen-multifile-fim",
      recentlyOpenedInjectedIntoPrompt: true,
      snippetsInjectedIntoPrompt: true,
    })
    expect(JSON.stringify(output.logs)).not.toContain("opened_helper")
  })

  it("dedupes same-file combined injection by preferring recently edited content", async () => {
    const output = await runProvider({
      config: {
        ...cfg,
        contextLength: 8192,
        recentlyEditedEnabled: true,
        recentlyEditedInjectIntoPrompt: true,
        recentlyOpenedEnabled: true,
        recentlyOpenedInjectIntoPrompt: true,
      },
      edited: fakeEdited("int edited_latest(void) { return 2; }", "/repo/src/shared.c"),
      opened: fakeOpened([snippet("/repo/src/shared.c", "int opened_stale(void) { return 1; }")]),
    })

    expect(output.prompt).toContain("edited_latest")
    expect(output.prompt).not.toContain("opened_stale")
    expect(output.prompt.split("<|file_sep|>shared.c").length - 1).toBe(1)
  })

  it("uses helper prefix for cache lookup and rendered prefix for active injection cache put", async () => {
    const cache = new RecordingCache()
    await runProvider({
      cache,
      config: {
        ...cfg,
        cacheEnabled: true,
        contextLength: 8192,
        recentlyOpenedEnabled: true,
        recentlyOpenedInjectIntoPrompt: true,
      },
      opened: fakeOpened([snippet("/repo/src/opened.c", "int opened_helper(void) { return 1; }")]),
    })

    expect(cache.gets[0]).toContain("int main(void)")
    expect(cache.puts[0]?.prefix).toContain("<|repo_name|>")
    expect(cache.puts[0]?.prefix).toContain("<|file_sep|>opened.c")
  })

  it("keeps qwen runtime isolated from forbidden context systems", () => {
    const root = path.join(__dirname, "../../src/services/qwen-autocomplete")
    const source = [
      "ChipMateQwenInlineCompletionProvider.ts",
      "index.ts",
      "qwenMultifileFimRenderer.ts",
      "recentlyOpened.ts",
      "snippets.ts",
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
    expect(source).not.toContain("/chipmate/fim")
    expect(source).not.toContain("/chipmate/edit")
    expect(source).not.toContain("/v1/chat/completions")
  })
})

class RecordingCache implements QwenAutocompleteCache {
  gets: string[] = []
  puts: Array<{ completion: string; prefix: string }> = []

  get(prefix: string): string | undefined {
    this.gets.push(prefix)
    return undefined
  }

  put(prefix: string, completion: string): void {
    this.puts.push({ completion, prefix })
  }

  setMaxEntries(): void {}

  size(): number {
    return this.puts.length
  }
}

function openedEvents() {
  const opens: Array<(document: vscode.TextDocument) => void> = []
  const closes: Array<(document: vscode.TextDocument) => void> = []
  const actives: Array<(editor: { document: vscode.TextDocument } | undefined) => void> = []
  let disposed = 0
  ;(vscode.workspace as unknown as { onDidOpenTextDocument: typeof originalOpen }).onDidOpenTextDocument = (
    callback,
  ) => {
    opens.push(callback as (document: vscode.TextDocument) => void)
    return { dispose: () => disposed++ }
  }
  ;(vscode.workspace as unknown as { onDidCloseTextDocument: typeof originalClose }).onDidCloseTextDocument = (
    callback,
  ) => {
    closes.push(callback as (document: vscode.TextDocument) => void)
    return { dispose: () => disposed++ }
  }
  ;(vscode.window as unknown as { onDidChangeActiveTextEditor: typeof originalActive }).onDidChangeActiveTextEditor = (
    callback,
  ) => {
    actives.push(callback as (editor: { document: vscode.TextDocument } | undefined) => void)
    return { dispose: () => disposed++ }
  }
  return {
    active: () => actives.length,
    closed: () => closes.length,
    disposed: () => disposed,
    fireActive: (document: vscode.TextDocument) => actives.forEach((callback) => callback({ document })),
    fireClose: (document: vscode.TextDocument) => closes.forEach((callback) => callback(document)),
    fireOpen: (document: vscode.TextDocument) => opens.forEach((callback) => callback(document)),
    opened: () => opens.length,
  }
}

function configEvents(read: () => QwenAutocompleteConfig) {
  let callback: ((event: { affectsConfiguration: (section: string) => boolean }) => void) | undefined
  let disposed = 0
  ;(vscode.workspace as unknown as { getConfiguration: typeof originalConfig }).getConfiguration = (
    section?: string,
  ) => {
    if (section === "chipmate.v2.autocomplete") {
      return {
        get: (key: string, fallback?: unknown) =>
          ({
            provider: read().providerID,
            model: read().model,
            enableAutoTrigger: read().autoTrigger,
          })[key] ??
          setting(read(), key) ??
          fallback,
        update: async () => {},
      } as unknown as ReturnType<typeof originalConfig>
    }
    return originalConfig(section)
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
    fire: (target = "chipmate.v2.autocomplete") =>
      callback?.({ affectsConfiguration: (section) => section === target }),
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

async function runProvider(input: {
  cache?: QwenAutocompleteCache
  config: QwenAutocompleteConfig
  edited?: QwenRecentlyEditedSource
  opened?: QwenRecentlyOpenedSource
}): Promise<{ logs: Array<Record<string, unknown>>; prompt: string; single: string }> {
  let prompt = ""
  const document = doc("int main(void) {\n  \n}\n")
  const position = new vscode.Position(1, 2)
  const helper = createQwenAutocompleteHelper(document, position, undefined, opts(input.config))
  const single = buildQwenFimPrompt({ prefix: helper.prunedPrefix, suffix: helper.prunedSuffix })
  const provider = new ChipMateQwenInlineCompletionProvider({
    cache: input.cache,
    client: {
      complete: async (request: QwenFimCompleteInput) => {
        prompt = request.prompt
        request.onResponse?.({ status: 200 })
        return "return ok;"
      },
    } as QwenFimClient,
    edited: input.edited,
    guard: () => false,
    opened: input.opened,
    read: () => input.config,
    log: () => {},
  })

  await provider.provideInlineCompletionItems(
    document,
    position,
    {} as vscode.InlineCompletionContext,
    token() as vscode.CancellationToken,
  )
  provider.dispose()
  return {
    logs: qwenDiagnosticsForTests().map((line) => JSON.parse(line) as Record<string, unknown>),
    prompt,
    single,
  }
}

function fakeEdited(content: string, filepath = "/repo/src/recent.c"): QwenRecentlyEditedSource {
  return {
    count: () => 1,
    dispose: () => {},
    snippets: () => [snippet(filepath, content)],
  }
}

function fakeOpened(snippets: QwenAutocompleteCodeSnippet[], skippedCount = 0): QwenRecentlyOpenedSource {
  return {
    count: () => snippets.length,
    dispose: () => {},
    snippets: async () => ({ skippedCount, snippets }),
  }
}

function snippet(filepath: string, content: string): QwenAutocompleteCodeSnippet {
  return {
    filepath,
    content,
    type: QwenAutocompleteSnippetType.Code,
  }
}

function opts(config: QwenAutocompleteConfig) {
  return {
    maxPromptTokens: config.maxPromptTokens,
    maxSuffixPercentage: config.maxSuffixPercentage,
    modelName: config.model,
    prefixPercentage: config.prefixPercentage,
  }
}

function doc(text: string, input: { languageId?: string; path?: string; scheme?: string; version?: number } = {}) {
  const lines = text.split("\n")
  const file = input.path ?? "/repo/src/main.c"
  return {
    uri: {
      scheme: input.scheme ?? "file",
      fsPath: file,
      path: file,
      toString: () => `file://${file}`,
    },
    languageId: input.languageId ?? "c",
    version: input.version ?? 1,
    lineCount: lines.length,
    lineAt: (value: number | Pos) => {
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

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function offset(lines: string[], pos: Pos): number {
  return lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.character
}
