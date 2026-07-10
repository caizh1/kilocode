import * as vscode from "vscode"
import { readQwenAutocompleteConfig } from "./config"
import { showQwenAutocompleteLogs } from "./diagnostics"
import { KiloQwenInlineCompletionProvider } from "./KiloQwenInlineCompletionProvider"
import type { QwenFimCompleteInput } from "./types"

const SMOKE_TEXT = "int main(void) {\n  \n}\n"

export async function enableDiagnostics(): Promise<void> {
  const qwenCfg = vscode.workspace.getConfiguration("kilo.autocomplete")
  const updates: Array<{ key: string; value: unknown }> = []

  if (qwenCfg.get("enabled") !== true || qwenCfg.get("provider") !== "qwen-direct") {
    updates.push({ key: "enabled", value: true }, { key: "provider", value: "qwen-direct" })
  }
  if (qwenCfg.get("qwen.trace") !== true) {
    updates.push({ key: "qwen.trace", value: true })
  }
  if (qwenCfg.get("qwen.logLevel") === "off") {
    updates.push({ key: "qwen.logLevel", value: "debug" })
  }
  for (const { key, value } of updates) {
    await qwenCfg.update(key, value, vscode.ConfigurationTarget.Global)
  }
}

export async function qwenDiagnosticSmoke(): Promise<void> {
  await enableDiagnostics()
  showQwenAutocompleteLogs()

  const cfg = {
    ...readQwenAutocompleteConfig(),
    debounceMs: 0,
  }
  const document = makeDocument()
  const position = new vscode.Position(1, 2)

  const provider = new KiloQwenInlineCompletionProvider({
    read: () => cfg,
    client: createMockClient(),
    log: (msg) => console.info(`[Kilo New] qwen-autocomplete smoke: ${msg}`),
  })

  try {
    await provider.provideInlineCompletionItems(
      document,
      position,
      {} as vscode.InlineCompletionContext,
      { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) },
    )
  } finally {
    provider.dispose()
  }
}

function createMockClient() {
  return {
    complete: async (input: QwenFimCompleteInput) => {
      input.onResponse?.({ status: 200 })
      return "return ok;"
    },
  } as unknown as import("./QwenFimClient").QwenFimClient
}

function makeDocument(): vscode.TextDocument {
  const lines = SMOKE_TEXT.split("\n")
  return {
    uri: vscode.Uri.file("/smoke-test/main.c"),
    languageId: "c",
    version: 1,
    lineCount: lines.length,
    lineAt: (value: number | vscode.Position) => {
      const line = typeof value === "number" ? value : value.line
      const current = lines[line] ?? ""
      return {
        text: current,
        range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, current.length)),
      }
    },
    getText: (range?: vscode.Range) => {
      if (!range) return SMOKE_TEXT
      const startOffset = lines.slice(0, range.start.line).reduce((sum, l) => sum + l.length + 1, 0) + range.start.character
      const endOffset = lines.slice(0, range.end.line).reduce((sum, l) => sum + l.length + 1, 0) + range.end.character
      return SMOKE_TEXT.slice(startOffset, endOffset)
    },
  } as unknown as vscode.TextDocument
}
