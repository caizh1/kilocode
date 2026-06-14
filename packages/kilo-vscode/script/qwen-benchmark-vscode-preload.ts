#!/usr/bin/env bun
import path from "node:path"
import { mock } from "bun:test"

const root = process.cwd()

class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

class Range {
  constructor(
    public start: Position,
    public end: Position,
  ) {}
}

class InlineCompletionItem {
  constructor(
    public insertText: string,
    public range?: Range,
  ) {}
}

const workspace = {
  workspaceFolders: [{ uri: { fsPath: root } }],
  asRelativePath: (value: string | { fsPath?: string }) => {
    const file = typeof value === "string" ? value : (value.fsPath ?? "")
    const relative = path.relative(root, file)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return file
    return relative
  },
}

mock.module("vscode", () => ({
  Position,
  Range,
  InlineCompletionItem,
  workspace,
}))
