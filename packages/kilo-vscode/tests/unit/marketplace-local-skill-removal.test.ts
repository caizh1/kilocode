import { afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as vscode from "vscode"
import { LocalImportRegistry } from "../../src/services/marketplace/local-import-registry"
import { LocalSkillRemoval } from "../../src/services/marketplace/local-skill-removal"

const vfs = vscode.workspace.fs as unknown as {
  createDirectory(uri: vscode.Uri): Promise<void>
  readFile(uri: vscode.Uri): Promise<Uint8Array>
  writeFile(uri: vscode.Uri, data: Uint8Array): Promise<void>
  rename(source: vscode.Uri, target: vscode.Uri, opts: { overwrite: boolean }): Promise<void>
  stat(uri: vscode.Uri): Promise<vscode.FileStat>
}
const original = {
  createDirectory: vfs.createDirectory,
  readFile: vfs.readFile,
  writeFile: vfs.writeFile,
  rename: vfs.rename,
  stat: vfs.stat,
}
const roots: string[] = []

afterEach(async () => {
  vfs.createDirectory = original.createDirectory
  vfs.readFile = original.readFile
  vfs.writeFile = original.writeFile
  vfs.rename = original.rename
  vfs.stat = original.stat
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("local Skill removal", () => {
  it("uses an opaque target, refreshes a stale CLI instance, and clears import metadata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-skill-remove-"))
    roots.push(root)
    bindFs()
    const project = path.join(root, "project")
    const storage = path.join(root, "storage")
    const skillRoot = path.join(project, ".kilo", "skills", "portable")
    const location = path.join(skillRoot, "SKILL.md")
    await fs.mkdir(skillRoot, { recursive: true })
    await fs.writeFile(location, "---\nname: portable\ndescription: test\n---\n")

    const context = { globalStorageUri: vscode.Uri.file(storage) } as vscode.ExtensionContext
    const registry = new LocalImportRegistry(context)
    const workspaceId = registry.workspaceId(project)
    await registry.put({
      version: 1,
      skillId: "portable",
      scope: "project",
      workspaceId,
      sourceKind: "zip",
      sourceLabel: "portable.zip",
      sourceSha256: "a".repeat(64),
      installedSha256: "b".repeat(64),
      specVersion: "agent-skills-1",
      hints: ["agent-skills"],
      importedAt: "2026-07-15T00:00:00.000Z",
    })

    const skill = { name: "portable", description: "test", location }
    let removed = false
    let disposed = false
    const client = {
      app: { skills: async () => ({ data: removed && disposed ? [] : [skill] }) },
      kilocode: {
        removeSkill: async () => {
          removed = true
          await fs.rm(skillRoot, { recursive: true, force: true })
          return { data: true }
        },
      },
      instance: {
        dispose: async () => {
          disposed = true
          return { data: true }
        },
      },
    }
    const connection = { getClientAsync: async () => client } as never
    const removal = new LocalSkillRemoval(connection, context)
    const target = removal.issue([skill], project)[0]!
    const phases: string[] = []

    const result = await removal.remove(
      {
        requestId: "request-1",
        targetToken: target.targetToken,
        skillId: target.skillId,
        scope: target.scope,
      },
      project,
      (phase) => phases.push(phase),
    )

    expect(result).toMatchObject({ success: true, skillId: "portable", scope: "project" })
    expect(disposed).toBe(true)
    expect(phases).toEqual(["validating", "removing", "refreshing", "reconciling"])
    expect(await exists(skillRoot)).toBe(false)
    expect(await registry.list()).toEqual([])
  })

  it("rejects an unknown token without deleting files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-skill-token-"))
    roots.push(root)
    bindFs()
    const project = path.join(root, "project")
    const skillRoot = path.join(project, ".kilo", "skills", "protected")
    const location = path.join(skillRoot, "SKILL.md")
    await fs.mkdir(skillRoot, { recursive: true })
    await fs.writeFile(location, "test")
    let called = false
    const connection = {
      getClientAsync: async () => {
        called = true
        throw new Error("must not connect")
      },
    } as never
    const context = { globalStorageUri: vscode.Uri.file(path.join(root, "storage")) } as vscode.ExtensionContext
    const removal = new LocalSkillRemoval(connection, context)
    expect(removal.issue([{ name: "different", location }], project)).toEqual([])

    const result = await removal.remove(
      { requestId: "request-2", targetToken: "unknown", skillId: "protected", scope: "project" },
      project,
      () => {},
    )

    expect(result.success).toBe(false)
    expect(called).toBe(false)
    expect(await exists(skillRoot)).toBe(true)
  })

  it("prunes stale local import records for the active workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-skill-reconcile-"))
    roots.push(root)
    bindFs()
    const project = path.join(root, "project")
    const context = { globalStorageUri: vscode.Uri.file(path.join(root, "storage")) } as vscode.ExtensionContext
    const registry = new LocalImportRegistry(context)
    await registry.put({
      version: 1,
      skillId: "missing",
      scope: "project",
      workspaceId: registry.workspaceId(project),
      sourceKind: "directory",
      sourceLabel: "missing",
      sourceSha256: "a".repeat(64),
      installedSha256: "b".repeat(64),
      specVersion: "agent-skills-1",
      hints: ["agent-skills"],
      importedAt: "2026-07-15T00:00:00.000Z",
    })

    expect(await registry.reconcile(project)).toBe(1)
    expect(await registry.list()).toEqual([])
  })
})

function bindFs() {
  vfs.createDirectory = async (uri) => fs.mkdir(uri.fsPath, { recursive: true }).then(() => undefined)
  vfs.readFile = async (uri) => new Uint8Array(await fs.readFile(uri.fsPath))
  vfs.writeFile = async (uri, data) => fs.writeFile(uri.fsPath, data).then(() => undefined)
  vfs.rename = async (source, target) => fs.rename(source.fsPath, target.fsPath)
  vfs.stat = async (uri) => {
    const stat = await fs.stat(uri.fsPath)
    return { type: 2 as vscode.FileType, ctime: stat.ctimeMs, mtime: stat.mtimeMs, size: stat.size }
  }
}

function exists(file: string) {
  return fs.stat(file).then(
    () => true,
    () => false,
  )
}
