import { afterEach, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import {
  exportQwenAutocompleteDiagnostics,
  qwenDiagnosticsForTests,
  resetQwenDiagnosticsForTests,
} from "../../src/services/qwen-autocomplete/diagnostics"
import { KiloQwenInlineCompletionProvider } from "../../src/services/qwen-autocomplete/KiloQwenInlineCompletionProvider"
import { QwenFimClient } from "../../src/services/qwen-autocomplete/QwenFimClient"
import type { QwenAutocompleteConfig, QwenFimCompleteInput } from "../../src/services/qwen-autocomplete/types"

type Pos = { line: number; character: number }
type Range = { start: Pos; end: Pos }

const cfg: QwenAutocompleteConfig = {
  enabled: true,
  provider: "qwen-direct",
  endpoint: "http://secret-qwen.internal/v1/completions",
  model: "qwen-coder-30b0",
  apiKey: "sk-secret-token-should-never-log",
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
  trace: false,
  logLevel: "off",
  logPromptPreview: false,
  logCompletionPreview: true,
}

const originalConfig = vscode.workspace.getConfiguration
const originalSave = vscode.window.showSaveDialog
const originalWrite = vscode.workspace.fs.writeFile
const originalCommands = vscode.commands.registerCommand

afterEach(() => {
  ;(vscode.workspace as unknown as { getConfiguration: typeof originalConfig }).getConfiguration = originalConfig
  ;(vscode.window as unknown as { showSaveDialog: typeof originalSave }).showSaveDialog = originalSave
  ;(vscode.workspace.fs as unknown as { writeFile: typeof originalWrite }).writeFile = originalWrite
  ;(vscode.commands as unknown as { registerCommand: typeof originalCommands }).registerCommand = originalCommands
  resetQwenDiagnosticsForTests()
})

describe("qwen autocomplete diagnostics", () => {
  it("keeps trace off by default", async () => {
    await runProvider({ ...cfg, trace: false, logLevel: "off" })

    expect(qwenDiagnosticsForTests()).toEqual([])
  })

  it("emits redacted JSONL with stable requestId when trace debug is enabled", async () => {
    await runProvider({ ...cfg, trace: true, logLevel: "debug" })

    const logs = parsed()
    expect(logs.length).toBeGreaterThan(0)
    expect(new Set(logs.map((line) => line.requestId)).size).toBe(1)
    expect(logs.map((line) => line.phase)).toContain("provider-enter")
    expect(logs.map((line) => line.phase)).toContain("return-items")
    expect(logs.at(-1)).toMatchObject({
      endpointPath: "/v1/completions",
      pathHash: expect.any(String),
      emptyReason: "none",
      itemCount: 1,
      maxPromptTokens: 1024,
      prefixPercentage: 0.3,
      maxSuffixPercentage: 0.2,
      prunedPrefixChars: expect.any(Number),
      prunedSuffixChars: expect.any(Number),
      prunedCaretWindowChars: expect.any(Number),
      estimatedPrefixTokens: expect.any(Number),
      estimatedSuffixTokens: expect.any(Number),
      estimatedPromptTokens: expect.any(Number),
      tokenizerSource: "llama",
      helperParityMode: "continue-helpervars-token-budget",
      cacheEnabled: true,
      cacheStatus: "miss",
      cacheHit: false,
      cacheEntryCount: expect.any(Number),
      cacheLookupPrefixChars: expect.any(Number),
      cacheReturnedChars: null,
    })
    expect(JSON.stringify(logs)).not.toContain("secret-qwen.internal")
    expect(JSON.stringify(logs)).not.toContain(cfg.apiKey)
    expect(JSON.stringify(logs)).not.toContain("Authorization")
    expect(JSON.stringify(logs)).not.toContain("/repo/backend/hal/main.c")
    expect(JSON.stringify(logs)).not.toContain("<|fim_prefix|>")
  })

  it("info level omits prompt and completion previews", async () => {
    await runProvider({
      ...cfg,
      trace: true,
      logLevel: "info",
      logPromptPreview: true,
      logCompletionPreview: true,
    })

    const text = JSON.stringify(parsed())
    expect(text).not.toContain("return ok;")
    expect(text).not.toContain("<|fim_prefix|>")
  })

  it("records selectedCompletionInfo diagnostics", async () => {
    await runProvider(
      { ...cfg, trace: true, logLevel: "debug" },
      {
        text: "abcd_rest",
        position: new vscode.Position(0, 4),
        completion: "_tail",
        selectedCompletionInfo: {
          text: "abcdef",
          range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 4)),
        },
      },
    )

    const logs = parsed()
    expect(logs.some((line) => line.selectedCompletionInfoPresent === true)).toBe(true)
    expect(logs.some((line) => line.selectedTextLength === 6)).toBe(true)
    expect(logs.some((line) => line.selectedRangePreview === "1:1-1:5")).toBe(true)
  })

  it("records emptyReason for postprocess/render/return-items failures", async () => {
    await runProvider({ ...cfg, trace: true, logLevel: "debug" }, { completion: "" })

    const logs = parsed()
    expect(logs.at(-1)).toMatchObject({
      phase: "return-items",
      emptyReason: "qwen-error",
      itemCount: 0,
    })
  })

  it("exports diagnostics through vscode.workspace.fs.writeFile with redacted settings", async () => {
    let written = ""
    ;(vscode.window as unknown as { showSaveDialog: typeof originalSave }).showSaveDialog = async () =>
      vscode.Uri.file("/tmp/qwen-export.jsonl")
    ;(vscode.workspace.fs as unknown as { writeFile: typeof originalWrite }).writeFile = async (_uri, data) => {
      written = Buffer.from(data).toString("utf8")
    }
    stubConfig({ ...cfg, trace: true, logLevel: "debug" })
    await runProvider({ ...cfg, trace: true, logLevel: "debug" })

    expect(await exportQwenAutocompleteDiagnostics()).toBe(true)
    expect(written).toContain('"type":"metadata"')
    expect(written).toContain('"type":"qwen-settings"')
    expect(written).toContain('"apiKey":"[redacted]"')
    expect(written).not.toContain(cfg.apiKey)
    expect(written).not.toContain("secret-qwen.internal")
    expect(written).not.toContain("Authorization")
    expect(written).not.toContain("<|fim_prefix|>")
  })

  it("registers qwen diagnostics commands without old runtime endpoints", async () => {
    const calls: string[] = []
    ;(vscode.commands as unknown as { registerCommand: typeof originalCommands }).registerCommand = (command) => {
      calls.push(command)
      return { dispose: () => {} }
    }

    const { registerQwenAutocompleteProvider } = await import("../../src/services/qwen-autocomplete")
    registerQwenAutocompleteProvider({ subscriptions: [] } as unknown as vscode.ExtensionContext)

    expect(calls).toContain("kilo-code.new.qwenAutocomplete.showLogs")
    expect(calls).toContain("kilo-code.new.qwenAutocomplete.exportDiagnostics")
    const root = path.join(__dirname, "../..")
    const source = readFileSync(path.join(root, "src/services/qwen-autocomplete/diagnostics.ts"), "utf8")
    expect(source).not.toContain("benchmark")
    expect(source).not.toContain("/kilo/fim")
    expect(source).not.toContain("/kilo/edit")
  })
})

async function runProvider(
  config: QwenAutocompleteConfig,
  input: {
    text?: string
    position?: vscode.Position
    completion?: string
    selectedCompletionInfo?: vscode.SelectedCompletionInfo
  } = {},
): Promise<void> {
  const document = doc(input.text ?? "int main(void) {\n  \n}\n")
  const position = input.position ?? new vscode.Position(1, 2)
  const provider = new KiloQwenInlineCompletionProvider({
    read: () => config,
    client: {
      complete: async (req: QwenFimCompleteInput) => {
        req.onResponse?.({ status: 200 })
        const completion = input.completion ?? "return ok;"
        if (!completion) throw new Error("empty")
        return completion
      },
    } as unknown as QwenFimClient,
    log: () => {},
  })
  await provider.provideInlineCompletionItems(
    document,
    position,
    { selectedCompletionInfo: input.selectedCompletionInfo } as vscode.InlineCompletionContext,
    token() as vscode.CancellationToken,
  )
}

function doc(text: string) {
  const lines = text.split("\n")
  return {
    uri: {
      scheme: "file",
      fsPath: "/repo/backend/hal/main.c",
      path: "/repo/backend/hal/main.c",
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

function parsed(): Array<Record<string, unknown>> {
  return qwenDiagnosticsForTests().map((line) => JSON.parse(line) as Record<string, unknown>)
}

function stubConfig(values: QwenAutocompleteConfig): void {
  ;(vscode.workspace as unknown as { getConfiguration: typeof originalConfig }).getConfiguration = (section?: string) => {
    if (section !== "kilo.autocomplete") return originalConfig(section)
    return {
      get: (key: string, fallback?: unknown) => {
        const map: Record<string, unknown> = {
          enabled: values.enabled,
          provider: values.provider,
          "qwen.endpoint": values.endpoint,
          "qwen.model": values.model,
          "qwen.apiKey": values.apiKey,
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
          "qwen.trace": values.trace,
          "qwen.logLevel": values.logLevel,
          "qwen.logPromptPreview": values.logPromptPreview,
          "qwen.logCompletionPreview": values.logCompletionPreview,
        }
        return map[key] ?? fallback
      },
      update: async () => {},
    } as unknown as ReturnType<typeof originalConfig>
  }
}
