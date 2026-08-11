import { afterEach, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import type { QwenAutocompleteCache } from "../../src/services/qwen-autocomplete/autocompleteLruCache"
import { qwenDiagnosticsForTests, resetQwenDiagnosticsForTests } from "../../src/services/qwen-autocomplete/diagnostics"
import { buildQwenFimPrompt } from "../../src/services/qwen-autocomplete/fimTemplates"
import {
  createQwenAutocompleteHelper,
  type QwenAutocompleteHelperVars,
} from "../../src/services/qwen-autocomplete/helperVars"
import { ChipMateQwenInlineCompletionProvider } from "../../src/services/qwen-autocomplete/ChipMateQwenInlineCompletionProvider"
import { QwenFimClient } from "../../src/services/qwen-autocomplete/QwenFimClient"
import {
  buildQwenPromptPlan,
  renderQwenMultifileFimPromptWithTokenLimit,
} from "../../src/services/qwen-autocomplete/qwenMultifileFimRenderer"
import type { QwenRecentlyEditedSource } from "../../src/services/qwen-autocomplete/recentlyEdited"
import { QwenAutocompleteSnippetType } from "../../src/services/qwen-autocomplete/snippets"
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
  temperature: 0.01,
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

const originalFile = vscode.Uri.file
const originalFolders = vscode.workspace.workspaceFolders

afterEach(() => {
  ;(vscode.Uri as unknown as { file: typeof originalFile }).file = originalFile
  ;(vscode.workspace as unknown as { workspaceFolders: typeof originalFolders }).workspaceFolders = originalFolders
  resetQwenDiagnosticsForTests()
})

describe("qwen prompt rendering", () => {
  it("normalizes an empty EOF suffix in single, blocked, and multifile prompts", () => {
    const helper = { ...state(doc("int main(void) {")), prunedSuffix: "" }
    const single = buildQwenPromptPlan({ cfg, helper, snippets: [] })
    const blocked = buildQwenPromptPlan({ cfg: { ...active(), contextLength: 0 }, helper, snippets: recent() })
    const multifile = buildQwenPromptPlan({ cfg: active(), helper, snippets: recent() })

    for (const prompt of [single, blocked, multifile]) {
      expect(prompt.prompt).toContain("<|fim_suffix|>\n<|fim_middle|>")
      expect(prompt.renderedSuffix).toBe("\n")
      expect(prompt.renderedSuffixChars).toBe(1)
    }
  })

  it("keeps the default FIM prompt byte-for-byte unchanged", () => {
    const document = doc("int main(void) {\n  ret\n}\n")
    const helper = state(document)
    const prompt = buildQwenPromptPlan({ cfg, helper, snippets: recent() })
    const expected = buildQwenFimPrompt({ prefix: helper.prunedPrefix, suffix: helper.prunedSuffix })

    expect(prompt.prompt).toBe(expected)
    expect(prompt.snippetsInjectedIntoPrompt).toBe(false)
    expect(prompt.promptRendererMode).toBe("disabled")
  })

  it("keeps the default CLI request byte-for-byte unchanged", async () => {
    let body = ""
    const document = doc("int main(void) {\n  \n}\n")
    const position = new vscode.Position(1, 2)
    const helper = createQwenAutocompleteHelper(document, position, undefined, opts(cfg))
    const prompt = buildQwenFimPrompt({ prefix: helper.prunedPrefix, suffix: helper.prunedSuffix })
    const expected = JSON.stringify({
      providerID: cfg.providerID,
      modelID: cfg.model,
      prompt,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
    })
    const provider = new ChipMateQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: client((request) => {
        body = request
      }),
      edited: fakeEdited("int hidden;"),
      log: () => {},
    })

    await provider.provideInlineCompletionItems(
      document,
      position,
      {} as vscode.InlineCompletionContext,
      token() as vscode.CancellationToken,
    )

    expect(body).toBe(expected)
    expect(JSON.parse(body).prompt).toBe(prompt)
    provider.dispose()
  })

  it("does not inject when recently edited is enabled without injectIntoPrompt", () => {
    const document = doc("int main(void) {\n  ret\n}\n")
    const helper = state(document)
    const prompt = buildQwenPromptPlan({
      cfg: { ...active(), recentlyEditedInjectIntoPrompt: false },
      helper,
      snippets: recent(),
    })

    expect(prompt.prompt).toBe(buildQwenFimPrompt({ prefix: helper.prunedPrefix, suffix: helper.prunedSuffix }))
    expect(prompt.snippetsInjectedIntoPrompt).toBe(false)
    expect(prompt.snippetInjectionBlockedReason).toBe("disabled")
  })

  it("does not inject when contextLength is unknown or insufficient", () => {
    const document = doc("int main(void) {\n  ret\n}\n")
    const helper = state(document)
    const unknown = buildQwenPromptPlan({ cfg: { ...active(), contextLength: 0 }, helper, snippets: recent() })
    const small = buildQwenPromptPlan({
      cfg: { ...active(), contextLength: 103, maxPromptTokens: 100, maxTokens: 2 },
      helper,
      snippets: recent(),
    })
    const expected = buildQwenFimPrompt({ prefix: helper.prunedPrefix, suffix: helper.prunedSuffix })

    expect(unknown.prompt).toBe(expected)
    expect(unknown.snippetInjectionBlockedReason).toBe("unknown-context-length")
    expect(small.prompt).toBe(expected)
    expect(small.snippetInjectionBlockedReason).toBe("insufficient-context-length")
  })

  it("renders active qwen multifile FIM prompt exactly", () => {
    const document = doc("int main(void) {\n  ret\n}\n")
    const helper = state(document)
    const prompt = buildQwenPromptPlan({ cfg: active(), helper, snippets: recent() })
    const expected = [
      "<|repo_name|>repo",
      "<|file_sep|>recent.c",
      "int helper(void) {",
      "  return 1;",
      "}",
      "<|file_sep|>math.c",
      "int add(int a, int b) {",
      "  return a + b;",
      "}",
      "<|file_sep|>main.c",
      "<|fim_prefix|>int main(void) {",
      "  ret<|fim_suffix|>",
      "}",
      "<|fim_middle|>",
    ].join("\n")

    expect(prompt.prompt).toBe(expected)
    expect(prompt.renderedPrefix).toBe(
      [
        "<|repo_name|>repo",
        "<|file_sep|>recent.c",
        "int helper(void) {",
        "  return 1;",
        "}",
        "<|file_sep|>math.c",
        "int add(int a, int b) {",
        "  return a + b;",
        "}",
        "<|file_sep|>main.c<|system_separator_istruction_repository_level|>int main(void) {",
        "  ret",
      ].join("\n"),
    )
    expect(prompt.renderedSuffix).toBe("\n}\n")
    expect(prompt.snippetsInjectedIntoPrompt).toBe(true)
    expect(prompt.promptRendererMode).toBe("qwen-multifile-fim")
  })

  it("renders combined recently edited and recently opened snippets through the same qwen multifile FIM path", () => {
    const document = doc("int main(void) {\n  ret\n}\n")
    const helper = state(document)
    const opened = {
      filepath: "/repo/src/opened.c",
      content: "int opened_helper(void) {\n  return 3;\n}",
      type: QwenAutocompleteSnippetType.Code,
    }
    const prompt = buildQwenPromptPlan({
      cfg: { ...active(), recentlyOpenedEnabled: true, recentlyOpenedInjectIntoPrompt: true },
      helper,
      injectIntoPrompt: true,
      snippets: [...recent(), opened],
    })

    expect(prompt.snippetsInjectedIntoPrompt).toBe(true)
    expect(prompt.prompt).toContain("<|file_sep|>recent.c")
    expect(prompt.prompt).toContain("<|file_sep|>opened.c")
    expect(prompt.prompt).toContain("opened_helper")
  })

  it("renders import and root snippets through the same qwen multifile FIM path", () => {
    const document = doc("int main(void) {\n  ret\n}\n")
    const helper = state(document)
    const shared = {
      filepath: "/repo/include/shared.h",
      content: "int import_helper(void);",
      type: QwenAutocompleteSnippetType.Code,
    }
    const root = {
      filepath: "/repo/include/shared.h",
      content: "int root_duplicate(void);",
      type: QwenAutocompleteSnippetType.Code,
    }
    const prompt = buildQwenPromptPlan({
      cfg: {
        ...active(),
        importDefinitionsEnabled: true,
        importDefinitionsInjectIntoPrompt: true,
        rootPathEnabled: true,
        rootPathInjectIntoPrompt: true,
      },
      helper,
      injectIntoPrompt: true,
      snippets: [shared, root],
    })

    expect(prompt.snippetsInjectedIntoPrompt).toBe(true)
    expect(prompt.prompt).toContain("import_helper")
    expect(prompt.prompt).toContain("root_duplicate")
    expect(prompt.prompt.split("<|file_sep|>include/shared.h").length - 1).toBe(2)
  })

  it("falls back unchanged if active prompt still exceeds budget after qwen adapter pruning", () => {
    const document = doc("int main(void) {\n  ret\n}\n")
    const helper = state(document)
    const huge = [
      {
        filepath: "/repo/src/recent.c",
        content: Array.from({ length: 200 }, (_, index) => `int very_long_recent_symbol_${index};`).join("\n"),
        type: QwenAutocompleteSnippetType.Code,
      },
    ]
    const prompt = buildQwenPromptPlan({
      cfg: { ...active(), contextLength: 104, maxPromptTokens: 100, maxTokens: 1 },
      helper,
      snippets: huge,
    })

    expect(prompt.prompt).toBe(buildQwenFimPrompt({ prefix: helper.prunedPrefix, suffix: helper.prunedSuffix }))
    expect(prompt.snippetsInjectedIntoPrompt).toBe(false)
    expect(prompt.snippetInjectionBlockedReason).toBe("insufficient-context-length")
    expect(prompt.prompt).not.toContain("very_long_recent_symbol")
  })

  it("uses rendered prefix for cache put only when injection is active", async () => {
    patchUri()
    const inactive = new RecordingCache()
    await runWithCache({ ...active(), recentlyEditedInjectIntoPrompt: false }, inactive)
    const activeCache = new RecordingCache()
    await runWithCache(active(), activeCache)

    expect(inactive.gets[0]).toBe(inactive.puts[0]?.prefix)
    expect(activeCache.gets[0]).not.toBe(activeCache.puts[0]?.prefix)
    expect(activeCache.gets[0]).toContain("int main(void)")
    expect(activeCache.puts[0]?.prefix).toContain("<|repo_name|>repo")
    expect(activeCache.puts[0]?.prefix).toContain("<|file_sep|>recent.c")
  })

  it("reports redacted prompt renderer diagnostics", async () => {
    patchUri()
    const provider = new ChipMateQwenInlineCompletionProvider({
      read: () => ({ ...active(), trace: true, logLevel: "debug", logPromptPreview: true }),
      guard: () => false,
      client: client(),
      edited: fakeEdited("int helper(void) {\n  return 1;\n}"),
      log: () => {},
    })

    await provider.provideInlineCompletionItems(
      doc("int main(void) {\n  \n}\n"),
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token() as vscode.CancellationToken,
    )

    const logs = qwenDiagnosticsForTests().map((line) => JSON.parse(line) as Record<string, unknown>)
    const text = JSON.stringify(logs)
    expect(logs.at(-1)).toMatchObject({
      recentlyEditedInjectIntoPrompt: true,
      contextLength: 8192,
      promptRendererMode: "qwen-multifile-fim",
      snippetInjectionBlockedReason: "none",
      snippetsInjectedIntoPrompt: true,
      renderedPrefixChars: expect.any(Number),
      renderedSuffixChars: expect.any(Number),
      renderedPromptChars: expect.any(Number),
      estimatedRenderedPromptTokens: expect.any(Number),
    })
    expect(text).not.toContain("int helper")
    expect(text).not.toContain("<|repo_name|>")
    expect(text).not.toContain("/repo/src/recent.c")
    expect(text).not.toContain("unit.test")
    expect(logs.every((line) => line.promptPreview === null)).toBe(true)
    provider.dispose()
  })

  it("keeps qwen autocomplete source isolated from forbidden context systems", () => {
    const root = path.join(__dirname, "../../src/services/qwen-autocomplete")
    const source = [
      "ChipMateQwenInlineCompletionProvider.ts",
      "qwenMultifileFimRenderer.ts",
      "snippets.ts",
      "recentlyEdited.ts",
    ]
      .map((file) => readFileSync(path.join(root, file), "utf8"))
      .join("\n")

    expect(source).not.toContain("getAllSnippetsWithoutRace")
    expect(source).not.toContain("ContextRetrievalService")
    expect(source).not.toContain("semantic_search")
    expect(source).not.toContain("codebase_analysis")
    expect(source).not.toContain("/chipmate/fim")
    expect(source).not.toContain("/chipmate/edit")
    expect(source).not.toContain("/v1/chat/completions")
    expect(source).not.toMatch(/from\s+["'][^"']*AutocompleteTemplate/)
    expect(source).not.toMatch(/from\s+["'][^"']*Handlebars/)
  })

  it("exposes the active renderer only for already gated calls", () => {
    const document = doc("int main(void) {\n  ret\n}\n")
    const helper = state(document)
    const prompt = renderQwenMultifileFimPromptWithTokenLimit({ cfg: active(), helper, snippets: recent() }, 8192)

    expect(prompt.snippetsInjectedIntoPrompt).toBe(true)
    expect(prompt.prompt).toContain("<|repo_name|>repo")
  })
})

class RecordingCache implements QwenAutocompleteCache {
  gets: string[] = []
  puts: Array<{ prefix: string; completion: string }> = []

  get(prefix: string): string | undefined {
    this.gets.push(prefix)
    return undefined
  }

  put(prefix: string, completion: string): void {
    this.puts.push({ prefix, completion })
  }

  setMaxEntries(): void {}

  size(): number {
    return this.puts.length
  }
}

async function runWithCache(config: QwenAutocompleteConfig, cache: RecordingCache): Promise<void> {
  const provider = new ChipMateQwenInlineCompletionProvider({
    read: () => ({ ...config, cacheEnabled: true }),
    cache,
    client: client(),
    edited: fakeEdited("int helper(void) {\n  return 1;\n}"),
    guard: () => false,
    log: () => {},
  })
  await provider.provideInlineCompletionItems(
    doc("int main(void) {\n  \n}\n"),
    new vscode.Position(1, 2),
    {} as vscode.InlineCompletionContext,
    token() as vscode.CancellationToken,
  )
  provider.dispose()
}

function client(record?: (body: string) => void): QwenFimClient {
  return {
    complete: async (request: QwenFimCompleteInput) => {
      record?.(
        JSON.stringify({
          providerID: request.providerID,
          modelID: request.modelID,
          prompt: request.prompt,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
        }),
      )
      request.onResponse?.({ status: 200 })
      return "return ok;"
    },
  } as QwenFimClient
}

function active(): QwenAutocompleteConfig {
  return {
    ...cfg,
    cacheEnabled: false,
    contextLength: 8192,
    recentlyEditedEnabled: true,
    recentlyEditedInjectIntoPrompt: true,
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

function state(document: vscode.TextDocument): QwenAutocompleteHelperVars {
  const helper = createQwenAutocompleteHelper(document, new vscode.Position(1, 5), undefined, opts(active()))
  return {
    ...helper,
    filepath: "/repo/src/main.c",
    workspaceUris: ["file:///repo"],
  }
}

function recent() {
  return [
    {
      filepath: "/repo/src/recent.c",
      content: "int helper(void) {\n  return 1;\n}",
      type: QwenAutocompleteSnippetType.Code,
    },
    {
      filepath: "/repo/lib/math.c",
      content: "int add(int a, int b) {\n  return a + b;\n}",
      type: QwenAutocompleteSnippetType.Code,
    },
  ]
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

function patchUri(): void {
  ;(vscode.Uri as unknown as { file: typeof originalFile }).file = (file) =>
    ({
      scheme: "file",
      authority: "",
      path: file,
      fsPath: file,
      query: "",
      fragment: "",
      toString: () => `file://${file}`,
    }) as ReturnType<typeof originalFile>
  ;(vscode.workspace as unknown as { workspaceFolders: typeof originalFolders }).workspaceFolders = [
    { uri: { fsPath: "/repo" } },
  ] as typeof originalFolders
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
