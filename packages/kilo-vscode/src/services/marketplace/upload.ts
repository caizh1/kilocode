import * as fs from "fs/promises"
import * as path from "path"
import { parse as parseYaml } from "yaml"
import type { MarketplaceUploadPayload, MarketplaceUploadFile } from "./types"

const ALLOWED_DIRS = new Set(["references", "scripts", "assets", "templates", "examples", "tasks"])
const MAX_FILES = 500
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024

interface SkillMetadata {
  id?: string
  name?: string
  description?: string
  category?: string
}

export interface MarketplaceBuiltinSkill {
  name: string
  description?: string
  content: string
}

export async function buildMarketplaceSkillUploadPayload(sourcePath: string): Promise<MarketplaceUploadPayload> {
  const source = path.resolve(sourcePath)
  const stat = await fs.lstat(source)
  if (stat.isSymbolicLink()) throw new Error("Skill source cannot be a symlink")

  const root = stat.isDirectory() ? source : path.dirname(source)
  const skillMdPath = stat.isDirectory() ? path.join(root, "SKILL.md") : source
  if (path.basename(skillMdPath) !== "SKILL.md") throw new Error("Select a skill directory or its SKILL.md")

  const skillMd = await readUtf8(skillMdPath)
  const skillJson = await readSkillJson(path.join(root, "skill.json"))
  const frontmatter = readFrontmatter(skillMd)
  const fallbackName = titleCase(path.basename(root))
  const name = stringValue(skillJson.name) || stringValue(frontmatter.name) || stringValue(frontmatter.title) || fallbackName
  const id = sanitizeId(stringValue(skillJson.id) || stringValue(frontmatter.id) || name || path.basename(root))
  const description =
    stringValue(skillJson.description) ||
    stringValue(frontmatter.description) ||
    firstMeaningfulLine(skillMd) ||
    `${name} skill`
  const category = stringValue(skillJson.category) || stringValue(frontmatter.category) || "general"

  const files: MarketplaceUploadFile[] = []
  const counters = { files: 0, bytes: 0 }
  await addFile(root, "SKILL.md", files, counters)
  await addOptionalFile(root, "skill.json", files, counters)

  for (const dir of ALLOWED_DIRS) {
    await addDirectory(root, dir, files, counters)
  }

  return { id, name, description, category, files }
}

export function buildMarketplaceBuiltinSkillUploadPayload(skill: MarketplaceBuiltinSkill): MarketplaceUploadPayload {
  const content = skill.content
  if (!content.trim()) throw new Error("Built-in Skill content is empty")

  const bytes = Buffer.byteLength(content)
  if (bytes > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES) throw new Error("Built-in Skill upload is too large")

  const frontmatter = readFrontmatter(content)
  const name = skill.name.trim()
  if (!name) throw new Error("Built-in Skill name is empty")
  const description = skill.description?.trim() || firstMeaningfulLine(content) || `${name} skill`
  const category = stringValue(frontmatter.category) || "general"

  return {
    id: sanitizeId(name),
    name,
    description,
    category,
    files: [{ path: "SKILL.md", contentBase64: Buffer.from(content).toString("base64"), sizeBytes: bytes }],
  }
}

async function addDirectory(
  root: string,
  relDir: string,
  files: MarketplaceUploadFile[],
  counters: { files: number; bytes: number },
): Promise<void> {
  const abs = path.join(root, relDir)
  let entries: Array<import("fs").Dirent>
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return
    throw err
  }
  for (const entry of entries) {
    const rel = path.posix.join(relDir, entry.name)
    if (!isSafeRelativePath(rel)) throw new Error(`Unsafe skill file path: ${rel}`)
    const childAbs = path.join(root, rel)
    const stat = await fs.lstat(childAbs)
    if (stat.isSymbolicLink()) throw new Error(`Skill file cannot be a symlink: ${rel}`)
    if (stat.isDirectory()) {
      await addDirectory(root, rel, files, counters)
    } else if (stat.isFile()) {
      await addFile(root, rel, files, counters)
    }
  }
}

async function addOptionalFile(
  root: string,
  rel: string,
  files: MarketplaceUploadFile[],
  counters: { files: number; bytes: number },
): Promise<void> {
  try {
    await addFile(root, rel, files, counters)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
}

async function addFile(
  root: string,
  rel: string,
  files: MarketplaceUploadFile[],
  counters: { files: number; bytes: number },
): Promise<void> {
  if (!isSafeRelativePath(rel)) throw new Error(`Unsafe skill file path: ${rel}`)
  const abs = path.join(root, rel)
  const stat = await fs.lstat(abs)
  if (stat.isSymbolicLink()) throw new Error(`Skill file cannot be a symlink: ${rel}`)
  if (!stat.isFile()) throw new Error(`Skill path is not a file: ${rel}`)
  if (stat.size > MAX_FILE_BYTES) throw new Error(`Skill file is too large: ${rel}`)
  if (counters.files + 1 > MAX_FILES) throw new Error("Skill has too many files")
  if (counters.bytes + stat.size > MAX_TOTAL_BYTES) throw new Error("Skill upload is too large")

  const content = await fs.readFile(abs)
  files.push({ path: rel, contentBase64: content.toString("base64"), sizeBytes: stat.size })
  counters.files += 1
  counters.bytes += stat.size
}

async function readUtf8(file: string): Promise<string> {
  return await fs.readFile(file, "utf-8")
}

async function readSkillJson(file: string): Promise<SkillMetadata> {
  try {
    return JSON.parse(await readUtf8(file)) as SkillMetadata
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw new Error("skill.json is not valid JSON")
  }
}

function readFrontmatter(markdown: string): Record<string, unknown> {
  if (!markdown.startsWith("---")) return {}
  const end = markdown.indexOf("\n---", 3)
  if (end < 0) return {}
  const parsed = parseYaml(markdown.slice(3, end))
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function firstMeaningfulLine(markdown: string): string | undefined {
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.replace(/^#+\s*/, "").trim()
    if (trimmed && trimmed !== "---" && !trimmed.includes(":")) return trimmed
  }
  return undefined
}

function sanitizeId(value: string): string {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!id) throw new Error("Skill id is empty")
  return id
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function isSafeRelativePath(value: string): boolean {
  if (!value || path.isAbsolute(value) || value.includes("\\")) return false
  const normalized = path.posix.normalize(value)
  return normalized === value && !normalized.startsWith("../") && normalized !== ".."
}
