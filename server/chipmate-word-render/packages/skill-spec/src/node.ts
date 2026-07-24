import { lstat, readFile, readdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import * as path from "node:path"
import {
  SKILL_IGNORES,
  SKILL_LIMITS,
  readPortableMetadata,
  readSkillArchive,
  repairPortableMetadata,
  validateSkillFiles,
  type SkillInputFile,
  type SkillSnapshot,
} from "./index.ts"
import { parseZip } from "./zip.ts"

export type SkillSourceKind = "directory" | "skill-md" | "zip" | "tar-gz"
export type SkillFormatHint = "agent-skills" | "codex" | "claude" | "opencode"

export interface SkillMetadataRepair {
  field: "name" | "description"
  before?: string
  after: string
}

export interface SkillCandidate {
  key: string
  id: string
  name: string
  description: string
  sourceKind: SkillSourceKind
  sourceLabel: string
  sourceSha256: string
  hints: SkillFormatHint[]
  files: SkillInputFile[]
  fileCount: number
  totalBytes: number
  repairs: SkillMetadataRepair[]
  snapshot: SkillSnapshot
}

export async function discoverSkillCandidates(source: string): Promise<SkillCandidate[]> {
  const abs = path.resolve(source)
  const stat = await lstat(abs)
  if (stat.isSymbolicLink()) throw new Error("Skill source cannot be a symlink")
  const kind = sourceKind(abs, stat.isDirectory())
  const label = path.basename(abs)
  const base = stat.isDirectory() ? abs : path.dirname(abs)
  const loaded = stat.isDirectory()
    ? await collect(abs)
    : kind === "skill-md"
      ? await collect(base)
      : await archive(abs, kind)
  const files = stripWrapper(loaded)
  const skills = files
    .filter((file) => path.posix.basename(file.path).toLocaleLowerCase() === "skill.md")
    .map((file) => path.posix.dirname(file.path))
    .toSorted((a, b) => depth(a) - depth(b) || a.localeCompare(b))
  if (skills.length === 0) throw new Error("No SKILL.md was found in the selected source")

  const roots = kind === "skill-md" ? [skills.find((root) => root === ".") ?? skills[0]!] : skills
  return roots.map((root, index) => candidate(files, roots, root, index, kind, label, base))
}

function candidate(
  source: SkillInputFile[],
  roots: string[],
  root: string,
  index: number,
  kind: SkillSourceKind,
  label: string,
  base: string,
): SkillCandidate {
  const nested = roots.filter((item) => item !== root && inside(item, root))
  const files = source.flatMap((file) => {
    if (!inside(file.path, root)) return []
    const rel = relative(file.path, root)
    if (nested.some((item) => inside(file.path, item))) return []
    return [{ ...file, path: rel, mode: rel.startsWith("scripts/") ? 0o755 : 0o644 }]
  })
  const skill = files.find((file) => file.path.toLocaleLowerCase() === "skill.md")
  if (!skill) throw new Error(`Skill candidate has no root SKILL.md: ${root}`)
  skill.path = "SKILL.md"
  const sourceSha256 = fingerprint(files)
  const markdown = skill.data.toString("utf8")
  const metadata = readPortableMetadata(markdown)
  const fallback = root === "." ? path.basename(base) : path.posix.basename(root)
  const name = portable(metadata.name ?? fallback)
  const description = metadata.description?.trim() || bodyDescription(metadata.body) || `${name} reusable skill`
  const repairs: SkillMetadataRepair[] = []
  if (metadata.name !== name) repairs.push({ field: "name", ...(metadata.name ? { before: metadata.name } : {}), after: name })
  if (metadata.description !== description)
    repairs.push({
      field: "description",
      ...(metadata.description ? { before: metadata.description } : {}),
      after: description,
    })
  if (repairs.length > 0) skill.data = Buffer.from(repairPortableMetadata(markdown, { name, description }))
  alignMarketId(files, name)
  const snapshot = validateSkillFiles(name, files)
  const normalized = readSkillArchive(snapshot.archive)
  const hints = formatHints(root, metadata.fields, normalized)
  return {
    key: `${index}:${root}`,
    id: snapshot.spec.id,
    name,
    description,
    sourceKind: kind,
    sourceLabel: label,
    sourceSha256,
    hints,
    files: normalized,
    fileCount: normalized.length,
    totalBytes: normalized.reduce((sum, file) => sum + file.data.length, 0),
    repairs,
    snapshot,
  }
}

function fingerprint(files: SkillInputFile[]) {
  const hash = createHash("sha256")
  for (const file of files.toSorted((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path.normalize("NFC"))
    hash.update("\0")
    hash.update(file.data)
    hash.update("\0")
  }
  return hash.digest("hex")
}

function alignMarketId(files: SkillInputFile[], id: string) {
  const file = files.find((item) => item.path === "skill.json")
  if (!file) return
  const value = JSON.parse(file.data.toString("utf8")) as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("skill.json is not valid JSON")
  file.data = Buffer.from(`${JSON.stringify({ ...(value as Record<string, unknown>), id }, null, 2)}\n`)
}

async function collect(root: string) {
  const files: SkillInputFile[] = []
  const state = { count: 0, bytes: 0 }
  await visit(root, "", files, state)
  return files
}

async function visit(root: string, rel: string, files: SkillInputFile[], state: { count: number; bytes: number }) {
  const dir = path.join(root, rel)
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const child = rel ? path.posix.join(rel, entry.name) : entry.name
    if (ignored(child)) continue
    const abs = path.join(root, ...child.split("/"))
    const stat = await lstat(abs)
    if (stat.isSymbolicLink()) throw new Error(`Skill file cannot be a symlink: ${child}`)
    if (stat.isDirectory()) {
      await visit(root, child, files, state)
      continue
    }
    if (!stat.isFile()) throw new Error(`Skill source contains an unsupported entry: ${child}`)
    if (stat.size > SKILL_LIMITS.fileBytes) throw new Error(`Skill file is too large: ${child}`)
    state.count++
    state.bytes += stat.size
    if (state.count > SKILL_LIMITS.files) throw new Error("Skill source has too many files")
    if (state.bytes > SKILL_LIMITS.extractedBytes) throw new Error("Skill source exceeds extracted size limit")
    files.push({ path: child, data: await readFile(abs), mode: stat.mode & 0o777 })
  }
}

async function archive(file: string, kind: SkillSourceKind) {
  const data = await readFile(file)
  if (data.length > SKILL_LIMITS.uploadBytes) throw new Error("Skill archive exceeds compressed size limit")
  if (kind === "tar-gz") return readSkillArchive(data)
  return parseZip(data, {
    files: SKILL_LIMITS.files,
    fileBytes: SKILL_LIMITS.fileBytes,
    totalBytes: SKILL_LIMITS.extractedBytes,
    pathBytes: SKILL_LIMITS.pathBytes,
  })
}

function stripWrapper(files: SkillInputFile[]) {
  const roots = new Set(files.map((file) => file.path.split("/")[0]))
  if (roots.size !== 1 || files.some((file) => !file.path.includes("/"))) return files
  if ([".agents", ".claude", ".opencode"].includes([...roots][0]!)) return files
  return files.map((file) => ({ ...file, path: file.path.split("/").slice(1).join("/") }))
}

function sourceKind(file: string, directory: boolean): SkillSourceKind {
  if (directory) return "directory"
  if (path.basename(file).toLocaleLowerCase() === "skill.md") return "skill-md"
  if (/\.zip$/i.test(file)) return "zip"
  if (/\.tar\.gz$/i.test(file)) return "tar-gz"
  throw new Error("Select a Skill folder, SKILL.md, .zip, or .tar.gz")
}

function formatHints(root: string, fields: Record<string, unknown>, files: SkillInputFile[]): SkillFormatHint[] {
  const hints = new Set<SkillFormatHint>(["agent-skills"])
  const source = root.toLocaleLowerCase()
  if (source.includes(".agents") || files.some((file) => file.path.toLocaleLowerCase() === "agents/openai.yaml"))
    hints.add("codex")
  const claude = new Set([
    "when_to_use",
    "argument-hint",
    "arguments",
    "disable-model-invocation",
    "user-invocable",
    "disallowed-tools",
    "model",
    "effort",
    "context",
    "agent",
    "hooks",
  ])
  if (source.includes(".claude") || Object.keys(fields).some((key) => claude.has(key))) hints.add("claude")
  if (source.includes(".opencode")) hints.add("opencode")
  return [...hints]
}

function portable(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 64)
      .replace(/-+$/g, "") || "skill"
  )
}

function bodyDescription(body: string) {
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !line.startsWith("<!--"))
    ?.slice(0, 1_024)
}

function inside(file: string, root: string) {
  return root === "." || file === root || file.startsWith(`${root}/`)
}

function relative(file: string, root: string) {
  return root === "." ? file : file.slice(root.length + 1)
}

function depth(value: string) {
  return value === "." ? 0 : value.split("/").length
}

function ignored(value: string) {
  return value
    .split("/")
    .some((part) => part.startsWith("._") || (SKILL_IGNORES as readonly string[]).includes(part))
}
