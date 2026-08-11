import { afterEach, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import type { QwenAutocompleteCache } from "../../src/services/qwen-autocomplete/autocompleteLruCache"
import { qwenDiagnosticsForTests, resetQwenDiagnosticsForTests } from "../../src/services/qwen-autocomplete/diagnostics"
import { buildQwenFimPrompt } from "../../src/services/qwen-autocomplete/fimTemplates"
import { createQwenAutocompleteHelper } from "../../src/services/qwen-autocomplete/helperVars"
import type { QwenImportDefinitionsSource } from "../../src/services/qwen-autocomplete/importDefinitions"
import { ChipMateQwenInlineCompletionProvider } from "../../src/services/qwen-autocomplete/ChipMateQwenInlineCompletionProvider"
import { QwenFimClient } from "../../src/services/qwen-autocomplete/QwenFimClient"
import type { QwenRecentlyEditedSource } from "../../src/services/qwen-autocomplete/recentlyEdited"
import type { QwenRecentlyOpenedSource } from "../../src/services/qwen-autocomplete/recentlyOpened"
import {
  keyFor,
  QwenRootPathTracker,
  supportedRootPathNodeTypes,
  type QwenRootPathSource,
} from "../../src/services/qwen-autocomplete/rootPathContext"
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

afterEach(() => {
  resetQwenDiagnosticsForTests()
})

describe("qwen root path tracker", () => {
  it("does no AST/query/provider work by default", async () => {
    let calls = 0
    const tracker = new QwenRootPathTracker({
      path: async () => {
        calls++
        return [node("function_definition", 1)]
      },
    })

    expect(await tracker.snippets(cfg, helper("int main(void) {\n  foo();\n}\n"))).toEqual({
      blockedReason: "disabled",
      skippedCount: 0,
      snippets: [],
    })
    expect(calls).toBe(0)
  })

  it("returns missing-tree-path when AST infrastructure is unavailable", async () => {
    const tracker = new QwenRootPathTracker({
      path: async () => undefined,
    })

    expect(
      await tracker.snippets({ ...cfg, rootPathEnabled: true }, helper("int main(void) {\n  foo();\n}\n")),
    ).toEqual({
      blockedReason: "missing-tree-path",
      skippedCount: 0,
      snippets: [],
    })
  })

  it("uses program nodes only for import priming and queries non-program whitelisted nodes", async () => {
    const queried: string[] = []
    const tracker = new QwenRootPathTracker({
      definitions: async () => [{ filepath: "/repo/include/types.h", range: range(0, 0, 0, 9) }],
      guard: () => false,
      path: async () => [node("program", 1), node("identifier", 2), node("function_definition", 3)],
      query: async (_file, current) => {
        queried.push(current.type)
        return [{ line: 1, character: 4 }]
      },
      readRange: async () => "typedef int foo_t;",
    })

    const result = await tracker.snippets(
      { ...cfg, rootPathEnabled: true },
      helper("int main(void) {\n  foo_t value;\n}\n"),
    )

    expect(queried).toEqual(["function_definition"])
    expect(result.snippets).toEqual([
      {
        filepath: "/repo/include/types.h",
        content: "typedef int foo_t;",
        type: QwenAutocompleteSnippetType.Code,
      },
    ])
  })

  it("uses deterministic cache keys and honors rootPath cache bounds", async () => {
    let reads = 0
    const tracker = new QwenRootPathTracker({
      definitions: async (_file, pos) => [{ filepath: `/repo/include/${pos.line}.h`, range: range(0, 0, 0, 8) }],
      guard: () => false,
      path: async () => [node("function_definition", 3), node("class_definition", 4)],
      query: async (_file, current) => [{ line: current.startIndex, character: 0 }],
      readRange: async () => {
        reads++
        return "int cached;"
      },
    })
    const opts = { ...cfg, rootPathEnabled: true, rootPathCacheSize: 1 }

    await tracker.snippets(opts, helper("int main(void) {\n  foo();\n}\n"))
    await tracker.snippets(opts, helper("int main(void) {\n  foo();\n}\n"))

    expect(keyFor("parent", node("function_definition", 3))).toBe(keyFor("parent", node("function_definition", 3)))
    expect(tracker.count()).toBe(1)
    expect(reads).toBe(4)
  })

  it("ignores failed lookups, sensitive targets, guard errors, empty reads, and unsupported files", async () => {
    const tracker = new QwenRootPathTracker({
      definitions: async () => [
        { filepath: "/repo/src/blocked.c", range: range(0, 0, 0, 1) },
        { filepath: "/repo/.env", range: range(0, 0, 0, 1) },
        { filepath: "/repo/src/empty.c", range: range(0, 0, 0, 1) },
        { filepath: "/repo/src/ok.c", range: range(0, 0, 0, 1) },
      ],
      guard: (document) => {
        if (document.uri.fsPath.includes("blocked")) return true
        return false
      },
      path: async () => [node("function_definition", 3)],
      query: async () => [{ line: 1, character: 0 }],
      readRange: async (file) => (file.includes("empty") ? "" : "int ok;"),
    })

    const result = await tracker.snippets({ ...cfg, rootPathEnabled: true }, helper("int main(void) {\n  ok();\n}\n"))

    expect(result.snippets.map((item) => item.filepath)).toEqual(["/repo/src/ok.c"])
  })

  it("exposes the Continue root path node allowlist", () => {
    const types = supportedRootPathNodeTypes()

    expect(types.has("program")).toBe(true)
    expect(types.has("function_definition")).toBe(true)
    expect(types.has("identifier")).toBe(false)
  })
})

describe("qwen root path provider integration", () => {
  it("keeps prompt and HTTP request body byte-for-byte unchanged in collection-only mode", async () => {
    const output = await runProvider({
      config: { ...cfg, rootPathEnabled: true },
      root: fakeRoot([snippet("/repo/include/root.h", "int root_helper(void);")]),
    })

    expect(output.prompt).toBe(output.single)
    expect(output.body).toBe(output.expected)
  })

  it("blocks root path injection when contextLength is unknown", async () => {
    const output = await runProvider({
      config: {
        ...cfg,
        rootPathEnabled: true,
        rootPathInjectIntoPrompt: true,
        contextLength: 0,
        trace: true,
        logLevel: "debug",
      },
      root: fakeRoot([snippet("/repo/include/root.h", "int root_helper(void);")]),
    })

    expect(output.prompt).toBe(output.single)
    expect(output.logs.at(-1)).toMatchObject({
      rootPathInjectedIntoPrompt: false,
      rootPathBlockedReason: "none",
      snippetInjectionBlockedReason: "unknown-context-length",
    })
  })

  it("injects selected root path snippets when all gates pass", async () => {
    const output = await runProvider({
      config: {
        ...cfg,
        contextLength: 8192,
        rootPathEnabled: true,
        rootPathInjectIntoPrompt: true,
        trace: true,
        logLevel: "debug",
      },
      root: fakeRoot([snippet("/repo/include/root.h", "int root_helper(void);")]),
    })
    const text = JSON.stringify(output.logs)

    expect(output.prompt).toContain("<|file_sep|>root.h")
    expect(output.prompt).toContain("root_helper")
    expect(output.logs.at(-1)).toMatchObject({
      rootPathPayloadCount: 1,
      rootPathSelectedCount: 1,
      rootPathInjectedIntoPrompt: true,
      snippetsInjectedIntoPrompt: true,
    })
    expect(text).not.toContain("root_helper")
    expect(text).not.toContain("/repo/include/root.h")
    expect(text).not.toContain("unit.test")
  })

  it("dedupes combined edited opened import and root injection by source priority", async () => {
    const output = await runProvider({
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
      },
      edited: fakeEdited("int edited_latest(void);", "/repo/shared.h"),
      imports: fakeImports([snippet("/repo/import.h", "int import_helper(void);")]),
      opened: fakeOpened([snippet("/repo/shared.h", "int opened_old(void);")]),
      root: fakeRoot([snippet("/repo/import.h", "int root_duplicate(void);")]),
    })

    expect(output.prompt).toContain("edited_latest")
    expect(output.prompt).toContain("import_helper")
    expect(output.prompt).not.toContain("opened_old")
    expect(output.prompt).not.toContain("root_duplicate")
    expect(output.prompt.split("<|file_sep|>shared.h").length - 1).toBe(1)
    expect(output.prompt.split("<|file_sep|>import.h").length - 1).toBe(1)
  })

  it("uses helper prefix for cache lookup and rendered prefix for active root injection cache put", async () => {
    const cache = new RecordingCache()
    await runProvider({
      cache,
      config: {
        ...cfg,
        cacheEnabled: true,
        contextLength: 8192,
        rootPathEnabled: true,
        rootPathInjectIntoPrompt: true,
      },
      root: fakeRoot([snippet("/repo/include/root.h", "int root_helper(void);")]),
    })

    expect(cache.gets[0]).toContain("int main(void)")
    expect(cache.puts[0]?.prefix).toContain("<|repo_name|>")
    expect(cache.puts[0]?.prefix).toContain("<|file_sep|>root.h")
  })

  it("keeps qwen runtime isolated from forbidden context systems", () => {
    const root = path.join(__dirname, "../../src/services/qwen-autocomplete")
    const source = ["ChipMateQwenInlineCompletionProvider.ts", "rootPathContext.ts", "importDefinitions.ts", "snippets.ts"]
      .map((file) => readFileSync(path.join(root, file), "utf8"))
      .join("\n")

    expect(source).not.toContain("getAllSnippetsWithoutRace")
    expect(source).not.toContain("ContextRetrievalService")
    expect(source).not.toContain("RootPathContextService")
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

async function runProvider(input: {
  cache?: QwenAutocompleteCache
  config: QwenAutocompleteConfig
  edited?: QwenRecentlyEditedSource
  imports?: QwenImportDefinitionsSource
  opened?: QwenRecentlyOpenedSource
  root?: QwenRootPathSource
}): Promise<{ body: string; expected: string; logs: Array<Record<string, unknown>>; prompt: string; single: string }> {
  let body = ""
  const document = doc("int main(void) {\n  root_helper();\n}\n")
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
  const provider = new ChipMateQwenInlineCompletionProvider({
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
    opened: input.opened,
    read: () => input.config,
    root: input.root,
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

function fakeEdited(content: string, filepath = "/repo/recent.h"): QwenRecentlyEditedSource {
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

function fakeRoot(snippets: QwenAutocompleteCodeSnippet[], blockedReason = "none"): QwenRootPathSource {
  return {
    count: () => snippets.length,
    dispose: () => {},
    snippets: async () => ({ blockedReason, skippedCount: 0, snippets }),
  }
}

function snippet(filepath: string, content: string): QwenAutocompleteCodeSnippet {
  return {
    filepath,
    content,
    type: QwenAutocompleteSnippetType.Code,
  }
}

function node(type: string, startIndex: number) {
  return {
    endPosition: { row: startIndex, column: 1 },
    startIndex,
    type,
  } as unknown as Parameters<typeof keyFor>[1]
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

function doc(text: string) {
  const lines = text.split("\n")
  return {
    uri: {
      scheme: "file",
      fsPath: "/repo/src/main.c",
      path: "/repo/src/main.c",
      toString: () => "file:///repo/src/main.c",
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
    getText: (input?: Range) => {
      if (!input) return text
      return text.slice(offset(lines, input.start), offset(lines, input.end))
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
