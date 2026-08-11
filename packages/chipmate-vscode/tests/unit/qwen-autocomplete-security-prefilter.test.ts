import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as vscode from "vscode"
import { qwenDiagnosticsForTests, resetQwenDiagnosticsForTests } from "../../src/services/qwen-autocomplete/diagnostics"
import {
  decideQwenGuard,
  isQwenSecurityConcern,
  resetQwenSafetyGuardsForTests,
} from "../../src/services/qwen-autocomplete/guard"
import { createQwenAutocompleteHelper } from "../../src/services/qwen-autocomplete/helperVars"
import { QwenImportDefinitionsTracker } from "../../src/services/qwen-autocomplete/importDefinitions"
import { ChipMateQwenInlineCompletionProvider } from "../../src/services/qwen-autocomplete/ChipMateQwenInlineCompletionProvider"
import { qwenLanguageId } from "../../src/services/qwen-autocomplete/language"
import { decideQwenPrefilter, QWEN_DOCUMENT_SELECTOR } from "../../src/services/qwen-autocomplete/prefilter"
import { QwenRecentlyOpenedTracker } from "../../src/services/qwen-autocomplete/recentlyOpened"
import { QwenRootPathTracker } from "../../src/services/qwen-autocomplete/rootPathContext"
import type { QwenAutocompleteConfig } from "../../src/services/qwen-autocomplete/types"
import type { QwenFimClient } from "../../src/services/qwen-autocomplete/QwenFimClient"

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
  cacheEnabled: false,
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

const folders = vscode.workspace.workspaceFolders
const env = process.env.CONTINUE_GLOBAL_DIR
const dirs: string[] = []

afterEach(async () => {
  ;(vscode.workspace as unknown as { workspaceFolders: typeof folders }).workspaceFolders = folders
  if (env === undefined) {
    delete process.env.CONTINUE_GLOBAL_DIR
  } else {
    process.env.CONTINUE_GLOBAL_DIR = env
  }
  resetQwenDiagnosticsForTests()
  resetQwenSafetyGuardsForTests()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("qwen security and prefilter decisions", () => {
  it("keeps provider disabled and provider mismatch from sending qwen requests", async () => {
    expect(await calls({ ...cfg, enabled: false })).toBe(0)
    expect(await calls({ ...cfg, provider: "legacy" as "qwen-direct" })).toBe(0)
  })

  it("keeps prefilter separate from security guard reasons", () => {
    const unsupported = decideQwenPrefilter(doc("hello", { languageId: "markdown", path: "/repo/src/readme.md" }))
    const empty = decideQwenPrefilter(doc("", { languageId: "c", path: "/repo/src/main.c" }))

    expect(unsupported.reason).toBe("unsupported-extension")
    expect(empty.reason).toBe("empty-document")
  })

  it("sends Qwen FIM requests for Python, Shell, and Gitea Workflow files only", async () => {
    expect(QWEN_DOCUMENT_SELECTOR).toContainEqual({ scheme: "file", pattern: "**/*.py" })
    expect(QWEN_DOCUMENT_SELECTOR).toContainEqual({ scheme: "file", pattern: "**/*.sh" })
    expect(QWEN_DOCUMENT_SELECTOR).toContainEqual({
      scheme: "file",
      pattern: "**/.gitea/workflows/*.yaml",
    })

    const supported = [
      doc("def add(a, b):\n    ", { languageId: "python", path: "/repo/src/add.py" }),
      doc("#!/bin/sh\nrun() {\n  ", { languageId: "shellscript", path: "/repo/scripts/run.sh" }),
      doc("name: build\njobs:\n  build:\n    ", {
        languageId: "yaml",
        path: "/repo/.gitea/workflows/build.yaml",
      }),
      doc("name: nested\njobs:\n  test:\n    ", {
        languageId: "yaml",
        path: "/repo/.gitea/workflows/release/test.yml",
      }),
    ]

    for (const document of supported) {
      expect(decideQwenPrefilter(document).reason).toBe("none")
      expect(await run({ config: cfg, document })).toMatchObject({ calls: 1, items: 1 })
    }

    const yaml = doc("name: ordinary", { languageId: "yaml", path: "/repo/config/build.yaml" })
    expect(decideQwenPrefilter(yaml).reason).toBe("workflow-outside-gitea")
    expect(await run({ config: cfg, document: yaml })).toMatchObject({ calls: 0, items: 0 })
  })

  it("maps supported files to their VS Code language identifiers", () => {
    expect(qwenLanguageId("/repo/src/main.c")).toBe("c")
    expect(qwenLanguageId("/repo/src/main.cpp")).toBe("cpp")
    expect(qwenLanguageId("/repo/src/main.py")).toBe("python")
    expect(qwenLanguageId("/repo/scripts/run.sh")).toBe("shellscript")
    expect(qwenLanguageId("/repo/.gitea/workflows/build.yml")).toBe("yaml")
  })

  it("prefilters only the exact Continue config path through the config rule", async () => {
    const root = await temp()
    process.env.CONTINUE_GLOBAL_DIR = root

    expect(decideQwenPrefilter(doc("{}", { languageId: "json", path: path.join(root, "config.json") })).reason).toBe(
      "continue-config",
    )
    expect(decideQwenPrefilter(doc("{}", { languageId: "json", path: "/repo/src/config.json" })).reason).not.toBe(
      "continue-config",
    )
  })

  it("source-maps Continue security concern patterns without broad indexing ignores", () => {
    expect(isQwenSecurityConcern("/repo/.env")).toBe(true)
    expect(isQwenSecurityConcern("/repo/secrets/main.c")).toBe(true)
    expect(isQwenSecurityConcern("/repo/src/main.c")).toBe(false)
  })

  it("blocks non-file, outside-workspace, sensitive, ignored, and guard-error files with distinct reasons", async () => {
    const root = await temp()
    await writeFile(path.join(root, ".chipmate-v2ignore"), "blocked.c\n")
    ;(vscode.workspace as unknown as { workspaceFolders: typeof folders }).workspaceFolders = [
      { uri: vscode.Uri.file(root), name: "repo", index: 0 },
    ]

    expect((await decideQwenGuard(doc("x", { scheme: "untitled", path: path.join(root, "a.c") }))).reason).toBe(
      "non-file-scheme",
    )
    expect((await decideQwenGuard(doc("x", { path: "/outside/main.c" }))).reason).toBe("outside-workspace")
    expect((await decideQwenGuard(doc("x", { path: path.join(root, "secrets/main.c") }))).reason).toBe(
      "security-concern",
    )
    expect((await decideQwenGuard(doc("x", { path: path.join(root, "blocked.c") }))).reason).toBe("ignored")
    expect(
      (
        await decideQwenGuard(
          doc("name: build", {
            languageId: "yaml",
            path: path.join(root, ".gitea/workflows/build.yml"),
          }),
        )
      ).reason,
    ).toBe("none")
  })

  it("guard exception fail-closes current-file requests and logs guard reason separately", async () => {
    const result = await run({
      config: { ...cfg, trace: true, logLevel: "debug" },
      guard: async () => {
        throw new Error("boom")
      },
    })

    expect(result.calls).toBe(0)
    const last = JSON.parse(qwenDiagnosticsForTests().at(-1) ?? "{}")
    expect(last.guardDecision).toBe("blocked")
    expect(last.guardReason).toBe("error")
    expect(last.guardErrorFailClosed).toBe(true)
    expect(last.prefilterDecision).toBe("allowed")
    expect(JSON.stringify(last)).not.toContain("secret")
  })
})

describe("qwen context-read guard decisions", () => {
  it("recently opened skips blocked files before reading content", async () => {
    let reads = 0
    const tracker = new QwenRecentlyOpenedTracker({
      guard: () => true,
      read: () => ({ ...cfg, recentlyOpenedEnabled: true }),
      readFile: async () => {
        reads++
        return new TextEncoder().encode("int blocked;")
      },
    })

    ;(tracker as unknown as { schedule(document: vscode.TextDocument): void }).schedule(
      doc("int blocked;", { path: "/repo/src/open.c" }),
    )
    await tracker.flush?.()
    const result = await tracker.snippets({ ...cfg, recentlyOpenedEnabled: true }, doc("int current;"))

    expect(result.snippets).toEqual([])
    expect(reads).toBe(0)
  })

  it("import definition target read skips blocked definitions", async () => {
    let reads = 0
    const tracker = new QwenImportDefinitionsTracker({
      definitions: async () => [{ filepath: "/repo/src/blocked.c", range: range(0, 0, 0, 3) }],
      guard: (document) => document.uri.fsPath.includes("blocked"),
      parse: async () => [{ symbol: "foo", position: { line: 0, character: 0 } }],
      read: () => ({ ...cfg, importDefinitionsEnabled: true }),
      readRange: async () => {
        reads++
        return "int foo;"
      },
    })

    const result = await tracker.snippets(
      { ...cfg, importDefinitionsEnabled: true },
      helper("foo();"),
      doc('#include "foo.h"\nfoo();'),
    )

    expect(result.snippets).toEqual([])
    expect(reads).toBe(0)
  })

  it("root path target read skips blocked definitions", async () => {
    let reads = 0
    const tracker = new QwenRootPathTracker({
      definitions: async () => [{ filepath: "/repo/src/blocked.c", range: range(0, 0, 0, 3) }],
      guard: (document) => document.uri.fsPath.includes("blocked"),
      path: async () => [node("function_definition")],
      query: async () => [{ line: 0, character: 1 }],
      readRange: async () => {
        reads++
        return "int foo;"
      },
    })

    const result = await tracker.snippets({ ...cfg, rootPathEnabled: true }, helper("foo();"))

    expect(result.snippets).toEqual([])
    expect(reads).toBe(0)
  })

  it("diagnostics keep context-read guard counts separate from prefilter and current-file guard", async () => {
    await run({
      config: { ...cfg, trace: true, logLevel: "debug", recentlyOpenedEnabled: true },
      opened: {
        count: () => 1,
        dispose: () => {},
        snippets: async () => ({ skippedCount: 1, snippets: [] }),
      },
    })

    const line = qwenDiagnosticsForTests().find((item) => item.includes('"phase":"prompt-built"')) ?? "{}"
    const entry = JSON.parse(line)
    expect(entry.contextReadGuardDecision).toBe("applied")
    expect(entry.contextReadGuardSkippedCount).toBe(1)
    expect(entry.prefilterDecision).toBeNull()
    expect(entry.guardSource).toBeNull()
  })
})

async function calls(config: QwenAutocompleteConfig, document?: vscode.TextDocument): Promise<number> {
  return (await run({ config, document })).calls
}

async function run(input: {
  config: QwenAutocompleteConfig
  document?: vscode.TextDocument
  guard?: () => boolean | Promise<boolean>
  opened?: {
    count(): number
    dispose(): void
    snippets(cfg: QwenAutocompleteConfig, current: vscode.TextDocument): Promise<{ skippedCount: number; snippets: [] }>
  }
}): Promise<{ calls: number; items: number }> {
  let count = 0
  const provider = new ChipMateQwenInlineCompletionProvider({
    client: {
      complete: async () => {
        count++
        return "return ok;"
      },
    } as unknown as QwenFimClient,
    guard: input.guard ?? (() => false),
    log: () => {},
    opened: input.opened,
    read: () => input.config,
  })

  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} }),
  } as unknown as vscode.CancellationToken
  const document = input.document ?? doc("int main(void) {\n  ")
  const line = document.lineCount - 1
  const items = await provider.provideInlineCompletionItems(
    document,
    new vscode.Position(line, document.lineAt(line).text.length),
    {},
    token,
  )
  provider.dispose()
  return { calls: count, items: items.length }
}

async function temp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qwen-security-"))
  dirs.push(dir)
  await mkdir(path.join(dir, "src"), { recursive: true })
  await mkdir(path.join(dir, "secrets"), { recursive: true })
  return dir
}

function doc(text: string, input: { languageId?: string; path?: string; scheme?: string } = {}): vscode.TextDocument {
  const lines = text.split("\n")
  const file = input.path ?? "/repo/src/main.c"
  const uri =
    input.scheme === "untitled"
      ? ({ scheme: "untitled", fsPath: file, path: file } as vscode.Uri)
      : vscode.Uri.file(file)
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
    getText: (target?: Range) => {
      if (!target) return text
      return text.slice(offset(lines, target.start), offset(lines, target.end))
    },
  } as unknown as vscode.TextDocument
}

function helper(text: string) {
  return createQwenAutocompleteHelper(doc(text), new vscode.Position(0, text.length))
}

function range(startLine: number, startChar: number, endLine: number, endChar: number): Range {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  }
}

function node(type: string) {
  return {
    startIndex: 1,
    type,
  } as never
}

function offset(lines: string[], pos: Pos): number {
  return lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.character
}
