import { afterEach, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import type { QwenAutocompleteCache } from "../../src/services/qwen-autocomplete/autocompleteLruCache"
import { qwenDiagnosticsForTests, resetQwenDiagnosticsForTests } from "../../src/services/qwen-autocomplete/diagnostics"
import { buildQwenFimPrompt } from "../../src/services/qwen-autocomplete/fimTemplates"
import { createQwenAutocompleteHelper } from "../../src/services/qwen-autocomplete/helperVars"
import {
  fallbackImports,
  QwenImportDefinitionsTracker,
  type QwenImportDefinitionsSource,
} from "../../src/services/qwen-autocomplete/importDefinitions"
import { KiloQwenInlineCompletionProvider } from "../../src/services/qwen-autocomplete/KiloQwenInlineCompletionProvider"
import { QwenFimClient } from "../../src/services/qwen-autocomplete/QwenFimClient"
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

const originalActive = vscode.window.onDidChangeActiveTextEditor

afterEach(() => {
  ;(vscode.window as unknown as { onDidChangeActiveTextEditor: typeof originalActive }).onDidChangeActiveTextEditor =
    originalActive
  resetQwenDiagnosticsForTests()
})

describe("qwen import definitions tracker", () => {
  it("does not register active editor listener or produce payload by default", async () => {
    const events = activeEvents()
    let guarded = 0
    const tracker = new QwenImportDefinitionsTracker({
      guard: () => {
        guarded++
        return false
      },
      read: () => cfg,
    })

    expect(events.active()).toBe(0)
    expect(guarded).toBe(0)
    expect(tracker.count()).toBe(0)
    expect(await tracker.snippets(cfg, helper("int main(void) {\n  foo();\n}\n"), doc("int main;"))).toEqual({
      skippedCount: 0,
      snippets: [],
    })
  })

  it("parses only a bounded prefix and warms cache on active editor changes when enabled", async () => {
    const events = activeEvents()
    const seen: string[] = []
    const tracker = new QwenImportDefinitionsTracker({
      guard: () => false,
      parse: async (_file, content) => {
        seen.push(content)
        return []
      },
      read: () => ({ ...cfg, importDefinitionsEnabled: true }),
    })
    const large = `${Array.from({ length: 120 }, (_, index) => `#include "h${index}.h"`).join("\n")}\nint tail;`

    events.fire(doc(large))
    await tracker.flush()

    expect(events.active()).toBe(1)
    expect(tracker.count()).toBe(1)
    expect(seen[0]!.length).toBeLessThanOrEqual(10_000)
    expect(seen[0]!.split(/\r?\n/).length).toBeLessThanOrEqual(100)
  })

  it("uses bounded fallback include/import parsing only as qwen adapter behavior", () => {
    const imports = fallbackImports('#include "helper_api.h"\nusing foo::Bar;\nimport python_module\nint body;\n')

    expect(imports.map((item) => item.symbol)).toEqual(["helper_api", "Bar", "python_module"])
  })

  it("ignores unsupported schemes, sensitive files, guard errors, failed definitions, empty reads, and timeouts", async () => {
    const tracker = new QwenImportDefinitionsTracker({
      definitions: async (file) => {
        if (file.includes("failed")) throw new Error("lookup failed")
        return [{ filepath: "/repo/src/target.c", range: range(0, 0, 0, 4) }]
      },
      guard: (document) => {
        if (document.uri.fsPath.includes("blocked")) return true
        if (document.uri.fsPath.includes("error")) throw new Error("fail closed")
        return false
      },
      parse: async () => [{ symbol: "foo", position: { line: 0, character: 0 } }],
      read: () => ({ ...cfg, importDefinitionsEnabled: true, importDefinitionsTimeoutMs: 1 }),
      readRange: async (file) => {
        if (file.includes("empty")) return ""
        return "int foo(void);"
      },
    })

    const bad = [
      await tracker.snippets(
        { ...cfg, importDefinitionsEnabled: true },
        helper("foo();"),
        doc("foo();", { scheme: "untitled" }),
      ),
      await tracker.snippets(
        { ...cfg, importDefinitionsEnabled: true },
        helper("foo();"),
        doc("foo();", { path: "/repo/.env" }),
      ),
      await tracker.snippets(
        { ...cfg, importDefinitionsEnabled: true },
        helper("foo();"),
        doc("foo();", { path: "/repo/src/blocked.c" }),
      ),
      await tracker.snippets(
        { ...cfg, importDefinitionsEnabled: true },
        helper("foo();"),
        doc("foo();", { path: "/repo/src/error.c" }),
      ),
      await tracker.snippets(
        { ...cfg, importDefinitionsEnabled: true },
        helper("foo();"),
        doc("foo();", { path: "/repo/src/failed.c" }),
      ),
    ]

    expect(bad.every((item) => item.snippets.length === 0)).toBe(true)
  })

  it("maps successful import definition ranges to Continue-style code snippets", async () => {
    const tracker = new QwenImportDefinitionsTracker({
      definitions: async () => [{ filepath: "/repo/include/helper.h", range: range(1, 0, 3, 0) }],
      guard: () => false,
      parse: async () => [{ symbol: "foo", position: { line: 0, character: 0 } }],
      read: () => ({ ...cfg, importDefinitionsEnabled: true }),
      readRange: async () => "int foo(void);\n",
    })

    const result = await tracker.snippets(
      { ...cfg, importDefinitionsEnabled: true },
      helper("int main(void) {\n  foo();\n}\n"),
      doc('#include "helper.h"\nint main(void) {\n  foo();\n}\n'),
    )

    expect(result).toEqual({
      skippedCount: 0,
      snippets: [
        {
          filepath: "/repo/include/helper.h",
          content: "int foo(void);\n",
          type: QwenAutocompleteSnippetType.Code,
        },
      ],
    })
  })
})

describe("qwen import definitions provider integration", () => {
  it("keeps prompt and CLI request byte-for-byte unchanged in collection-only mode", async () => {
    const output = await runProvider({
      config: { ...cfg, importDefinitionsEnabled: true },
      imports: fakeImports([snippet("/repo/include/helper.h", "int imported_helper(void);")]),
    })

    expect(output.prompt).toBe(output.single)
    expect(output.body).toBe(output.expected)
  })

  it("blocks import definition injection when contextLength is unknown", async () => {
    const output = await runProvider({
      config: {
        ...cfg,
        importDefinitionsEnabled: true,
        importDefinitionsInjectIntoPrompt: true,
        contextLength: 0,
        trace: true,
        logLevel: "debug",
      },
      imports: fakeImports([snippet("/repo/include/helper.h", "int imported_helper(void);")]),
    })

    expect(output.prompt).toBe(output.single)
    expect(output.logs.at(-1)).toMatchObject({
      importDefinitionsInjectedIntoPrompt: false,
      snippetInjectionBlockedReason: "unknown-context-length",
    })
  })

  it("injects selected import definition snippets when all gates pass", async () => {
    const output = await runProvider({
      config: {
        ...cfg,
        contextLength: 8192,
        importDefinitionsEnabled: true,
        importDefinitionsInjectIntoPrompt: true,
        trace: true,
        logLevel: "debug",
      },
      imports: fakeImports([snippet("/repo/include/helper.h", "int imported_helper(void);")]),
    })
    const text = JSON.stringify(output.logs)

    expect(output.prompt).toContain("<|repo_name|>")
    expect(output.prompt).toContain("<|file_sep|>helper.h")
    expect(output.prompt).toContain("imported_helper")
    expect(output.logs.at(-1)).toMatchObject({
      importDefinitionsPayloadCount: 1,
      importDefinitionsSelectedCount: 1,
      importDefinitionsInjectedIntoPrompt: true,
      snippetsInjectedIntoPrompt: true,
    })
    expect(text).not.toContain("imported_helper")
    expect(text).not.toContain("/repo/include/helper.h")
    expect(text).not.toContain("unit.test")
  })

  it("uses helper prefix for cache lookup and rendered prefix for active injection cache put", async () => {
    const cache = new RecordingCache()
    await runProvider({
      cache,
      config: {
        ...cfg,
        cacheEnabled: true,
        contextLength: 8192,
        importDefinitionsEnabled: true,
        importDefinitionsInjectIntoPrompt: true,
      },
      imports: fakeImports([snippet("/repo/include/helper.h", "int imported_helper(void);")]),
    })

    expect(cache.gets[0]).toContain("int main(void)")
    expect(cache.puts[0]?.prefix).toContain("<|repo_name|>")
    expect(cache.puts[0]?.prefix).toContain("<|file_sep|>helper.h")
  })

  it("keeps qwen runtime isolated from forbidden context systems", () => {
    const root = path.join(__dirname, "../../src/services/qwen-autocomplete")
    const source = ["KiloQwenInlineCompletionProvider.ts", "importDefinitions.ts", "index.ts", "snippets.ts"]
      .map((file) => readFileSync(path.join(root, file), "utf8"))
      .join("\n")

    expect(source).not.toContain("getAllSnippetsWithoutRace")
    expect(source).not.toContain("ContextRetrievalService")
    expect(source).not.toContain("semantic_search")
    expect(source).not.toContain("codebase_analysis")
    expect(source).not.toContain("/kilo/fim")
    expect(source).not.toContain("/kilo/edit")
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

async function runProvider(input: {
  cache?: QwenAutocompleteCache
  config: QwenAutocompleteConfig
  imports?: QwenImportDefinitionsSource
}): Promise<{ body: string; expected: string; logs: Array<Record<string, unknown>>; prompt: string; single: string }> {
  let body = ""
  const document = doc("int main(void) {\n  imported_helper();\n}\n")
  const position = new vscode.Position(1, 2)
  const state = createQwenAutocompleteHelper(document, position, undefined, opts(input.config))
  const single = buildQwenFimPrompt({ prefix: state.prunedPrefix, suffix: state.prunedSuffix })
  const expected = JSON.stringify({
    providerID: input.config.providerID,
    modelID: input.config.model,
    prompt: single,
    maxTokens: input.config.maxTokens,
    temperature: input.config.temperature,
  })
  const provider = new KiloQwenInlineCompletionProvider({
    cache: input.cache,
    client: {
      complete: async (request: QwenFimCompleteInput) => {
        body = JSON.stringify({
          providerID: request.providerID,
          modelID: request.modelID,
          prompt: request.prompt,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
        })
        request.onResponse?.({ status: 200 })
        return "return ok;"
      },
    } as QwenFimClient,
    guard: () => false,
    imports: input.imports,
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
    body,
    expected,
    logs: qwenDiagnosticsForTests().map((line) => JSON.parse(line) as Record<string, unknown>),
    prompt: JSON.parse(body).prompt,
    single,
  }
}

function fakeImports(snippets: QwenAutocompleteCodeSnippet[], skippedCount = 0): QwenImportDefinitionsSource {
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

function activeEvents() {
  const actives: Array<(editor: { document: vscode.TextDocument } | undefined) => void> = []
  let disposed = 0
  ;(vscode.window as unknown as { onDidChangeActiveTextEditor: typeof originalActive }).onDidChangeActiveTextEditor = (
    callback,
  ) => {
    actives.push(callback as (editor: { document: vscode.TextDocument } | undefined) => void)
    return { dispose: () => disposed++ }
  }
  return {
    active: () => actives.length,
    disposed: () => disposed,
    fire: (document: vscode.TextDocument) => actives.forEach((callback) => callback({ document })),
  }
}

function helper(text: string) {
  return createQwenAutocompleteHelper(doc(text), new vscode.Position(1, 2), undefined, opts(cfg))
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
    getText: (inputRange?: Range) => {
      if (!inputRange) return text
      return text.slice(offset(lines, inputRange.start), offset(lines, inputRange.end))
    },
  } as unknown as vscode.TextDocument
}

function token() {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} }),
  }
}

function range(startLine: number, startCharacter: number, endLine: number, endCharacter: number): Range {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  }
}

function offset(lines: string[], pos: Pos): number {
  return lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.character
}
