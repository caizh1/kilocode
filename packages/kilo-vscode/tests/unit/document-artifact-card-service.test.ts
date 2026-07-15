import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as vscode from "vscode"
import { artifactManifestToCard, registerDocumentArtifactCommands } from "../../src/services/document-artifacts"

type State = {
  workspaceRoot: string
  registeredCommands: Map<string, (...args: unknown[]) => unknown>
  executedCommands: Array<{ command: string; args: unknown[] }>
}

const base = {
  execute: async () => undefined,
  config: () => ({ get: <T>(_key: string, value?: T) => value }),
  register: () => ({ dispose: () => undefined }),
  folders: [{ uri: { fsPath: "/repo" } }] as vscode.WorkspaceFolder[],
}

afterEach(() => {
  ;(vscode.commands as unknown as { executeCommand: typeof base.execute }).executeCommand = base.execute
  ;(vscode.commands as unknown as { registerCommand: typeof base.register }).registerCommand = base.register
  ;(vscode.workspace as unknown as { getConfiguration: typeof base.config }).getConfiguration = base.config
  ;(vscode.workspace as unknown as { workspaceFolders: typeof base.folders }).workspaceFolders = base.folders
})

function state(): State {
  return { workspaceRoot: "/workspace", registeredCommands: new Map(), executedCommands: [] }
}

function install(value: State) {
  ;(vscode.commands as unknown as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand = (
    command: string,
    callback: (...args: unknown[]) => unknown,
  ) => {
    value.registeredCommands.set(command, callback)
    return { dispose: () => value.registeredCommands.delete(command) }
  }
  ;(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = async (
    command: string,
    ...args: unknown[]
  ) => {
    value.executedCommands.push({ command, args })
  }
  ;(vscode.workspace as unknown as { getConfiguration: typeof base.config }).getConfiguration = base.config
  ;(vscode.workspace as unknown as { workspaceFolders: vscode.WorkspaceFolder[] }).workspaceFolders = [
    { uri: { fsPath: value.workspaceRoot } } as vscode.WorkspaceFolder,
  ]
}

describe("artifactManifestToCard", () => {
  test("creates safe webview URIs for page PNG links and preserves warning quality", () => {
    const value = state()
    install(value)
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
    expect(card.links.some((link) => link.kind === "pdf" && link.path === ".kilo/artifacts/render-1/design.pdf")).toBe(
      true,
    )
    expect(card.links.find((link) => link.kind === "page-png")?.webviewUri).toBe(
      "vscode-webview://safe/workspace/.kilo/artifacts/render-1/rendered/page-001.png",
    )
    expect(card.links.some((link) => link.kind === "diagnostics")).toBe(true)
  })

  test("registers and executes diagnostics export inside the artifact root", async () => {
    const value = state()
    value.workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-document-artifacts-"))
    install(value)

    const artifactDir = path.join(value.workspaceRoot, ".kilo", "artifacts", "sample")
    await fs.mkdir(artifactDir, { recursive: true })
    await fs.writeFile(
      path.join(artifactDir, "artifact.json"),
      `${JSON.stringify({ kind: "word-document", title: "Sample", primaryFile: "sample.docx" })}\n`,
      "utf8",
    )

    const context = { subscriptions: [] as Array<{ dispose: () => void }> }
    registerDocumentArtifactCommands(context as never)
    await value.registeredCommands.get("kilo-code.new.documents.exportDiagnostics")?.()

    const artifactRoot = path.join(value.workspaceRoot, ".kilo", "artifacts")
    const diagnosticsFile = (await fs.readdir(artifactRoot)).find((entry) =>
      /^artifact-diagnostics-.*\.json$/.test(entry),
    )
    expect(diagnosticsFile).toBeDefined()
    const diagnostics = JSON.parse(await fs.readFile(path.join(artifactRoot, diagnosticsFile!), "utf8"))
    expect(diagnostics.root).toBe(".kilo/artifacts")
    expect(diagnostics.artifacts[0].manifest.title).toBe("Sample")
    expect(value.executedCommands).toContainEqual({
      command: "vscode.open",
      args: [
        {
          scheme: "file",
          authority: "",
          path: path.join(artifactRoot, diagnosticsFile!),
          query: "",
          fragment: "",
          fsPath: path.join(artifactRoot, diagnosticsFile!),
        },
      ],
    })
  })

  test("ignores root-level diagnostics JSON files when exporting diagnostics again", async () => {
    const value = state()
    value.workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-document-artifacts-repeat-"))
    install(value)

    const artifactRoot = path.join(value.workspaceRoot, ".kilo", "artifacts")
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
    await value.registeredCommands.get("kilo-code.new.documents.exportDiagnostics")?.()

    const diagnosticsFiles = (await fs.readdir(artifactRoot)).filter((entry) =>
      /^artifact-diagnostics-.*\.json$/.test(entry),
    )
    const generated = diagnosticsFiles.find((entry) => entry !== "artifact-diagnostics-existing.json")
    expect(generated).toBeDefined()
    const diagnostics = JSON.parse(await fs.readFile(path.join(artifactRoot, generated!), "utf8"))
    expect(diagnostics.artifacts).toHaveLength(1)
    expect(diagnostics.artifacts[0].artifactDir).toBe(".kilo/artifacts/sample")
  })
})
