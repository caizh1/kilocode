import * as vscode from "vscode"

const LIMIT = 4_096

export async function installInCurrentProfile(file: string): Promise<void> {
  await vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(file))
}

export function installDetail(value: unknown): string {
  const item = record(value)
  const parts = [
    limit(value instanceof Error ? value.message : String(value)),
    item && item.code !== undefined ? `退出码：${String(item.code)}` : "",
    item && item.signal !== undefined ? `信号：${String(item.signal)}` : "",
    item ? output("stderr", item.stderr) : "",
    item ? output("stdout", item.stdout) : "",
  ].filter(Boolean)
  return [...new Set(parts)].join("\n")
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function output(name: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return ""
  const text = value.trim().replace(/\0/g, "")
  return `${name}：${limit(text)}`
}

function limit(value: string): string {
  return value.length > LIMIT ? `${value.slice(0, LIMIT)}…` : value
}
