import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { createQwenAutocompleteHelper } from "../../src/services/qwen-autocomplete/helperVars"
import { filterQwenCompletion, filterQwenCompletionDetailed } from "../../src/services/qwen-autocomplete/streamFilters"

type Pos = { line: number; character: number }
type Range = { start: Pos; end: Pos }

function doc(text: string, input: { path?: string; languageId?: string } = {}) {
  const lines = text.split("\n")
  const uri = {
    scheme: "file",
    fsPath: input.path ?? "/repo/src/main.c",
    path: input.path ?? "/repo/src/main.c",
  }
  return {
    uri,
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

function filtered(
  completion: string,
  input: {
    text?: string
    position?: vscode.Position
    suffix?: string
    stops?: string[]
    multiline?: boolean
  } = {},
) {
  const position = input.position ?? new vscode.Position(0, 0)
  const helper = createQwenAutocompleteHelper(doc(input.text ?? ""), position)
  return filterQwenCompletionDetailed({
    completion,
    suffix: input.suffix ?? helper.prunedSuffix,
    stopTokens: input.stops ?? [],
    helper,
    position,
    multiline: input.multiline ?? true,
  })
}

describe("qwen non-streaming autocomplete filters", () => {
  it("keeps the compatibility wrapper aligned with the detailed result", () => {
    const input = {
      completion: "return ok;<|fim_prefix|>bad",
      suffix: "",
      stopTokens: ["<|fim_prefix|>"],
      helper: createQwenAutocompleteHelper(doc(""), new vscode.Position(0, 0)),
      position: new vscode.Position(0, 0),
      multiline: true,
    }

    expect(filterQwenCompletion(input)).toBe(filterQwenCompletionDetailed(input).text)
  })

  it("returns stable stop-token metadata", () => {
    const result = filtered("return ok;<|fim_prefix|>bad", { stops: ["<|fim_prefix|>"] })

    expect(result.text).toBe("return ok;")
    expect(result.trimmed).toBe(true)
    expect(result.rejected).toBe(false)
    expect(result.reasons).toContain("fim-marker")
    expect(result.inputChars).toBe("return ok;<|fim_prefix|>bad".length)
    expect(result.outputChars).toBe("return ok;".length)
  })

  it("rejects empty output created by a leading stop token", () => {
    const result = filtered("<|fim_prefix|>bad", { stops: ["<|fim_prefix|>"] })

    expect(result.text).toBe("")
    expect(result.rejected).toBe(true)
    expect(result.reasons).toContain("fim-marker")
    expect(result.reasons).toContain("blank")
  })

  it("truncates suffix-start echo as a non-streaming fullStop adapter", () => {
    const suffix = "const data = await response.json();\nreturn data.items;"
    const result = filtered("return ok;const data = await response.json();\nreturn data.items;", { suffix })

    expect(result.text).toBe("return ok;")
    expect(result.reasons).toContain("stop-at-suffix-start")
  })

  it("keeps stopAtSimilarLine separate from rewrites-line-above postprocess", () => {
    const text = "int main() {\n  \n  finish_long_value_1234();\n}"
    const result = filtered("step();\n  finish_long_value_1235();\nafter();", {
      text,
      position: new vscode.Position(1, 2),
      suffix: "",
    })

    expect(result.text).toBe("step();")
    expect(result.reasons).toContain("stop-at-similar-line")
    expect(result.reasons).not.toContain("rewrites-line-above")
  })

  it("requires the language comment prefix for Path lines", () => {
    expect(filtered("// Path: src/main.c\nint a;").text).toBe("int a;")
    expect(filtered("Path: src/main.c\nint a;").text).toBe("Path: src/main.c\nint a;")
    expect(filtered('printf("Path: src/main.c");\nint a;').text).toBe('printf("Path: src/main.c");\nint a;')
  })

  it("strips only Continue source-mapped English explanation phrases", () => {
    expect(filtered("Here is the code:\nreturn ok;").text).toBe("return ok;")
    expect(filtered("here_is_value();").text).toBe("here_is_value();")
    expect(filtered("// here is a normal comment\nreturn ok;").text).toBe("// here is a normal comment\nreturn ok;")
    expect(filtered('printf("here is a string");').text).toBe('printf("here is a string");')
  })

  it("skips only the first blank line for filterLeadingNewline behavior", () => {
    const result = filtered("\nreturn ok;")

    expect(result.text).toBe("return ok;")
    expect(result.reasons).toContain("skip-line")
  })

  it("distinguishes markdown fence truncation from postprocess fence stripping", () => {
    const result = filtered("```c\nreturn ok;\n```\nExplanation: done")

    expect(result.text).toBe("```c\nreturn ok;")
    expect(result.reasons).toContain("markdown-fence")
  })

  it("removes empty comments, skip lines, skip prefixes, trailing whitespace, and repeating lines", () => {
    expect(filtered("//\nreturn ok;   ").text).toBe("return ok;")
    expect(filtered("</START EDITING HERE>\nreturn ok;").text).toBe("return ok;")
    expect(filtered("<COMPLETION>return ok;").text).toBe("return ok;")
    expect(filtered("a();\nb();\nb();\nb();\nc();").text).toBe("a();\nb();")
  })
})
