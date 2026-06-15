import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { constructInitialPrefixSuffix } from "../../src/services/qwen-autocomplete/constructPrefixSuffix"
import { createQwenAutocompleteHelper, QWEN_HELPER_DEFAULTS } from "../../src/services/qwen-autocomplete/helperVars"
import {
  autodetectTemplateType,
  countTokens,
  pruneLinesFromBottom,
  pruneLinesFromTop,
  prunePrefixSuffixWithTokenBudget,
  tokenizerSourceForModel,
} from "../../src/services/qwen-autocomplete/tokenPruning"

type Pos = { line: number; character: number }
type Range = { start: Pos; end: Pos }

describe("qwen Continue HelperVars and token budget parity", () => {
  it("uses Continue eaa23c5a autocomplete prompt budget defaults", () => {
    expect(QWEN_HELPER_DEFAULTS).toEqual({
      maxPromptTokens: 1024,
      prefixPercentage: 0.3,
      maxSuffixPercentage: 0.2,
    })
  })

  it("maps qwen-coder through Continue chatml autodetect and llama tokenizer path", () => {
    expect(autodetectTemplateType("qwen-coder-30b0")).toBe("chatml")
    expect(tokenizerSourceForModel("qwen-coder-30b0")).toBe("llama")
    expect(countTokens("int main(void) { return 0; }", "qwen-coder-30b0")).toBeGreaterThan(0)
  })

  it("constructs fullPrefix and fullSuffix with Continue initial prefix/suffix behavior", () => {
    const document = doc("abc\ndef\nghi")
    const helper = createQwenAutocompleteHelper(document, new vscode.Position(1, 1))

    expect(constructInitialPrefixSuffix({ document, position: new vscode.Position(1, 1) })).toEqual({
      prefix: "abc\nd",
      suffix: "ef\nghi",
    })
    expect(helper.fullPrefix).toBe("abc\nd")
    expect(helper.fullSuffix).toBe("ef\nghi")
    expect(helper.prunedCaretWindow).toBe(helper.prunedPrefix + helper.prunedSuffix)
  })

  it("applies selectedCompletionInfo to prefix and suffix like Continue", () => {
    const selected = {
      text: "abcdef",
      range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 4)),
    }
    const helper = createQwenAutocompleteHelper(doc("abcd_rest"), new vscode.Position(0, 4), selected)

    expect(helper.fullPrefix).toBe("abcdef")
    expect(helper.fullSuffix).toBe("_rest")
    expect(helper.pos).toEqual({ line: 0, character: 4 })
  })

  it("uses the Continue prefix/suffix prompt budget formula", () => {
    const prefix = lines("pre", 80)
    const suffix = lines("suf", 80)
    const opts = { maxPromptTokens: 90, prefixPercentage: 0.3, maxSuffixPercentage: 0.2 }
    const model = "qwen-coder-30b0"
    const pruned = prunePrefixSuffixWithTokenBudget(prefix, suffix, model, opts)
    const expectedPrefix = pruneLinesFromTop(prefix, opts.maxPromptTokens * opts.prefixPercentage, model)
    const expectedSuffix = pruneLinesFromBottom(
      suffix,
      Math.min(
        opts.maxPromptTokens - countTokens(expectedPrefix, model),
        opts.maxSuffixPercentage * opts.maxPromptTokens,
      ),
      model,
    )

    expect(pruned.prunedPrefix).toBe(expectedPrefix)
    expect(pruned.prunedSuffix).toBe(expectedSuffix)
    expect(pruned.estimatedPromptTokens).toBe(pruned.estimatedPrefixTokens + pruned.estimatedSuffixTokens)
  })

  it("prunes stably for small budgets and preserves content for large budgets", () => {
    const prefix = lines("pre", 20)
    const suffix = lines("suf", 20)
    const small = prunePrefixSuffixWithTokenBudget(prefix, suffix, "qwen-coder-30b0", {
      maxPromptTokens: 30,
      prefixPercentage: 0.3,
      maxSuffixPercentage: 0.2,
    })
    const large = prunePrefixSuffixWithTokenBudget(prefix, suffix, "qwen-coder-30b0", {
      maxPromptTokens: 10_000,
      prefixPercentage: 0.3,
      maxSuffixPercentage: 0.2,
    })

    expect(small.prunedPrefix.length).toBeLessThan(prefix.length)
    expect(small.prunedSuffix.length).toBeLessThan(suffix.length)
    expect(large.prunedPrefix).toBe(prefix)
    expect(large.prunedSuffix).toBe(suffix)
  })
})

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

function lines(tag: string, count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `int ${tag}_${index.toString().padStart(3, "0")} = ${index};`,
  ).join("\n")
}

function offset(lines: string[], pos: Pos): number {
  return lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.character
}
