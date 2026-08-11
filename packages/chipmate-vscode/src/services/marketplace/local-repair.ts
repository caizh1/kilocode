import { createHash, randomUUID } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import type { PublicationPatchFile } from "./types"

export interface LocalRepairChange {
  path: string
  before: string
  after: string
}

export async function applyLocalRepairs(root: string, files: PublicationPatchFile[]) {
  const changes = await planLocalRepairs(root, files)
  if (changes.length === 0) return false
  for (const change of changes) {
    const left = await vscode.workspace.openTextDocument({ language: language(change.path), content: change.before })
    const right = await vscode.workspace.openTextDocument({ language: language(change.path), content: change.after })
    await vscode.commands.executeCommand("vscode.diff", left.uri, right.uri, `${path.basename(root)} · ${change.path}`)
  }
  const answer = await vscode.window.showWarningMessage(
    `已打开 ${changes.length} 个确定性修复 diff。确认后才会写入本地 Skill。`,
    { modal: true },
    "确认应用到本地",
  )
  if (answer !== "确认应用到本地") return false
  for (const change of changes) {
    const target = path.join(root, change.path)
    const stage = `${target}.chipmate-${randomUUID()}.tmp`
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(stage, change.after, "utf8")
    await fs.rename(stage, target)
  }
  return true
}

export async function planLocalRepairs(root: string, files: PublicationPatchFile[]): Promise<LocalRepairChange[]> {
  const base = path.resolve(root)
  const changes: LocalRepairChange[] = []
  for (const file of files) {
    if (!safe(file.path) || !file.patch.startsWith("replace-base64:")) continue
    const target = path.resolve(base, file.path)
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) continue
    const before = await fs.readFile(target, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return ""
      throw err
    })
    const hash = before ? createHash("sha256").update(before).digest("hex") : "0".repeat(64)
    if (hash !== file.beforeSha256) continue
    const after = Buffer.from(file.patch.slice("replace-base64:".length), "base64").toString("utf8")
    if (createHash("sha256").update(after).digest("hex") !== file.afterSha256 || before === after) continue
    changes.push({ path: file.path, before, after })
  }
  return changes
}

function safe(value: string) {
  return Boolean(
    value &&
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every((part) => part && part !== "." && part !== ".."),
  )
}

function language(value: string) {
  if (/\.md$/i.test(value)) return "markdown"
  if (/\.json$/i.test(value)) return "json"
  return "plaintext"
}
