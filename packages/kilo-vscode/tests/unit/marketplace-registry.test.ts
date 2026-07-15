import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import * as vscode from "vscode"
import { InstallRegistry } from "../../src/services/marketplace/registry"
import { LocalImportRegistry } from "../../src/services/marketplace/local-import-registry"

const fs = vscode.workspace.fs as unknown as {
  createDirectory(uri: vscode.Uri): Promise<void>
  readFile(uri: vscode.Uri): Promise<Uint8Array>
  writeFile(uri: vscode.Uri, data: Uint8Array): Promise<void>
  rename?(source: vscode.Uri, target: vscode.Uri, opts: { overwrite: boolean }): Promise<void>
}
const original = {
  createDirectory: fs.createDirectory,
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  rename: fs.rename,
}

afterEach(() => {
  fs.createDirectory = original.createDirectory
  fs.readFile = original.readFile
  fs.writeFile = original.writeFile
  fs.rename = original.rename
})

describe("Marketplace globalStorage installation metadata", () => {
  it("persists only pseudonymous metadata and restores it in a new registry instance", async () => {
    const files = new Map<string, Uint8Array>()
    fs.createDirectory = async () => {}
    fs.writeFile = async (uri, data) => {
      files.set(uri.fsPath, data)
    }
    fs.readFile = async (uri) => {
      const data = files.get(uri.fsPath)
      if (!data) throw Object.assign(new Error("missing"), { code: "FileNotFound" })
      return data
    }
    fs.rename = async (source, target) => {
      const data = files.get(source.fsPath)
      if (!data) throw new Error("missing staging metadata")
      files.set(target.fsPath, data)
      files.delete(source.fsPath)
    }
    const state = new Map<string, unknown>()
    const context = {
      globalStorageUri: vscode.Uri.file("/storage"),
      globalState: {
        get: <T>(key: string) => state.get(key) as T | undefined,
        update: async (key: string, value: unknown) => {
          state.set(key, value)
        },
      },
    } as unknown as vscode.ExtensionContext
    const registry = new InstallRegistry(context)
    const clientId = await registry.clientId()
    const workspaceId = registry.workspaceId("/private/team/project")
    expect(workspaceId).toMatch(/^workspace-[a-f0-9]{40}$/)
    await registry.put({
      origin: "http://market.test",
      skillId: "documents",
      revision: 2,
      sha256: "a".repeat(64),
      scope: "project",
      clientId,
      workspaceId,
      changedAt: "2026-07-12T00:00:00.000Z",
    })

    const restored = await new InstallRegistry(context).list("http://market.test")
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({ skillId: "documents", revision: 2, workspaceId, clientId })
    const raw = Buffer.from(files.get("/storage/marketplace/installations.json") ?? []).toString("utf8")
    expect(raw).not.toContain("/private/team/project")
    expect(raw).not.toContain("apiKey")
  })

  it("stores versioned local import fingerprints without absolute source or workspace paths", async () => {
    const files = new Map<string, Uint8Array>()
    fs.createDirectory = async () => {}
    fs.writeFile = async (uri, data) => {
      files.set(uri.fsPath, data)
    }
    fs.readFile = async (uri) => {
      const data = files.get(uri.fsPath)
      if (!data) throw Object.assign(new Error("missing"), { code: "FileNotFound" })
      return data
    }
    fs.rename = async (source, target) => {
      const data = files.get(source.fsPath)
      if (!data) throw new Error("missing staging metadata")
      files.set(target.fsPath, data)
      files.delete(source.fsPath)
    }
    const context = { globalStorageUri: vscode.Uri.file("/storage") } as unknown as vscode.ExtensionContext
    const registry = new LocalImportRegistry(context)
    const workspaceId = registry.workspaceId("/private/team/secret-project")
    await registry.put({
      version: 1,
      skillId: "portable-skill",
      scope: "project",
      workspaceId,
      sourceKind: "zip",
      sourceLabel: "portable-skill.zip",
      sourceSha256: "a".repeat(64),
      installedSha256: "b".repeat(64),
      specVersion: "agent-skills-1",
      hints: ["agent-skills", "codex"],
      importedAt: "2026-07-15T00:00:00.000Z",
    })

    const restored = await new LocalImportRegistry(context).list()
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({ skillId: "portable-skill", sourceKind: "zip", workspaceId })
    const raw = Buffer.from(files.get("/storage/marketplace/local-imports.json") ?? []).toString("utf8")
    expect(raw).not.toContain("/private/team/secret-project")
    expect(raw).not.toContain(os.homedir())
    expect(raw).not.toContain("fileContent")
  })
})
