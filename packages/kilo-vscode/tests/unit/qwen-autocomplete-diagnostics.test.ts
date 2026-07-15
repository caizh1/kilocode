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
      pathHash: expect.any(String),
      providerID: "qwen",
      transport: "cli-qwen-fim",
      connectionState: "connected",
      requestSource: "editor",
      workspaceScope: "none",
      selectionOrigin: "explicit",
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
    const postprocess = logs.find((line) => line.phase === "postprocess")
    expect(postprocess).toMatchObject({
      nonStreamingFilterEnabled: true,
      nonStreamingFilterApplied: false,
      nonStreamingFilterReasons: "",
      nonStreamingFilterInputChars: "return ok;".length,
      nonStreamingFilterOutputChars: "return ok;".length,
      nonStreamingFilterRejected: false,
      nonStreamingFilterTrimmed: false,
      nonStreamingFilterStopTokenHit: false,
      nonStreamingFilterSimilarLineHit: false,
      nonStreamingFilterRepeatingLineHit: false,
      nonStreamingFilterMarkdownFenceHit: false,
      nonStreamingFilterPathLineHit: false,
      nonStreamingFilterAdapterMode: "non-streaming-full-text",
    })
    expect(JSON.stringify(logs)).not.toContain("secret-qwen.internal")
    expect(JSON.stringify(logs)).not.toContain("Authorization")
    expect(JSON.stringify(logs)).not.toContain("/repo/backend/hal/main.c")
    expect(JSON.stringify(logs)).not.toContain("<|fim_prefix|>")
    expect(logs.every((line) => line.promptPreview === null)).toBe(true)
    expect(logs.find((line) => line.phase === "response")).toMatchObject({
      endpointSource: "provider-options",
      serverPhase: "success",
    })
  })

  it("records non-streaming filter reasons without logging filtered source text", async () => {
    await runProvider(
      { ...cfg, trace: true, logLevel: "debug" },
      { completion: "// Path: /repo/secret/path/main.c\nreturn ok;" },
    )

    const logs = parsed()
    const postprocess = logs.find((line) => line.phase === "postprocess")
    expect(postprocess).toMatchObject({
      nonStreamingFilterEnabled: true,
      nonStreamingFilterApplied: true,
      nonStreamingFilterReasons: "path-line",
      nonStreamingFilterPathLineHit: true,
      nonStreamingFilterRejected: false,
      nonStreamingFilterAdapterMode: "non-streaming-full-text",
    })
    expect(JSON.stringify(logs)).not.toContain("/repo/secret/path/main.c")
    expect(JSON.stringify(logs)).not.toContain("<|fim_prefix|>")
    expect(logs.every((line) => line.promptPreview === null)).toBe(true)
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

  it("keeps qwen promptPreview disabled even when logPromptPreview is enabled", async () => {
    await runProvider(
      {
        ...cfg,
        trace: true,
        logLevel: "debug",
        logPromptPreview: true,
      },
      { text: "int secret_prompt_symbol(void) {\n  \n}\n" },
    )

    const logs = parsed()
    const text = JSON.stringify(logs)
    expect(logs.every((line) => line.promptPreview === null)).toBe(true)
    expect(text).not.toContain("secret_prompt_symbol")
    expect(text).not.toContain("<|fim_prefix|>")
    expect(text).not.toContain("secret-qwen.internal")
    expect(text).not.toContain("Authorization")
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
    expect(written).not.toContain('"apiKey"')
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
    registerQwenAutocompleteProvider({ subscriptions: [] } as unknown as vscode.ExtensionContext, connection())

    expect(calls).toContain("kilo-code.new.qwenAutocomplete.showLogs")
    expect(calls).toContain("kilo-code.new.qwenAutocomplete.exportDiagnostics")
    expect(calls).toContain("kilo-code.new.qwenAutocomplete.smokeDiagnostics")
    const root = path.join(__dirname, "../..")
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      contributes: {
        commands: Array<{ command: string; title: string }>
        menus?: { commandPalette?: Array<{ command: string; when?: string }> }
      }
    }
    expect(
      manifest.contributes.commands.find(
        (command) => command.command === "kilo-code.new.qwenAutocomplete.smokeDiagnostics",
      )?.title,
    ).toBe("ChipMate: Test qwen-direct Transport")
    expect(
      manifest.contributes.menus?.commandPalette?.find(
        (item) => item.command === "kilo-code.new.qwenAutocomplete.exportDiagnostics",
      )?.when,
    ).toBeUndefined()
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
    guard: () => false,
    state: () => "connected",
    client: {
      complete: async (req: QwenFimCompleteInput) => {
        req.onResponse?.({ status: 200, endpointSource: "provider-options", serverPhase: "success" })
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
  ;(vscode.workspace as unknown as { getConfiguration: typeof originalConfig }).getConfiguration = (
    section?: string,
  ) => {
    if (section === "kilo-code.new.autocomplete") {
      return {
        get: (key: string, fallback?: unknown) =>
          ({
            provider: values.providerID,
            model: values.model,
            enableAutoTrigger: values.autoTrigger,
          })[key] ?? fallback,
        update: async () => {},
      } as unknown as ReturnType<typeof originalConfig>
    }
    if (section !== "kilo.autocomplete") return originalConfig(section)
    return {
      get: (key: string, fallback?: unknown) => {
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
        return map[key] ?? fallback
      },
      update: async () => {},
    } as unknown as ReturnType<typeof originalConfig>
  }
}

function connection() {
  return {
    getConnectionState: () => "connected",
  } as never
}
