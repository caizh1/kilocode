import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { validateSkillIdentity } from "@opencode-ai/core/chipmate/skill-identity"
import { readPortableMetadata } from "@chipmate/skill-spec"

export type SkillScope = "global" | "project"

export interface SkillInstance {
  instanceId: string
  id: string
  name: string
  description?: string
  scope: SkillScope
  root: string
  location: string
  sha256: string
  effective: boolean
  shadowedBy?: string
}

export interface SkillInstances {
  items: SkillInstance[]
  errors: string[]
}

export function reconcileSkillInstances(
  items: readonly SkillInstance[],
  skills: readonly { name: string; location: string }[] | undefined,
): SkillInstance[] {
  if (!skills) return [...items]
  const active = new Set(
    skills
      .filter((item) => item.location !== "builtin" && item.location !== "<built-in>")
      .map((item) => path.resolve(item.location)),
  )
  return items
    .map((item) => {
      const effective = active.has(path.resolve(item.location))
      const result: SkillInstance = {
        ...item,
        effective,
      }
      if (effective) {
        delete result.shadowedBy
        return result
      }
      if (item.scope === "global") result.shadowedBy = `project:${item.id}`
      return result
    })
    .toSorted(
      (a, b) => Number(b.effective) - Number(a.effective) || a.id.localeCompare(b.id) || b.scope.localeCompare(a.scope),
    )
}

export async function listSkillInstances(input: { global: string; project?: string }): Promise<SkillInstances> {
  const global = await scan(input.global, "global")
  const project = input.project ? await scan(input.project, "project") : { items: [], errors: [] }
  const local = new Set(project.items.map((item) => item.id))
  const items = [...project.items, ...global.items].map((item) => {
    const effective = item.scope === "project" || !local.has(item.id)
    return {
      ...item,
      effective,
      ...(!effective ? { shadowedBy: `project:${item.id}` } : {}),
    }
  })
  return {
    items: items.toSorted(
      (a, b) => Number(b.effective) - Number(a.effective) || a.id.localeCompare(b.id) || b.scope.localeCompare(a.scope),
    ),
    errors: [...project.errors, ...global.errors],
  }
}

export async function findSkillInstance(
  input: { global: string; project?: string },
  instanceId: string,
): Promise<SkillInstance | undefined> {
  const found = await listSkillInstances(input)
  return found.items.find((item) => item.instanceId === instanceId)
}

async function scan(root: string, scope: SkillScope): Promise<SkillInstances> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return []
    throw err
  })
  const items: SkillInstance[] = []
  const errors: string[] = []
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue
    const dir = path.join(root, entry.name)
    try {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Skill root must be a regular directory")
      const location = path.join(dir, "SKILL.md")
      const stat = await fs.lstat(location)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("SKILL.md must be a regular file")
      const content = await fs.readFile(location, "utf8")
      const metadata = readPortableMetadata(content)
      if (!metadata.name) throw new Error("SKILL.md frontmatter must contain name")
      const metadataId = await marketId(dir)
      const identity = validateSkillIdentity({ name: metadata.name, directory: entry.name, metadataId })
      if (!identity.valid) throw new Error(identity.message)
      items.push({
        instanceId: `${scope}:${identity.id}`,
        id: identity.id,
        name: identity.id,
        ...(metadata.description ? { description: metadata.description } : {}),
        scope,
        root: dir,
        location,
        sha256: await digest(dir),
        effective: true,
      })
    } catch (err) {
      errors.push(`忽略无效 Skill ${dir}：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { items, errors }
}

async function marketId(root: string): Promise<string | undefined> {
  const file = path.join(root, "skill.json")
  const stat = await fs.lstat(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
  if (!stat) return undefined
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("skill.json must be a regular file")
  const content = await fs.readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
  if (content === undefined) return undefined
  const value = JSON.parse(content) as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("skill.json must be an object")
  const id = (value as { id?: unknown }).id
  if (id === undefined) return undefined
  if (typeof id !== "string") throw new Error("skill.json id must be a string")
  return id
}

async function digest(root: string): Promise<string> {
  const hash = createHash("sha256")
  const visit = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? path.posix.join(prefix, entry.name) : entry.name
      const file = path.join(dir, entry.name)
      const stat = await fs.lstat(file)
      if (stat.isSymbolicLink()) throw new Error(`Skill contains a symbolic link: ${relative}`)
      if (stat.isDirectory()) {
        await visit(file, relative)
        continue
      }
      if (!stat.isFile()) throw new Error(`Skill contains an unsupported entry: ${relative}`)
      hash.update(relative.normalize("NFC"))
      hash.update("\0")
      hash.update(await fs.readFile(file))
      hash.update("\0")
    }
  }
  await visit(root, "")
  return hash.digest("hex")
}
