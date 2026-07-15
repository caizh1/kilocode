import { createHash, randomUUID } from "crypto"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import type { LocalSkillRecord } from "./types"

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
    const items = await this.read()
    items[key(item.skillId, item.scope, item.workspaceId)] = item
    await this.write(items)
  }

  async remove(skillId: string, scope: "global" | "project", workspaceId?: string) {
    const items = await this.read()
    delete items[key(skillId, scope, workspaceId)]
    await this.write(items)
  }

  async reconcile(project?: string) {
    const items = await this.read()
    const workspaceId = this.workspaceId(project)
    const stale: string[] = []
    for (const [id, item] of Object.entries(items)) {
      if (item.scope === "project" && (!project || item.workspaceId !== workspaceId)) continue
      const root =
        item.scope === "global" ? path.join(os.homedir(), ".kilo", "skills") : path.join(project!, ".kilo", "skills")
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
      console.warn("[Kilo New] Local Skill import metadata read failed:", err)
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
}

function key(skillId: string, scope: "global" | "project", workspaceId?: string) {
  return `${scope}|${workspaceId ?? ""}|${skillId}`
}
