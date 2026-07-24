import path from "path"
import { lstat, readFile } from "fs/promises"
import { validateSkillIdentity } from "@opencode-ai/core/kilocode/skill-identity"

export async function validateInstalledSkill(location: string, name: string) {
  const dir = path.dirname(location)
  const file = path.join(dir, "skill.json")
  const root = await lstat(dir)
  const manifest = await lstat(location)
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Skill root must be a regular directory")
  if (!manifest.isFile() || manifest.isSymbolicLink()) throw new Error("SKILL.md must be a regular file")
  const stat = await lstat(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("skill.json must be a regular file")
  const content = await readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
  const id = (() => {
    if (content === undefined) return undefined
    const value = JSON.parse(content) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("skill.json must be an object")
    const id = (value as { id?: unknown }).id
    if (id === undefined) return undefined
    if (typeof id !== "string") throw new Error("skill.json id must be a string")
    return id
  })()
  return validateSkillIdentity({ name, directory: path.basename(dir), metadataId: id })
}
