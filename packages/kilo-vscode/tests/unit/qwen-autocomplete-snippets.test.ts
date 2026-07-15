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
  emptyQwenSnippetPayload,
  QwenAutocompleteSnippetType,
  selectQwenSnippets,
} from "../../src/services/qwen-autocomplete/snippets"
import { countTokens } from "../../src/services/qwen-autocomplete/tokenPruning"
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

describe("qwen autocomplete snippet scaffold", () => {
  it("returns no snippets for the Phase 2E-1 empty payload scaffold", () => {
    const document = doc("int main(void) {\n  return 0;\n}\n")
    const helper = createQwenAutocompleteHelper(document, new vscode.Position(1, 2), undefined, {
      maxPromptTokens: cfg.maxPromptTokens,
      maxSuffixPercentage: cfg.maxSuffixPercentage,
      modelName: cfg.model,
      prefixPercentage: cfg.prefixPercentage,
    })
    const payload = emptyQwenSnippetPayload()
    const before = {
      prefix: helper.prunedPrefix,
      suffix: helper.prunedSuffix,
    }
    const selection = selectQwenSnippets(helper, payload, {
      maxPromptTokens: cfg.maxPromptTokens,
      modelName: cfg.model,
    })

    expect(Object.values(payload).every((items) => items.length === 0)).toBe(true)
    expect(selection.snippets).toEqual([])
    expect(selection.totalCount).toBe(0)
    expect(selection.selectedCount).toBe(0)
    expect(selection.selectedSnippetTokens).toBe(0)
    expect(selection.snippetTokenBudget).toBe(cfg.maxPromptTokens - countTokens(helper.prunedCaretWindow, cfg.model))
    expect(helper.prunedPrefix).toBe(before.prefix)
    expect(helper.prunedSuffix).toBe(before.suffix)
  })

  it("keeps Continue validation behavior while filtering invalid snippets", () => {
    const helper = createQwenAutocompleteHelper(doc("int main(void) {\n  \n}\n"), new vscode.Position(1, 2))
    const payload = emptyQwenSnippetPayload()
    payload.rootPathSnippets = [
      {
        filepath: "file:///repo/src/empty.c",
        content: "   ",
        type: QwenAutocompleteSnippetType.Code,
      },
      {
        filepath: "output:extension-output-Continue.continue",
        content: "ignored output channel",
        type: QwenAutocompleteSnippetType.Code,
      },
    ]
    payload.clipboardSnippets = [
      {
        content: "clipboard content",
        copiedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        type: QwenAutocompleteSnippetType.Clipboard,
      },
    ]

    const selection = selectQwenSnippets(helper, payload, {
      includeClipboard: true,
      maxPromptTokens: cfg.maxPromptTokens,
      modelName: cfg.model,
    })

    expect(selection.totalCount).toBe(3)
    expect(selection.selectedCount).toBe(0)
    expect(selection.snippets).toEqual([])
  })

  it("selects recently opened snippets before recently edited snippets like Continue", () => {
    const helper = createQwenAutocompleteHelper(doc("int main(void) {\n  \n}\n"), new vscode.Position(1, 2))
    const payload = emptyQwenSnippetPayload()
    payload.recentlyOpenedFileSnippets = [
      {
        filepath: "/repo/src/shared.c",
        content: "int opened_value(void) { return 1; }",
        type: QwenAutocompleteSnippetType.Code,
      },
    ]
    payload.recentlyEditedRangeSnippets = [
      {
        filepath: "/repo/src/shared.c",
        content: "int edited_value(void) { return 2; }",
        type: QwenAutocompleteSnippetType.Code,
      },
    ]

    const selection = selectQwenSnippets(helper, payload, {
      includeRecentlyEditedRanges: true,
      maxPromptTokens: cfg.maxPromptTokens,
      modelName: cfg.model,
      useRecentlyOpened: true,
    })

    expect(selection.snippets).toEqual([payload.recentlyOpenedFileSnippets[0]])
    expect(selection.selectedCount).toBe(1)
  })

  it("selects import and root snippets only when their source switches are enabled", () => {
    const helper = createQwenAutocompleteHelper(doc("int main(void) {\n  helper();\n}\n"), new vscode.Position(1, 2))
    const payload = emptyQwenSnippetPayload()
    payload.importDefinitionSnippets = [
      {
        filepath: "/repo/include/import.h",
        content: "int import_helper(void);",
        type: QwenAutocompleteSnippetType.Code,
      },
    ]
    payload.rootPathSnippets = [
      {
        filepath: "/repo/include/root.h",
        content: "int root_helper(void);",
        type: QwenAutocompleteSnippetType.Code,
      },
    ]

    const off = selectQwenSnippets(helper, payload, {
      maxPromptTokens: cfg.maxPromptTokens,
      modelName: cfg.model,
    })
    const on = selectQwenSnippets(helper, payload, {
      maxPromptTokens: cfg.maxPromptTokens,
      modelName: cfg.model,
      useImports: true,
      useRootPath: true,
    })

    expect(off.snippets).toEqual([])
    expect(on.snippets).toHaveLength(2)
    expect(on.snippets).toEqual(
      expect.arrayContaining([payload.importDefinitionSnippets[0], payload.rootPathSnippets[0]]),
    )
  })

  it("keeps FIM prompt and request body byte-for-byte unchanged with empty snippets", async () => {
    let body = ""
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
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
      log: () => {},
    })
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
    const expected = JSON.stringify({
      providerID: cfg.providerID,
      modelID: cfg.model,
      prompt,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
    })

    const items = await provider.provideInlineCompletionItems(
      document,
      position,
      {} as vscode.InlineCompletionContext,
      token() as vscode.CancellationToken,
    )

    expect(items).toHaveLength(1)
    expect(body).toBe(expected)
    expect(JSON.parse(body).prompt).toBe(prompt)
  })

  it("emits only redacted snippet count diagnostics", async () => {
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => ({ ...cfg, trace: true, logLevel: "debug" }),
      guard: () => false,
      client: {
        complete: async (request: QwenFimCompleteInput) => {
          request.onResponse?.({ status: 200 })
          return "return ok;"
        },
      } as QwenFimClient,
      log: () => {},
    })

    await provider.provideInlineCompletionItems(
      doc("int main(void) {\n  \n}\n"),
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token() as vscode.CancellationToken,
    )

    const logs = qwenDiagnosticsForTests().map((line) => JSON.parse(line) as Record<string, unknown>)
    const last = logs.at(-1)!
    expect(last.snippetScaffoldEnabled).toBe(true)
    expect(last.snippetTotalCount).toBe(0)
    expect(last.selectedSnippetCount).toBe(0)
    expect(last.snippetTokenBudget).toEqual(expect.any(Number))
    expect(last.selectedSnippetTokens).toBe(0)
    expect(JSON.stringify(logs)).not.toContain("clipboard content")
    expect(JSON.stringify(logs)).not.toContain("Authorization")
  })

  it("does not import or call real context sources from the scaffold", () => {
    const root = path.join(__dirname, "../..")
    const source = [
      readFileSync(path.join(root, "src/services/qwen-autocomplete/snippets.ts"), "utf8"),
      readFileSync(path.join(root, "src/services/qwen-autocomplete/KiloQwenInlineCompletionProvider.ts"), "utf8"),
    ].join("\n")

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
  })
})

function doc(text: string, input: { path?: string; languageId?: string; version?: number; scheme?: string } = {}) {
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
