import * as vscode from "vscode"
import type { ChipMateConnectionService } from "../cli-backend"
import { readQwenAutocompleteConfig } from "./config"
import { exportQwenAutocompleteDiagnostics, qwenDiagnosticsForTests, showQwenAutocompleteLogs } from "./diagnostics"
import { ChipMateQwenInlineCompletionProvider } from "./ChipMateQwenInlineCompletionProvider"
import { autocompleteResource } from "../autocomplete/workspace"

const SMOKE_TEXT = "int main(void) {\n  \n}\n"

export async function enableDiagnostics(): Promise<void> {
  const qwenCfg = vscode.workspace.getConfiguration("chipmate.v2.autocomplete")
  const updates: Array<{ key: string; value: unknown }> = []

  if (qwenCfg.get("qwen.trace") !== true) {
    updates.push({ key: "qwen.trace", value: true })
  }
  if (qwenCfg.get("qwen.logLevel") !== "debug" && qwenCfg.get("qwen.logLevel") !== "info") {
    updates.push({ key: "qwen.logLevel", value: "debug" })
  }
  for (const { key, value } of updates) {
    await qwenCfg.update(key, value, vscode.ConfigurationTarget.Global)
  }
}

export async function qwenDiagnosticSmoke(connection: ChipMateConnectionService): Promise<void> {
  await enableDiagnostics()
  showQwenAutocompleteLogs()

  const cfg = {
    ...readQwenAutocompleteConfig(autocompleteResource()),
    debounceMs: 0,
  }
  const document = makeDocument()
  const position = new vscode.Position(1, 2)

  const provider = new ChipMateQwenInlineCompletionProvider({
    connection,
    guard: () => false,
    state: () => connection.getConnectionState(),
    read: () => cfg,
    source: "smoke",
    log: (msg) => console.info(`[ChipMate New] qwen-autocomplete smoke: ${msg}`),
  })

  try {
    const items = await provider.provideInlineCompletionItems(
      document,
      position,
      {} as vscode.InlineCompletionContext,
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => {} }),
      },
    )
    console.info(`[ChipMate New] qwen-autocomplete smoke returned ${items.length} item(s)`)
    if (items.length === 0) throw new Error("Qwen autocomplete smoke returned no inline completion items.")
    const result = smokeResult()
    const action = await vscode.window.showInformationMessage?.(
      `Qwen transport test succeeded: provider=${cfg.providerID}, model=${cfg.model}, status=${result.status ?? 200}, items=${items.length}. This tests transport only; it does not prove the editor inline provider is registered.`,
      "Export Diagnostics",
    )
    if (action === "Export Diagnostics") await exportQwenAutocompleteDiagnostics()
  } catch (err) {
    const result = smokeResult()
    const action = await vscode.window.showErrorMessage?.(
      `Qwen transport test failed: status=${result.status ?? 0}, phase=${result.phase ?? "unknown"}. This tests transport only; inspect the editor diagnostics separately for registration.`,
      "Export Diagnostics",
    )
    if (action === "Export Diagnostics") await exportQwenAutocompleteDiagnostics()
    console.warn("[ChipMate New] qwen-autocomplete smoke failed", err)
  } finally {
    provider.dispose()
  }
}

function smokeResult(): { status?: number; phase?: string } {
  const entries = qwenDiagnosticsForTests()
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>
      } catch (err) {
        console.warn("[ChipMate New] qwen-autocomplete ignored an invalid diagnostic line", err)
        return undefined
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry?.requestSource === "smoke")
  const result = [...entries].reverse().find((entry) => entry.phase === "response" || entry.phase === "error")
  return {
    status: typeof result?.httpStatus === "number" ? result.httpStatus : undefined,
    phase: typeof result?.serverPhase === "string" ? result.serverPhase : undefined,
  }
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
      const startOffset =
        lines.slice(0, range.start.line).reduce((sum, l) => sum + l.length + 1, 0) + range.start.character
      const endOffset = lines.slice(0, range.end.line).reduce((sum, l) => sum + l.length + 1, 0) + range.end.character
      return SMOKE_TEXT.slice(startOffset, endOffset)
    },
  } as unknown as vscode.TextDocument
}
