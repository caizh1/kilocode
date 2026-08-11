import { createHash, randomUUID } from "crypto"
import * as fs from "node:fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import type { LocalSkillRecord } from "./types"

const LOCK_STALE = 30_000

export class LocalImportRegistry {
  constructor(private readonly context: vscode.ExtensionContext) {}

  workspaceId(dir: string | undefined) {
    if (!dir) return undefined
    return `workspace-${createHash("sha256").update(dir).digest("hex").slice(0, 40)}`
  }

  async get(skillId: string, scope: "global" | "project", workspaceId?: string) {
    return (await this.read())[key(skillId, scope, workspaceId)]
  }

  async list() {
    return Object.values(await this.read())
  }

  async put(item: LocalSkillRecord) {
    await this.locked(async () => {
      const items = await this.read()
      items[key(item.skillId, item.scope, item.workspaceId)] = item
      await this.write(items)
    })
  }

  async remove(skillId: string, scope: "global" | "project", workspaceId?: string) {
    await this.locked(async () => {
      const items = await this.read()
      delete items[key(skillId, scope, workspaceId)]
      await this.write(items)
    })
  }

  async cas(
    skillId: string,
    scope: "global" | "project",
    workspaceId: string | undefined,
    before: LocalSkillRecord | undefined,
    after: LocalSkillRecord | undefined,
  ) {
    return this.locked(async () => {
      const items = await this.read()
      const id = key(skillId, scope, workspaceId)
      if (!equal(items[id], before)) return false
      if (after) items[id] = after
      else delete items[id]
      await this.write(items)
      return true
    })
  }

  async reconcile(project?: string) {
    const items = await this.read()
    const workspaceId = this.workspaceId(project)
    const stale: string[] = []
    for (const [id, item] of Object.entries(items)) {
      if (item.scope === "project" && (!project || item.workspaceId !== workspaceId)) continue
      const root =
        item.scope === "global"
          ? path.join(this.context.globalStorageUri.fsPath, "config", "skills")
          : path.join(project!, ".chipmate-v2", "skills")
      const exists = await vscode.workspace.fs.stat(vscode.Uri.file(path.join(root, item.skillId))).then(
        () => true,
        () => false,
      )
      if (!exists) stale.push(id)
    }
    if (stale.length === 0) return 0
    for (const id of stale) delete items[id]
    await this.write(items)
    return stale.length
  }

  private async read(): Promise<Record<string, LocalSkillRecord>> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.file())
      const value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown
      if (!value || typeof value !== "object" || Array.isArray(value)) return {}
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, LocalSkillRecord] =>
            Boolean(entry[1]) && typeof entry[1] === "object" && (entry[1] as { version?: unknown }).version === 1,
        ),
      )
    } catch (err) {
      if (["FileNotFound", "ENOENT"].includes((err as { code?: string }).code ?? "")) return {}
      console.warn("[ChipMate New] Local Skill import metadata read failed:", err)
      return {}
    }
  }

  private async write(items: Record<string, LocalSkillRecord>) {
    const dir = vscode.Uri.joinPath(this.context.globalStorageUri, "marketplace")
    const stage = vscode.Uri.joinPath(dir, `local-imports-${randomUUID()}.tmp`)
    await vscode.workspace.fs.createDirectory(dir)
    await vscode.workspace.fs.writeFile(stage, Buffer.from(`${JSON.stringify(items, null, 2)}\n`, "utf8"))
    await vscode.workspace.fs.rename(stage, this.file(), { overwrite: true })
  }

  private file() {
    return vscode.Uri.joinPath(this.context.globalStorageUri, "marketplace", "local-imports.json")
  }

  private async locked<T>(run: () => Promise<T>): Promise<T> {
    const dir = path.join(this.context.globalStorageUri.fsPath, "marketplace")
    const file = path.join(dir, "local-imports.lock")
    await fs.mkdir(dir, { recursive: true })
    const handle = await fs.open(file, "wx").catch(async (err: unknown) => {
      if ((err as { code?: string }).code !== "EEXIST") throw err
      const owner = await fs.readFile(file, "utf8").then(
        (value) => JSON.parse(value) as { pid?: number },
        () => ({ pid: undefined } as { pid?: number }),
      )
      if (owner.pid && alive(owner.pid)) throw err
      const age = Date.now() - (await fs.stat(file)).mtimeMs
      if (!owner.pid && age < LOCK_STALE) throw err
      await fs.rm(file, { force: true })
      return fs.open(file, "wx")
    })
    try {
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`)
      await handle.sync()
      return await run()
    } finally {
      await handle.close()
      await fs.rm(file, { force: true })
    }
  }
}

function key(skillId: string, scope: "global" | "project", workspaceId?: string) {
  return `${scope}|${workspaceId ?? ""}|${skillId}`
}

function equal(left: LocalSkillRecord | undefined, right: LocalSkillRecord | undefined) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
