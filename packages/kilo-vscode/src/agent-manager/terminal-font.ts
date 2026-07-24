/**
 * Helpers to read and watch the user's integrated-terminal font settings.
 *
 * VS Code's integrated terminal falls back to the editor font family when
 * its own family is unset. Font size has a separate platform default. We
 * replicate those settings for Agent Manager xterm instances.
 */

import * as vscode from "vscode"

export interface TerminalFont {
  fontFamily: string
  fontSize: number
  lineHeight?: number
}

function fallback(platform: NodeJS.Platform): string {
  if (platform === "win32") return "Consolas, 'Cascadia Mono', 'Courier New', monospace"
  return "Menlo, Monaco, 'Courier New', monospace"
}

export function resolveTerminalFont(
  family: string | undefined,
  size: number | undefined,
  editor: string | undefined,
  platform: NodeJS.Platform = process.platform,
  lineHeight = 1,
): TerminalFont {
  return {
    fontFamily: family?.trim() || editor?.trim() || fallback(platform),
    fontSize: size ?? (platform === "darwin" ? 12 : 14),
    lineHeight,
  }
}

/** Resolve the user's integrated-terminal font, mirroring VS Code's own
 *  family fallback while preserving the terminal's independent size. */
export function readTerminalFont(): TerminalFont {
  const term = vscode.workspace.getConfiguration("terminal.integrated")
  const editor = vscode.workspace.getConfiguration("editor")
  return resolveTerminalFont(
    term.get<string>("fontFamily"),
    term.get<number>("fontSize"),
    editor.get<string>("fontFamily"),
    process.platform,
    term.get<number>("lineHeight", 1),
  )
}

/** True when a config change affects the effective terminal family or size. */
export function affectsTerminalFont(e: vscode.ConfigurationChangeEvent): boolean {
  return (
    e.affectsConfiguration("terminal.integrated.fontFamily") ||
    e.affectsConfiguration("terminal.integrated.fontSize") ||
    e.affectsConfiguration("terminal.integrated.lineHeight") ||
    e.affectsConfiguration("editor.fontFamily")
  )
}

/** Subscribe to terminal-font config changes. Returns a cleanup function. */
export function watchTerminalFont(callback: (font: TerminalFont) => void): () => void {
  const sub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (affectsTerminalFont(e)) callback(readTerminalFont())
  })
  return () => sub.dispose()
}
