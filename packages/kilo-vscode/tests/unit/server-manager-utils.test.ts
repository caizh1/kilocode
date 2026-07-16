import { describe, it, expect } from "bun:test"
import { parseServerPort } from "../../src/services/cli-backend/server-utils"
import {
  buildBundledToolEnv,
  isIndexingDiagnosticLine,
  resolveServerCwd,
  resolveManagedServerEnv,
  ServerManager,
  toErrorMessage,
} from "../../src/services/cli-backend/server-manager"
import {
  copyKiloSandboxWorker,
  copyIndexingProcess,
  copyTreeSitterResources,
  indexingProcessForBinary,
  kiloSandboxWorkerForBinary,
  lancedbEntryForExtension,
  resolveTreeSitterEnv,
  resolveLanceDBEnv,
  treeSitterDirForBinary,
  treeSitterDirForExtension,
} from "../../src/services/cli-backend/cli-resources"
import { internalOfflineEnv } from "../../src/shared/internal-offline"
import { appendIndexingStderr, recordIndexingStatus } from "../../src/services/indexing-output"
import type { IndexingStatus } from "../../src/services/cli-backend/types"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { pathToFileURL } from "url"
import * as vscode from "vscode"

function captureOutput() {
  const original = vscode.window.createOutputChannel
  const originalWarning = vscode.window.showWarningMessage
  const originalInfo = vscode.window.showInformationMessage
  const names: string[] = []
  const lines: string[] = []
  const warnings: Array<{ message: string; items: string[] }> = []
  const infos: Array<{ message: string; items: string[] }> = []
  const subs: vscode.Disposable[] = []
  let shown = 0
  const win = vscode.window as unknown as {
    createOutputChannel(name: string): vscode.OutputChannel
    showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>
    showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>
  }
  win.createOutputChannel = (name) => {
    names.push(name)
    return {
      name,
      append() {},
      appendLine(line) {
        lines.push(line)
      },
      replace() {},
      clear() {},
      show() {
        shown++
      },
      hide() {},
      dispose() {},
    } as vscode.OutputChannel
  }
  win.showWarningMessage = (message, ...items) => {
    warnings.push({ message, items })
    return Promise.resolve(items[0])
  }
  win.showInformationMessage = (message, ...items) => {
    infos.push({ message, items })
    return Promise.resolve(items[0])
  }

  return {
    names,
    lines,
    warnings,
    infos,
    get shown() {
      return shown
    },
    context: {
      subscriptions: subs,
      extensionPath: "/extension",
      globalStorageUri: { fsPath: "/tmp/kilo" },
      extension: { packageJSON: { version: "0.0.0" } },
    } as unknown as vscode.ExtensionContext,
    restore() {
      for (const sub of subs.splice(0)) sub.dispose()
      win.createOutputChannel = original
      win.showWarningMessage = originalWarning
      win.showInformationMessage = originalInfo
    },
  }
}

describe("parseServerPort", () => {
  it("parses port from standard CLI startup message", () => {
    expect(parseServerPort("kilo server listening on http://127.0.0.1:12345")).toBe(12345)
  })

  it("parses port from localhost variant", () => {
    expect(parseServerPort("listening on http://localhost:8080")).toBe(8080)
  })

  it("parses port when embedded in longer output", () => {
    const output = "[INFO] 2024-01-01 kilo server listening on http://127.0.0.1:54321\n[INFO] ready"
    expect(parseServerPort(output)).toBe(54321)
  })

  it("returns null for output without listening message", () => {
    expect(parseServerPort("Starting server...")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(parseServerPort("")).toBeNull()
  })

  it("returns null when no port in URL", () => {
    expect(parseServerPort("listening on http://127.0.0.1")).toBeNull()
  })

  it("parses high port numbers", () => {
    expect(parseServerPort("listening on http://127.0.0.1:65535")).toBe(65535)
  })

  it("parses port 1 (edge case)", () => {
    expect(parseServerPort("listening on http://127.0.0.1:1")).toBe(1)
  })

  it("returns null for stderr-style messages without port", () => {
    expect(parseServerPort("[ERROR] failed to bind port")).toBeNull()
  })

  it("matches only first occurrence when multiple ports present", () => {
    const output = "listening on http://127.0.0.1:3000 and http://127.0.0.1:4000"
    expect(parseServerPort(output)).toBe(3000)
  })
})

describe("cli tree-sitter resources", () => {
  it("resolves the isolated indexing process next to each CLI binary", () => {
    expect(indexingProcessForBinary("/extension/bin/kilo")).toBe("/extension/bin/kilo-indexer")
    expect(indexingProcessForBinary(String.raw`C:\extension\bin\kilo.exe`)).toBe(
      String.raw`C:\extension\bin\kilo-indexer.exe`,
    )
  })

  it("copies the isolated indexing process with executable permissions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-indexer-"))
    try {
      const source = path.join(root, "dist", "bin", "kilo")
      const target = path.join(root, "extension", "bin", "kilo")
      await fs.mkdir(path.dirname(source), { recursive: true })
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(indexingProcessForBinary(source), "indexer")

      await copyIndexingProcess(source, target)

      expect(await fs.readFile(indexingProcessForBinary(target), "utf8")).toBe("indexer")
      expect((await fs.stat(indexingProcessForBinary(target))).mode & 0o111).not.toBe(0)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("resolves resources next to the VS Code bundled CLI", () => {
    const root = "/Users/test/.vscode/extensions/kilocode.kilo-code-7.2.50-darwin-arm64"
    const bin = `${root}/bin/kilo`

    expect(treeSitterDirForBinary(bin)).toBe(`${root}/bin/tree-sitter`)
    expect(treeSitterDirForExtension(root)).toBe(`${root}/bin/tree-sitter`)
    expect(kiloSandboxWorkerForBinary(bin)).toBe(`${root}/bin/kilo-sandbox-mutation-worker.js`)
    expect(resolveTreeSitterEnv(root)).toEqual({ KILO_TREE_SITTER_WASM_DIR: `${root}/bin/tree-sitter` })
  })

  it("resolves resources next to a Windows packaged CLI", () => {
    const root = String.raw`C:\Users\test\.vscode\extensions\kilocode.kilo-code-7.2.50-win32-x64`
    const bin = String.raw`${root}\bin\kilo.exe`

    expect(treeSitterDirForBinary(bin)).toBe(String.raw`${root}\bin\tree-sitter`)
    expect(treeSitterDirForExtension(root)).toBe(String.raw`${root}\bin\tree-sitter`)
    expect(kiloSandboxWorkerForBinary(bin)).toBe(String.raw`${root}\bin\kilo-sandbox-mutation-worker.js`)
    expect(resolveTreeSitterEnv(root)).toEqual({
      KILO_TREE_SITTER_WASM_DIR: String.raw`${root}\bin\tree-sitter`,
    })
  })

  it("copies the Kilo sandbox worker with the packaged CLI binary", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-sandbox-worker-"))
    try {
      const source = path.join(root, "dist", "@kilocode", "cli-darwin-arm64", "bin", "kilo")
      const target = path.join(root, "extension", "bin", "kilo")
      await fs.mkdir(path.dirname(source), { recursive: true })
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(kiloSandboxWorkerForBinary(source), "worker")

      await copyKiloSandboxWorker(source, target)

      expect(await fs.readFile(kiloSandboxWorkerForBinary(target), "utf8")).toBe("worker")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("copies runtime and language WASMs with the packaged CLI binary", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-tree-sitter-"))
    try {
      const source = path.join(root, "dist", "@kilocode", "cli-darwin-arm64", "bin", "kilo")
      const target = path.join(root, "extension", "bin", "kilo")
      const dir = treeSitterDirForBinary(source)

      await fs.mkdir(dir, { recursive: true })
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(source, "binary")
      await fs.writeFile(target, "binary")
      await fs.writeFile(path.join(dir, "tree-sitter.wasm"), "runtime")
      await fs.writeFile(path.join(dir, "tree-sitter-typescript.wasm"), "language")

      await copyTreeSitterResources(source, target)

      expect(await fs.readFile(path.join(treeSitterDirForBinary(target), "tree-sitter.wasm"), "utf8")).toBe("runtime")
      expect(await fs.readFile(path.join(treeSitterDirForBinary(target), "tree-sitter-typescript.wasm"), "utf8")).toBe(
        "language",
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("resolves bundled LanceDB runtime only when it exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-lancedb-"))
    const entry = lancedbEntryForExtension(root)
    try {
      expect(resolveLanceDBEnv(root)).toEqual({})

      await fs.mkdir(path.dirname(entry), { recursive: true })
      await fs.writeFile(entry, "module.exports = {}")

      expect(resolveLanceDBEnv(root)).toEqual({ KILO_LANCEDB_PATH: pathToFileURL(entry).href })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe("toErrorMessage", () => {
  it("uses last non-empty stderr line as userMessage when no Error: line", () => {
    const result = toErrorMessage("startup failed", ["line one", "line two", ""])
    expect(result.userMessage).toBe("line two")
  })

  it("extracts message after Error: when present", () => {
    const result = toErrorMessage("startup failed", ["some noise", "Error: something went wrong"])
    expect(result.userMessage).toBe("something went wrong")
  })

  it("strips ANSI codes before matching Error:", () => {
    const ansiError = "\x1b[91m\x1b[1mError: \x1b[0mConfig file at /path/kilo.json is not valid JSON(C):"
    const result = toErrorMessage("startup failed", [ansiError])
    expect(result.userMessage).toBe("Config file at /path/kilo.json is not valid JSON(C):")
  })

  it("finds Error: line anywhere, not just the last line", () => {
    const result = toErrorMessage("startup failed", ["Error: the real problem", "subsequent noise", "more noise"])
    expect(result.userMessage).toBe("the real problem")
  })

  it("falls back to last non-empty line when no Error: match", () => {
    const result = toErrorMessage("startup failed", ["", "just some output", ""])
    expect(result.userMessage).toBe("just some output")
  })

  it("falls back to error arg when stderr is empty", () => {
    const result = toErrorMessage("startup failed", [])
    expect(result.userMessage).toBe("startup failed")
  })

  it("strips ANSI from fallback last non-empty line", () => {
    const result = toErrorMessage("startup failed", ["\x1b[31msome colored output\x1b[0m"])
    expect(result.userMessage).toBe("some colored output")
  })

  it("includes error arg in userDetails", () => {
    const result = toErrorMessage("startup failed", ["some output"])
    expect(result.userDetails).toContain("startup failed")
  })

  it("includes CLI path in userDetails when provided", () => {
    const result = toErrorMessage("startup failed", [], "/usr/local/bin/kilo")
    expect(result.userDetails).toContain("CLI path: /usr/local/bin/kilo")
  })

  it("does not include CLI path in userDetails when not provided", () => {
    const result = toErrorMessage("startup failed", [])
    expect(result.userDetails).not.toContain("CLI path:")
  })

  it("returns original error string as error field", () => {
    const result = toErrorMessage("startup failed", ["some output"])
    expect(result.error).toBe("startup failed")
  })
})

describe("server workspace helpers", () => {
  it("uses first workspace folder as server cwd when present", () => {
    const folders = [{ uri: { fsPath: "/repo" } }]

    expect(resolveServerCwd(folders, "/global-storage")).toBe("/repo")
  })

  it("uses extension storage as server cwd when no workspace folder is open", () => {
    expect(resolveServerCwd(undefined, "/global-storage")).toBe("/global-storage")
    expect(resolveServerCwd([], "/global-storage")).toBe("/global-storage")
  })

  it("uses the shared database for the managed backend while preserving the environment", () => {
    expect(
      resolveManagedServerEnv({
        PATH: "/usr/bin",
        KILO_DISABLE_CHANNEL_DB: "false",
        KILO_DISABLE_CODEBASE_INDEXING: "maintenance-window",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      KILO_DISABLE_CHANNEL_DB: "true",
      KILO_DISABLE_CODEBASE_INDEXING: "maintenance-window",
    })
  })
})

describe("server bundled tool env", () => {
  it("prepends extension tool directories to PATH so bundled tools are preferred", () => {
    const env = buildBundledToolEnv("/extension", { PATH: "/usr/bin" })

    expect(env).toEqual({
      PATH: `/extension/bin/poppler${path.delimiter}/extension/bin${path.delimiter}/usr/bin`,
      KILO_RIPGREP_PATH: "/extension/bin/rg",
    })
  })

  it("sets PATH to extension tool directories when no PATH exists", () => {
    const env = buildBundledToolEnv("/extension", {})

    expect(env).toEqual({
      PATH: `/extension/bin/poppler${path.delimiter}/extension/bin`,
      KILO_RIPGREP_PATH: "/extension/bin/rg",
    })
  })
})

describe("internal offline env", () => {
  it("is empty for public builds", () => {
    expect(internalOfflineEnv(false)).toEqual({})
  })

  it("marks the spawned CLI as internal offline", () => {
    expect(internalOfflineEnv(true)).toEqual({
      CHIPMATE_INTERNAL_OFFLINE: "1",
      KILO_INTERNAL_OFFLINE: "1",
      KILO_DISABLE_MODELS_FETCH: "1",
    })
  })
})

describe("server indexing stderr filter", () => {
  it("registers the ChipMate Indexing channel before stderr arrives", () => {
    const out = captureOutput()

    try {
      new ServerManager(out.context)

      expect(out.names).toContain("ChipMate Indexing")
      expect(out.lines[0]).toContain("ChipMate Indexing diagnostics ready")
      expect(out.context.subscriptions.length).toBeGreaterThanOrEqual(1)
    } finally {
      out.restore()
    }
  })

  it("writes indexing status errors to the ChipMate Indexing output channel", () => {
    const out = captureOutput()
    const status: IndexingStatus = {
      state: "Error",
      message: "Indexing failed.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      pipelines: {
        codeGraph: {
          state: "Error",
          message: "Code Graph unavailable.",
          detail: "Code Graph initialization failed.",
          processedFiles: 0,
          totalFiles: 0,
          percent: 0,
          errorCount: 1,
          staleCount: 0,
          skippedCount: 0,
          recentErrors: [
            {
              time: "2026-06-15T00:00:00.000Z",
              source: "indexing",
              location: "indexing:initialize",
              message: "",
            },
          ],
        },
        rag: {
          state: "Error",
          message: "RAG indexing unavailable.",
          detail: "RAG initialization failed.",
          processedFiles: 0,
          totalFiles: 0,
          percent: 0,
          errorCount: 1,
          staleCount: 0,
          skippedCount: 0,
        },
      },
    }

    try {
      recordIndexingStatus(out.context, status)

      expect(out.lines.some((line) => line.includes("Indexing status: Error - Indexing failed."))).toBe(true)
      expect(
        out.lines.some((line) => line.includes("Code Graph: Error; detail=Code Graph initialization failed.")),
      ).toBe(true)
      expect(
        out.lines.some((line) => line.includes("indexing:indexing:initialize - Code Graph initialization failed.")),
      ).toBe(true)
      expect(out.lines.some((line) => line.includes("RAG recent error: RAG initialization failed."))).toBe(true)
    } finally {
      out.restore()
    }
  })

  it("dedupes repeated indexing status output but writes changed details", () => {
    const out = captureOutput()
    const status: IndexingStatus = {
      state: "Error",
      message: "Indexing failed.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
      pipelines: {
        codeGraph: {
          state: "Error",
          message: "Code Graph unavailable.",
          detail: "first failure",
          processedFiles: 0,
          totalFiles: 0,
          percent: 0,
          errorCount: 1,
          staleCount: 0,
          skippedCount: 0,
        },
        rag: {
          state: "Disabled",
          message: "RAG disabled.",
          processedFiles: 0,
          totalFiles: 0,
          percent: 0,
          errorCount: 0,
          staleCount: 0,
          skippedCount: 0,
        },
      },
    }

    try {
      recordIndexingStatus(out.context, status)
      const once = out.lines.length
      recordIndexingStatus(out.context, status)
      expect(out.lines.length).toBe(once)
      recordIndexingStatus(out.context, {
        ...status,
        pipelines: {
          ...status.pipelines!,
          codeGraph: { ...status.pipelines!.codeGraph, detail: "second failure" },
        },
      })
      expect(out.lines.length).toBeGreaterThan(once)
    } finally {
      out.restore()
    }
  })

  it("does not show indexing notices for ordinary indexing status", () => {
    const out = captureOutput()
    const status: IndexingStatus = {
      state: "In Progress",
      message: "Indexing in progress.",
      processedFiles: 1,
      totalFiles: 2,
      percent: 50,
    }

    try {
      recordIndexingStatus(out.context, status)

      expect(out.warnings).toHaveLength(0)
      expect(out.infos).toHaveLength(0)
      expect(out.names).toHaveLength(0)
    } finally {
      out.restore()
    }
  })

  it("shows schema mismatch notices once and opens the indexing output", async () => {
    const out = captureOutput()
    const message = "检测到当前工作区的本地 RAG 索引格式来自旧版本，ChipMate 正在自动重建；CodeGraph 数据会保留。"
    const status: IndexingStatus = {
      state: "In Progress",
      message: "Indexing in progress.",
      processedFiles: 1,
      totalFiles: 2,
      percent: 50,
      notices: [
        {
          id: "rag-lancedb-schema-mismatch-test",
          level: "warning",
          message,
          action: "openIndexingOutput",
        },
      ],
    }

    try {
      recordIndexingStatus(out.context, status)
      recordIndexingStatus(out.context, status)
      await Promise.resolve()

      expect(out.warnings).toEqual([{ message, items: ["Open Indexing Output"] }])
      expect(out.lines.some((line) => line.includes(`Indexing notice: warning - ${message}`))).toBe(true)
      expect(out.shown).toBe(1)
    } finally {
      out.restore()
    }
  })

  it("keeps indexing stderr and ignores unrelated server noise", () => {
    const out = captureOutput()

    try {
      appendIndexingStderr(out.context, "server listening on http://127.0.0.1:1234\nLanceDB failed to initialize")

      expect(out.lines.some((line) => line === "server listening on http://127.0.0.1:1234")).toBe(false)
      expect(out.lines.some((line) => line === "LanceDB failed to initialize")).toBe(true)
    } finally {
      out.restore()
    }
  })

  it("keeps indexing diagnostics for the ChipMate Indexing output channel", () => {
    expect(isIndexingDiagnosticLine('{"level":"ERROR","service":"indexing-manager","message":"LanceDB failed"}')).toBe(
      true,
    )
    expect(isIndexingDiagnosticLine("tree-sitter worker failed to load parser")).toBe(true)
    expect(isIndexingDiagnosticLine("ripgrep executable missing: rg.exe")).toBe(true)
  })

  it("ignores unrelated stderr noise", () => {
    expect(isIndexingDiagnosticLine("server listening on http://127.0.0.1:1234")).toBe(false)
    expect(isIndexingDiagnosticLine("git status failed for an agent session")).toBe(false)
  })
})
