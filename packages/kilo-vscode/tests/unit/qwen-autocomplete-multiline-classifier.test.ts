import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { qwenDiagnosticsForTests, resetQwenDiagnosticsForTests } from "../../src/services/qwen-autocomplete/diagnostics"
import { createQwenAutocompleteHelper } from "../../src/services/qwen-autocomplete/helperVars"
import { KiloQwenInlineCompletionProvider } from "../../src/services/qwen-autocomplete/KiloQwenInlineCompletionProvider"
import { classifyQwenMultiline, shouldCompleteMultilineQwen } from "../../src/services/qwen-autocomplete/multiline"
import { QwenFimClient } from "../../src/services/qwen-autocomplete/QwenFimClient"
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
  cacheEnabled: true,
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

afterEach(() => resetQwenDiagnosticsForTests())

describe("qwen multiline classifier parity", () => {
  it("follows Continue always and never option branches", () => {
    const state = helper("int main(void) {\n  ")

    expect(
      classifyQwenMultiline({ helper: state, position: new vscode.Position(1, 2), multilineCompletions: "always" }),
    ).toMatchObject({
      allowed: true,
      blockedReason: "none",
      mode: "always",
      source: "option",
    })
    expect(
      classifyQwenMultiline({ helper: state, position: new vscode.Position(1, 2), multilineCompletions: "never" }),
    ).toMatchObject({
      allowed: false,
      blockedReason: "option-never",
      mode: "never",
      source: "option",
    })
  })

  it("returns true for selectedCompletionInfo like actual Continue source code", () => {
    const selected = {
      text: "abcdef",
      range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 4)),
    }
    const state = createQwenAutocompleteHelper(doc("// abcd"), new vscode.Position(0, 7), selected)
    const result = classifyQwenMultiline({ helper: state, position: new vscode.Position(0, 7), selected })

    expect(result.allowed).toBe(true)
    expect(result.source).toBe("selected-completion-info")
    expect(result.selectedCompletionInfo).toBe(true)
    expect(shouldCompleteMultilineQwen({ helper: state, position: new vscode.Position(0, 7), selected })).toBe(true)
  })

  it("uses language metadata for C/C++ single-line comments", () => {
    const state = helper("int main(void) {\n  // explain")
    const result = classifyQwenMultiline({ helper: state, position: new vscode.Position(1, 12) })

    expect(result.allowed).toBe(false)
    expect(result.blockedReason).toBe("single-line-comment")
    expect(result.language).toBe("C")
    expect(result.singleLineComment).toBe("//")
  })

  it("uses Python, Shell, and YAML language metadata", () => {
    const python = helper("def add(a, b):\n    ", undefined, {
      path: "/repo/src/add.py",
      languageId: "python",
    })
    const shell = helper("run() {\n  ", undefined, {
      path: "/repo/scripts/run.sh",
      languageId: "shellscript",
    })
    const yaml = helper("jobs:\n  build:\n    ", undefined, {
      path: "/repo/.gitea/workflows/build.yml",
      languageId: "yaml",
    })

    expect(classifyQwenMultiline({ helper: python, position: new vscode.Position(1, 4) })).toMatchObject({
      language: "Python",
      singleLineComment: "#",
    })
    expect(classifyQwenMultiline({ helper: shell, position: new vscode.Position(1, 2) })).toMatchObject({
      language: "Shell",
      singleLineComment: "#",
    })
    expect(classifyQwenMultiline({ helper: yaml, position: new vscode.Position(2, 4) })).toMatchObject({
      language: "YAML",
      singleLineComment: "#",
    })
  })

  it("keeps actual Continue midline behavior instead of enabling the commented-out block", () => {
    const state = helper("int main(void) {\n  return ", new vscode.Position(1, 9), { suffix: "page;\n}" })
    const result = classifyQwenMultiline({ helper: state, position: new vscode.Position(1, 9) })

    expect(result.allowed).toBe(true)
    expect(result.source).toBe("default")
  })

  it("uses language-specific useMultiline when available", () => {
    const list = helper("- item", new vscode.Position(0, 6), { path: "/repo/README.md", languageId: "markdown" })
    const para = helper("plain text", new vscode.Position(0, 10), { path: "/repo/README.md", languageId: "markdown" })

    expect(classifyQwenMultiline({ helper: list, position: new vscode.Position(0, 6) })).toMatchObject({
      allowed: false,
      blockedReason: "language-use-multiline",
      language: "Markdown",
      source: "language-use-multiline",
      useMultilineApplied: true,
    })
    expect(classifyQwenMultiline({ helper: para, position: new vscode.Position(0, 10) })).toMatchObject({
      allowed: true,
      blockedReason: "none",
      language: "Markdown",
      source: "language-use-multiline",
      useMultilineApplied: true,
    })
  })

  it("classifies common C/C++ editing scenarios through source-mapped default behavior", () => {
    expect(classifyQwenMultiline({ helper: helper("return "), position: new vscode.Position(0, 7) })).toMatchObject({
      allowed: true,
      source: "default",
    })
    expect(classifyQwenMultiline({ helper: helper("if ("), position: new vscode.Position(0, 4) })).toMatchObject({
      allowed: true,
      source: "default",
    })
    expect(classifyQwenMultiline({ helper: helper("ctx->"), position: new vscode.Position(0, 5) })).toMatchObject({
      allowed: true,
      source: "default",
    })
  })

  it("keeps suffix brace scenarios render-safe under source-mapped classification", async () => {
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: { complete: async () => "return page;\n" } as unknown as QwenFimClient,
      log: () => {},
    })
    const items = await provider.provideInlineCompletionItems(
      doc("int main(void) {\n  \n}", { path: "/repo/src/main.c" }),
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token() as vscode.CancellationToken,
    )

    expect(items).toHaveLength(1)
    expect(items[0]!.insertText).toBe("return page;")
  })

  it("emits redacted multiline classifier diagnostics", async () => {
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => ({ ...cfg, trace: true, logLevel: "debug" }),
      guard: () => false,
      client: {
        complete: async (req: QwenFimCompleteInput) => {
          req.onResponse?.({ status: 200 })
          return "return ok;"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })
    await provider.provideInlineCompletionItems(
      doc("int secret_symbol(void) {\n  \n}", { path: "/repo/src/main.c" }),
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token() as vscode.CancellationToken,
    )

    const logs = qwenDiagnosticsForTests().map((line) => JSON.parse(line) as Record<string, unknown>)
    const prompt = logs.find((line) => line.phase === "prompt-built")
    expect(prompt).toMatchObject({
      multilineAllowed: true,
      multilineBlockedReason: "none",
      multilineClassifierMode: "auto",
      multilineClassifierSource: "default",
      multilineLanguage: "C",
      multilineSelectedCompletionInfo: false,
      multilineSingleLineComment: "//",
      multilineUseMultilineApplied: false,
    })
    expect(JSON.stringify(logs)).not.toContain("secret_symbol")
    expect(JSON.stringify(logs)).not.toContain("/repo/src/main.c")
    expect(JSON.stringify(logs)).not.toContain("secret-qwen.internal")
  })
})

function helper(
  text: string,
  position = new vscode.Position(text.split("\n").length - 1, text.split("\n").at(-1)?.length ?? 0),
  input: { languageId?: string; path?: string; suffix?: string } = {},
) {
  return createQwenAutocompleteHelper(doc(text + (input.suffix ?? ""), input), position)
}

function doc(text: string, input: { languageId?: string; path?: string } = {}) {
  const lines = text.split("\n")
  const path = input.path ?? "/repo/src/main.c"
  return {
    uri: { scheme: "file", fsPath: path, path },
    languageId: input.languageId ?? "c",
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

function offset(lines: string[], pos: Pos): number {
  return lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.character
}

function token() {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} }),
  }
}
