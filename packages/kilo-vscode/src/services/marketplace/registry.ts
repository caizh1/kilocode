import { createHash, randomUUID } from "crypto"
import * as vscode from "vscode"

const CLIENT = "chipmate.marketplace.clientId"

export interface InstallMetadata {
  origin: string
  skillId: string
  revision: number
  sha256: string
  scope: "global" | "project"
  clientId: string
  workspaceId?: string
  changedAt: string
}

export class InstallRegistry {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async clientId(): Promise<string> {
    const saved = this.context.globalState.get<string>(CLIENT)
    if (saved) return saved
    const id = `client-${randomUUID()}`
    await this.context.globalState.update(CLIENT, id)
    return id
  }

  workspaceId(dir: string | undefined) {
    if (!dir) return undefined
    return `workspace-${createHash("sha256").update(dir).digest("hex").slice(0, 40)}`
  }

  async get(origin: string, skillId: string, scope: "global" | "project", workspaceId?: string) {
    const items = await this.read()
    return items[key(origin, skillId, scope, workspaceId)]
  }

  async list(origin: string) {
    return Object.values(await this.read()).filter((item) => item.origin === origin)
  }

  async put(item: InstallMetadata) {
    const items = await this.read()
    items[key(item.origin, item.skillId, item.scope, item.workspaceId)] = item
    await this.write(items)
  }

  async remove(origin: string, skillId: string, scope: "global" | "project", workspaceId?: string) {
    const items = await this.read()
    delete items[key(origin, skillId, scope, workspaceId)]
    await this.write(items)
  }

  private async read(): Promise<Record<string, InstallMetadata>> {
    const uri = this.file()
    try {
      const bytes = await vscode.workspace.fs.readFile(uri)
      const value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, InstallMetadata>)
        : {}
    } catch (err) {
      if ((err as { code?: string }).code === "FileNotFound") return {}
      console.warn("[Kilo New] Marketplace installation metadata read failed:", err)
      return {}
    }
  }

  private async write(items: Record<string, InstallMetadata>) {
    const dir = vscode.Uri.joinPath(this.context.globalStorageUri, "marketplace")
    const file = this.file()
    const stage = vscode.Uri.joinPath(dir, `installations-${randomUUID()}.tmp`)
    await vscode.workspace.fs.createDirectory(dir)
    await vscode.workspace.fs.writeFile(stage, Buffer.from(`${JSON.stringify(items, null, 2)}\n`, "utf8"))
    await vscode.workspace.fs.rename(stage, file, { overwrite: true })
  }

  private file() {
    return vscode.Uri.joinPath(this.context.globalStorageUri, "marketplace", "installations.json")
  }
}

function key(origin: string, skillId: string, scope: "global" | "project", workspaceId?: string) {
  return `${origin}|${scope}|${workspaceId ?? ""}|${skillId}`
}
