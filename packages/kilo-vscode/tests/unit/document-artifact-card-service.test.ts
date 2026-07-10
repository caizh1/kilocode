import { describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

type VscodeMockState = {
  workspaceRoot: string
  agentTerminalEnabled: boolean
  warningChoice: string | undefined
  registeredCommands: Map<string, (...args: unknown[]) => unknown>
  executedCommands: Array<{ command: string; args: unknown[] }>
  createdTerminals: Array<{ options: Record<string, unknown>; shown: boolean; sent: string[] }>
  registeredProfileProvider?: { provideTerminalProfile: () => unknown }
}

function vscodeMockState(): VscodeMockState {
  const global = globalThis as typeof globalThis & { __kiloVscodeMockState?: VscodeMockState }
  global.__kiloVscodeMockState ??= {
    workspaceRoot: "/workspace",
    agentTerminalEnabled: false,
    warningChoice: "Enable for Workspace",
    registeredCommands: new Map(),
    executedCommands: [],
    createdTerminals: [],
  }
  return global.__kiloVscodeMockState
}

mock.module("vscode", () => ({
  ConfigurationTarget: {
    Workspace: 2,
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
  commands: {
    registerCommand: (command: string, callback: (...args: unknown[]) => unknown) => {
      vscodeMockState().registeredCommands.set(command, callback)
      return { dispose: () => vscodeMockState().registeredCommands.delete(command) }
    },
    executeCommand: (command: string, ...args: unknown[]) => {
      vscodeMockState().executedCommands.push({ command, args })
      return Promise.resolve()
    },
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => (key === "kilo.agentTerminal.enabled" ? vscodeMockState().agentTerminalEnabled : fallback),
      update: (key: string, value: unknown) => {
        if (key === "kilo.agentTerminal.enabled") vscodeMockState().agentTerminalEnabled = Boolean(value)
        return Promise.resolve()
      },
    }),
    get workspaceFolders() {
      return [{ uri: { fsPath: vscodeMockState().workspaceRoot } }]
    },
  },
  window: {
    showInputBox: () => undefined,
    showInformationMessage: () => undefined,
    showWarningMessage: () => Promise.resolve(vscodeMockState().warningChoice),
    createTerminal: (options: Record<string, unknown>) => {
      const terminal = {
        options,
        shown: false,
        sent: [] as string[],
        show: () => {
          terminal.shown = true
        },
        sendText: (text: string) => {
          terminal.sent.push(text)
        },
      }
      vscodeMockState().createdTerminals.push(terminal)
      return terminal
    },
    registerTerminalProfileProvider: (_id: string, provider: { provideTerminalProfile: () => unknown }) => {
      vscodeMockState().registeredProfileProvider = provider
      return { dispose: () => undefined }
    },
  },
  TerminalProfile: class TerminalProfile {
    options: unknown
    constructor(options: unknown) {
      this.options = options
    }
  },
}))

const { artifactManifestToCard, registerDocumentArtifactCommands } = await import("../../src/services/document-artifacts")

describe("artifactManifestToCard", () => {
  test("creates safe webview URIs for page PNG links and preserves warning quality", () => {
    vscodeMockState().workspaceRoot = "/workspace"
    const card = artifactManifestToCard({
      artifactDir: ".kilo/artifacts/render-1",
      webview: {
        asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => `vscode-webview://safe${uri.fsPath}` }),
      } as never,
      manifest: {
        kind: "word-render",
        title: "Render",
        primaryFile: "design.pdf",
        derivedFiles: ["rendered/page-001.png", "render-diagnostics.json"],
        warnings: ["blank-page: Renderer marked page 1 as blank."],
        quality: { status: "warning" },
      },
    })

    expect(card.quality).toBe("warning")
    expect(card.links.some((link) => link.kind === "pdf" && link.path === ".kilo/artifacts/render-1/design.pdf")).toBe(true)
    expect(card.links.find((link) => link.kind === "page-png")?.webviewUri).toBe("vscode-webview://safe/workspace/.kilo/artifacts/render-1/rendered/page-001.png")
    expect(card.links.some((link) => link.kind === "diagnostics")).toBe(true)
  })

  test("registers and executes diagnostics export inside the artifact root", async () => {
    const state = vscodeMockState()
    state.workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-document-artifacts-"))
    state.registeredCommands.clear()
    state.executedCommands.length = 0

    const artifactDir = path.join(state.workspaceRoot, ".kilo", "artifacts", "sample")
    await fs.mkdir(artifactDir, { recursive: true })
    await fs.writeFile(
      path.join(artifactDir, "artifact.json"),
      `${JSON.stringify({ kind: "word-document", title: "Sample", primaryFile: "sample.docx" })}\n`,
      "utf8",
    )

    const context = { subscriptions: [] as Array<{ dispose: () => void }> }
    registerDocumentArtifactCommands(context as never)
    await state.registeredCommands.get("kilo-code.new.documents.exportDiagnostics")?.()

    const artifactRoot = path.join(state.workspaceRoot, ".kilo", "artifacts")
    const diagnosticsFile = (await fs.readdir(artifactRoot)).find((entry) => /^artifact-diagnostics-.*\.json$/.test(entry))
    expect(diagnosticsFile).toBeDefined()
    const diagnostics = JSON.parse(await fs.readFile(path.join(artifactRoot, diagnosticsFile!), "utf8"))
    expect(diagnostics.root).toBe(".kilo/artifacts")
    expect(diagnostics.artifacts[0].manifest.title).toBe("Sample")
    expect(state.executedCommands).toContainEqual({
      command: "vscode.open",
      args: [{ fsPath: path.join(artifactRoot, diagnosticsFile!) }],
    })
  })

  test("ignores root-level diagnostics JSON files when exporting diagnostics again", async () => {
    const state = vscodeMockState()
    state.workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-document-artifacts-repeat-"))
    state.registeredCommands.clear()
    state.executedCommands.length = 0

    const artifactRoot = path.join(state.workspaceRoot, ".kilo", "artifacts")
    const artifactDir = path.join(artifactRoot, "sample")
    await fs.mkdir(artifactDir, { recursive: true })
    await fs.writeFile(
      path.join(artifactDir, "artifact.json"),
      `${JSON.stringify({ kind: "word-document", title: "Sample", primaryFile: "sample.docx" })}\n`,
      "utf8",
    )
    await fs.writeFile(path.join(artifactRoot, "artifact-diagnostics-existing.json"), "{}\n", "utf8")

    const context = { subscriptions: [] as Array<{ dispose: () => void }> }
    registerDocumentArtifactCommands(context as never)
    await state.registeredCommands.get("kilo-code.new.documents.exportDiagnostics")?.()

    const diagnosticsFiles = (await fs.readdir(artifactRoot)).filter((entry) => /^artifact-diagnostics-.*\.json$/.test(entry))
    const generated = diagnosticsFiles.find((entry) => entry !== "artifact-diagnostics-existing.json")
    expect(generated).toBeDefined()

    const diagnostics = JSON.parse(await fs.readFile(path.join(artifactRoot, generated!), "utf8"))
    expect(diagnostics.artifacts).toHaveLength(1)
    expect(diagnostics.artifacts[0].artifactDir).toBe(".kilo/artifacts/sample")
  })
})
