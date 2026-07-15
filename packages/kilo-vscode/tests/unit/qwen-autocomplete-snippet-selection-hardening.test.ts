import { afterEach, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import type { QwenAutocompleteCache } from "../../src/services/qwen-autocomplete/autocompleteLruCache"
import { qwenDiagnosticsForTests, resetQwenDiagnosticsForTests } from "../../src/services/qwen-autocomplete/diagnostics"
import { createQwenAutocompleteHelper } from "../../src/services/qwen-autocomplete/helperVars"
import { KiloQwenInlineCompletionProvider } from "../../src/services/qwen-autocomplete/KiloQwenInlineCompletionProvider"
import { QwenFimClient } from "../../src/services/qwen-autocomplete/QwenFimClient"
import type { QwenImportDefinitionsSource } from "../../src/services/qwen-autocomplete/importDefinitions"
import type { QwenRecentlyEditedSource } from "../../src/services/qwen-autocomplete/recentlyEdited"
import type { QwenRecentlyOpenedSource } from "../../src/services/qwen-autocomplete/recentlyOpened"
import type { QwenRootPathSource } from "../../src/services/qwen-autocomplete/rootPathContext"
import {
  emptyQwenSnippetPayload,
  QwenAutocompleteSnippetType,
  selectQwenSnippets,
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

afterEach(() => {
  resetQwenDiagnosticsForTests()
})

describe("qwen autocomplete snippet selection hardening", () => {
  it("filters caret-window duplicates only for base-like import and root snippets", () => {
    const helper = createQwenAutocompleteHelper(
      doc("int main(void) {\n  int shared_symbol;\n  \n}\n"),
      new vscode.Position(2, 2),
    )
    const payload = emptyQwenSnippetPayload()
    payload.recentlyEditedRangeSnippets = [snippet("/repo/src/edit.c", "int shared_symbol;")]
    payload.recentlyOpenedFileSnippets = [snippet("/repo/src/open.c", "int shared_symbol;")]
    payload.importDefinitionSnippets = [snippet("/repo/include/import.h", "int shared_symbol;")]
    payload.rootPathSnippets = [snippet("/repo/include/root.h", "int shared_symbol;")]

    const selection = selectQwenSnippets(helper, payload, {
      includeRecentlyEditedRanges: true,
      maxPromptTokens: cfg.maxPromptTokens,
      modelName: cfg.model,
      useImports: true,
      useRecentlyOpened: true,
      useRootPath: true,
    })

    expect(selection.snippets).toContain(payload.recentlyOpenedFileSnippets[0])
    expect(selection.snippets).toContain(payload.recentlyEditedRangeSnippets[0])
    expect(selection.snippets).not.toContain(payload.importDefinitionSnippets[0])
    expect(selection.snippets).not.toContain(payload.rootPathSnippets[0])
    expect(selection.baseSnippetSelectedCount).toBe(0)
  })

  it("formats recently opened context with 10-file consideration, 5-file target, and bottom trimming", () => {
    const helper = createQwenAutocompleteHelper(doc("int main(void) {\n  \n}\n"), new vscode.Position(1, 2))
    const roomy = emptyQwenSnippetPayload()
    roomy.recentlyOpenedFileSnippets = Array.from({ length: 12 }, (_, index) =>
      snippet(`/repo/src/open${index}.c`, `int open_${index}(void) { return ${index}; }`),
    )
    const full = selectQwenSnippets(helper, roomy, {
      maxPromptTokens: 10_000,
      modelName: cfg.model,
      useRecentlyOpened: true,
    })

    expect(full.selectedCount).toBe(5)
    expect(full.recentlyOpenedFormattedCount).toBe(5)

    const tight = emptyQwenSnippetPayload()
    tight.recentlyOpenedFileSnippets = Array.from({ length: 10 }, (_, index) =>
      snippet(
        `/repo/src/large${index}.c`,
        Array.from({ length: 80 }, (_, line) => `int value_${index}_${line};`).join("\n"),
      ),
    )
    const trimmed = selectQwenSnippets(helper, tight, {
      maxPromptTokens: 320,
      modelName: cfg.model,
      useRecentlyOpened: true,
    })

    expect(trimmed.recentlyOpenedFormattedCount).toBeLessThanOrEqual(5)
    expect(trimmed.recentlyOpenedTrimmedCount).toBeGreaterThan(0)
    expect(trimmed.selectedCount).toBe(trimmed.recentlyOpenedFormattedCount)
  })

  it("keeps collection-only prompt, request body, and cache put on the non-injection adapter path", async () => {
    const cache = new RecordingCache()
    const output = await run({
      cache,
      config: {
        ...cfg,
        cacheEnabled: true,
        contextLength: 8192,
        recentlyEditedEnabled: true,
        recentlyEditedInjectIntoPrompt: false,
        recentlyOpenedEnabled: true,
        recentlyOpenedInjectIntoPrompt: false,
        importDefinitionsEnabled: true,
        importDefinitionsInjectIntoPrompt: false,
        rootPathEnabled: true,
        rootPathInjectIntoPrompt: false,
      },
      edited: fakeEdited("int edited_helper(void);", "/repo/src/edit.c"),
      imports: fakeImports([snippet("/repo/include/import.h", "int import_helper(void);")]),
      opened: fakeOpened([snippet("/repo/src/open.c", "int opened_helper(void);")]),
      root: fakeRoot([snippet("/repo/include/root.h", "int root_helper(void);")]),
    })

    expect(output.prompt).not.toContain("<|repo_name|>")
    expect(output.prompt).not.toContain("edited_helper")
    expect(output.prompt).not.toContain("opened_helper")
    expect(output.prompt).not.toContain("import_helper")
    expect(output.prompt).not.toContain("root_helper")
    expect(cache.gets[0]).toBe(cache.puts[0]?.prefix)
  })

  it("uses deterministic qwen injection priority and reports redacted aggregate diagnostics", async () => {
    const output = await run({
      config: {
        ...cfg,
        contextLength: 8192,
        recentlyEditedEnabled: true,
        recentlyEditedInjectIntoPrompt: true,
        recentlyOpenedEnabled: true,
        recentlyOpenedInjectIntoPrompt: true,
        importDefinitionsEnabled: true,
        importDefinitionsInjectIntoPrompt: true,
        rootPathEnabled: true,
        rootPathInjectIntoPrompt: true,
        trace: true,
        logLevel: "debug",
      },
      edited: fakeEdited("int edited_latest(void);", "/repo/shared.h"),
      imports: fakeImports([snippet("/repo/include/import.h", "int import_helper(void);")]),
      opened: fakeOpened([snippet("/repo/shared.h", "int opened_stale(void);")]),
      root: fakeRoot([snippet("/repo/include/import.h", "int root_duplicate(void);")]),
    })
    const logs = qwenDiagnosticsForTests().map((line) => JSON.parse(line) as Record<string, unknown>)
    const last = logs.at(-1)!
    const text = JSON.stringify(logs)

    expect(output.prompt).toContain("edited_latest")
    expect(output.prompt).toContain("import_helper")
    expect(output.prompt).not.toContain("opened_stale")
    expect(output.prompt).not.toContain("root_duplicate")
    expect(output.prompt.split("<|file_sep|>shared.h").length - 1).toBe(1)
    expect(output.prompt.split("<|file_sep|>import.h").length - 1).toBe(1)
    expect(last).toMatchObject({
      snippetSelectionAdapterPriority: "recentlyEdited>recentlyOpened>importDefinitions>rootPath",
      snippetSelectionDroppedDuplicateFileCount: expect.any(Number),
      snippetSelectionInjectedCount: 2,
      snippetSelectionInjectedSources: "recentlyEdited,importDefinitions",
      snippetsInjectedIntoPrompt: true,
    })
    expect(text).not.toContain("edited_latest")
    expect(text).not.toContain("import_helper")
    expect(text).not.toContain("/repo/shared.h")
    expect(text).not.toContain("unit.test")
  })

  it("keeps forbidden context sources and endpoints out of qwen runtime source", () => {
    const root = path.join(__dirname, "../../src/services/qwen-autocomplete")
    const source = [
      "KiloQwenInlineCompletionProvider.ts",
      "snippets.ts",
      "qwenMultifileFimRenderer.ts",
      "importDefinitions.ts",
      "rootPathContext.ts",
      "recentlyOpened.ts",
    ]
      .map((file) => readFileSync(path.join(root, file), "utf8"))
      .join("\n")

    expect(source).not.toContain("getAllSnippetsWithoutRace")
    expect(source).not.toContain("ContextRetrievalService")
    expect(source).not.toContain("ImportDefinitionsService")
    expect(source).not.toContain("RootPathContextService")
    expect(source).not.toContain("CompletionStreamer")
    expect(source).not.toContain("GeneratorReuseManager")
    expect(source).not.toContain("semantic_search")
    expect(source).not.toContain("codebase_analysis")
    expect(source).not.toContain("/kilo/fim")
    expect(source).not.toContain("/kilo/edit")
    expect(source).not.toContain("/v1/chat/completions")
    expect(source).not.toMatch(/document[- ]?symbol/i)
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

async function run(input: {
  cache?: QwenAutocompleteCache
  config: QwenAutocompleteConfig
  edited?: QwenRecentlyEditedSource
  imports?: QwenImportDefinitionsSource
  opened?: QwenRecentlyOpenedSource
  root?: QwenRootPathSource
}): Promise<{ body: string; prompt: string }> {
  let body = ""
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
    edited: input.edited,
    guard: () => false,
    imports: input.imports,
    log: () => {},
    opened: input.opened,
    read: () => input.config,
    root: input.root,
  })
  await provider.provideInlineCompletionItems(
    doc("int main(void) {\n  \n}\n"),
    new vscode.Position(1, 2),
    {} as vscode.InlineCompletionContext,
    token() as vscode.CancellationToken,
  )
  provider.dispose()
  return { body, prompt: String(JSON.parse(body).prompt) }
}

function fakeEdited(content: string, filepath: string): QwenRecentlyEditedSource {
  return {
    count: () => 1,
    dispose: () => {},
    snippets: () => [snippet(filepath, content)],
  }
}

function fakeOpened(snippets: QwenAutocompleteCodeSnippet[]): QwenRecentlyOpenedSource {
  return {
    count: () => snippets.length,
    dispose: () => {},
    snippets: async () => ({ skippedCount: 0, snippets }),
  }
}

function fakeImports(snippets: QwenAutocompleteCodeSnippet[]): QwenImportDefinitionsSource {
  return {
    count: () => snippets.length,
    dispose: () => {},
    snippets: async () => ({ skippedCount: 0, snippets }),
  }
}

function fakeRoot(snippets: QwenAutocompleteCodeSnippet[]): QwenRootPathSource {
  return {
    count: () => snippets.length,
    dispose: () => {},
    snippets: async () => ({ blockedReason: "none", skippedCount: 0, snippets }),
  }
}

function snippet(filepath: string, content: string): QwenAutocompleteCodeSnippet {
  return {
    content,
    filepath,
    type: QwenAutocompleteSnippetType.Code,
  }
}

function doc(text: string) {
  const lines = text.split("\n")
  return {
    uri: {
      scheme: "file",
      fsPath: "/repo/src/main.c",
      path: "/repo/src/main.c",
    },
    languageId: "c",
    version: 1,
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

function offset(lines: string[], pos: Pos): number {
  return lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.character
}
