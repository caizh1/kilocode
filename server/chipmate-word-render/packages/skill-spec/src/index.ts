import { createHash } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"
import { parseDocument, YAMLMap } from "yaml"
import { parseZip } from "./zip.ts"

export const SKILL_SPEC_VERSION = "agent-skills-1"
export const SKILL_RISK_POLICY_VERSION = "skill-risk-v2"
export const SKILL_ROOT_FILE = "SKILL.md"
export const SKILL_METADATA_FILE = "skill.json"
export const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
export const SKILL_IGNORES = [".DS_Store", ".git", "__MACOSX", "node_modules", "Thumbs.db"] as const
export const SKILL_LIMITS = {
  files: 500,
  fileBytes: 10 * 1024 * 1024,
  uploadBytes: 50 * 1024 * 1024,
  extractedBytes: 100 * 1024 * 1024,
  pathBytes: 1024,
} as const
export const DETERMINISTIC_REPAIRS = [
  { code: "skill-filename", target: "path", semantic: false },
  { code: "frontmatter-normalize", target: "SKILL.md", semantic: false },
  { code: "metadata-normalize", target: "frontmatter", semantic: false },
  { code: "skill-json-create", target: "skill.json", semantic: false },
  { code: "ignored-files-remove", target: "snapshot", semantic: false },
] as const

export interface SkillSpec {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
}

export interface SkillIssue {
  code: string
  severity: "info" | "warning" | "error"
  file?: string
  line?: number
  field?: string
  message: string
  expected?: string
  actual?: string
  fixable: boolean
  repairKind: "none" | "deterministic" | "ai"
  riskLevel: "none" | "medium" | "critical"
}

export interface SkillRiskSummary {
  level: "none" | "medium" | "critical"
  issueCount: number
  policyVersion: string
}

export interface SnapshotChange {
  path: string
  beforeSha256: string
  afterSha256: string
  patch: string
}

export interface SkillSnapshot {
  spec: SkillSpec
  semver?: string
  archive: Buffer
  sourceSha256: string
  snapshotSha256: string
  changed: boolean
  valid: boolean
  stage: "format" | "deterministic" | "security" | "semantic" | "complete"
  issues: SkillIssue[]
  risk: SkillRiskSummary
  policyVersion: string
  changes: SnapshotChange[]
}

export interface SkillPatchInput {
  path: string
  beforeSha256: string
  afterSha256: string
  patch: string
}

export interface SkillInputFile {
  path: string
  data: Buffer
  mode?: number
}

interface Entry extends SkillInputFile {
  mode: number
}

export interface PortableMetadata {
  name?: string
  description?: string
  fields: Record<string, unknown>
  body: string
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const TEXT =
  /\.(?:md|txt|json|ya?ml|toml|ini|cfg|conf|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|cc|cpp|cxx|h|hh|hpp|hxx|sh|bash|zsh|ps1|sql|css|html?)$/i
const IMAGE = /\.(?:png|jpe?g|webp)$/i
const DOCUMENT = /\.(?:pdf|docx|xlsx|pptx)$/i
const OOXML = /\.(?:docx|xlsx|pptx)$/i
const ARCHIVE = /\.(?:zip|tar|tgz|gz|bz2|xz|7z|rar)$/i
const BINARY = /\.(?:exe|dll|dylib|so|bin|class|jar|wasm|node)$/i
const SECRET = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
]

export function validateSkillArchive(input: Buffer): SkillSnapshot {
  const sourceSha256 = sha(input)
  const issues: SkillIssue[] = []
  if (input.length > SKILL_LIMITS.uploadBytes) throw new Error("skill upload exceeds compressed size limit")
  const parsed = parse(input, issues)
  const files = normalize(parsed, issues)
  const before = new Map(files.map((file) => [file.path, sha(file.data)]))
  const candidate = files.find((file) => file.path.toLocaleLowerCase() === "skill.md")
  if (!candidate) {
    issues.push(issue("skill-file-missing", "error", "SKILL.md is required at the skill root.", { file: "SKILL.md" }))
  } else if (candidate.path !== SKILL_ROOT_FILE) {
    candidate.path = SKILL_ROOT_FILE
    issues.push(
      issue("skill-filename", "warning", "Renamed the root skill file to SKILL.md.", {
        file: candidate.path,
        fixable: true,
      }),
    )
  }

  const json = files.find((file) => file.path === SKILL_METADATA_FILE)
  const metadata = json ? readJson(json, issues) : {}
  const markdown = candidate ? decode(candidate, issues) : ""
  const source = frontmatter(markdown)
  const root = parsed[0]?.path.split("/")[0] ?? "skill"
  const id = slug(clean(metadata.id) || clean(source.fields.id) || root || clean(source.fields.name) || "skill")
  const sourceName = clean(source.fields.name)
  const sourceDescription = clean(source.fields.description)
  const name = slug(sourceName || title(id))
  const description = sourceDescription || bodyDescription(source.body) || "Reusable ChipMate skill."
  const category = slug(clean(metadata.category) || clean(source.fields.category) || "general")
  const tags = tagList(metadata.tags ?? source.fields.tags)
  const spec = { id, name, description, category, tags }
  if (!SKILL_ID_PATTERN.test(id))
    issues.push(issue("invalid-id", "error", "Skill id is invalid.", { field: "id", actual: id }))
  const semver = clean(metadata.semver) || clean(source.fields.semver) || clean(source.fields.version)
  if (semver && !SEMVER.test(semver))
    issues.push(issue("invalid-semver", "error", "SemVer is invalid.", { field: "semver", actual: semver }))

  if (candidate) {
    const repair = sourceName !== spec.name || sourceDescription !== spec.description
    if (repair)
      issues.push(
        issue("frontmatter-normalize", "warning", "Repaired portable name and description fields.", {
          file: SKILL_ROOT_FILE,
          fixable: true,
        }),
      )
    if (repair) candidate.data = Buffer.from(repairPortableMetadata(markdown, spec))
  }
  if (source.body.replace(/[#\s]/g, "").length < 8) {
    issues.push(
      issue("semantic-body-too-short", "error", "Skill instructions are too short to be actionable.", {
        file: SKILL_ROOT_FILE,
        repairKind: "ai",
      }),
    )
  }
  const market: Record<string, unknown> = {
    ...metadata,
    id: spec.id,
    category: spec.category,
    tags: spec.tags,
    ...(semver ? { semver } : {}),
  }
  delete market.name
  delete market.description
  const normalizedMetadata = Buffer.from(`${JSON.stringify(market, null, 2)}\n`)
  if (json) json.data = normalizedMetadata
  else {
    files.push({ path: SKILL_METADATA_FILE, data: normalizedMetadata, mode: 0o644 })
    issues.push(
      issue("skill-json-create", "warning", "Generated missing skill.json.", {
        file: SKILL_METADATA_FILE,
        fixable: true,
      }),
    )
  }

  scan(files, issues)
  const archive = pack(id, files)
  const snapshotSha256 = sha(archive)
  const changes = files.flatMap((file) => {
    const afterSha256 = sha(file.data)
    const beforeSha256 = before.get(file.path) ?? "0".repeat(64)
    if (beforeSha256 === afterSha256) return []
    return [{ path: file.path, beforeSha256, afterSha256, patch: `replace-base64:${file.data.toString("base64")}` }]
  })
  const valid = !issues.some((item) => item.severity === "error")
  const critical = issues.filter((item) => item.riskLevel === "critical").length
  const medium = issues.filter((item) => item.riskLevel === "medium").length
  const risk: SkillRiskSummary = {
    level: critical ? "critical" : medium ? "medium" : "none",
    issueCount: critical + medium,
    policyVersion: SKILL_RISK_POLICY_VERSION,
  }
  const stage = valid
    ? "complete"
    : critical
      ? "security"
      : issues.some((item) => item.repairKind === "ai")
        ? "semantic"
        : "format"
  return {
    spec,
    ...(semver ? { semver } : {}),
    archive,
    sourceSha256,
    snapshotSha256,
    changed: changes.length > 0,
    valid,
    stage,
    issues,
    risk,
    policyVersion: SKILL_RISK_POLICY_VERSION,
    changes,
  }
}

export function createCanonicalArchive(id: string, input: SkillInputFile[]) {
  if (!SKILL_ID_PATTERN.test(id)) throw new Error("Invalid Skill id")
  if (input.length > SKILL_LIMITS.files) throw new Error("Skill has too many files")
  const seen = new Set<string>()
  let total = 0
  const files = input.map((file) => {
    if (!safePath(file.path)) throw new Error(`Unsafe Skill path: ${file.path}`)
    const key = file.path.normalize("NFC").toLocaleLowerCase()
    if (seen.has(key)) throw new Error(`Duplicate or case-colliding Skill path: ${file.path}`)
    seen.add(key)
    if (file.data.length > SKILL_LIMITS.fileBytes) throw new Error(`Skill file is too large: ${file.path}`)
    total += file.data.length
    if (total > SKILL_LIMITS.extractedBytes) throw new Error("Skill exceeds extracted size limit")
    return {
      path: file.path,
      data: Buffer.from(file.data),
      mode: file.mode ?? (file.path.startsWith("scripts/") ? 0o755 : 0o644),
    }
  })
  return pack(id, files)
}

export function validateSkillFiles(id: string, files: SkillInputFile[]) {
  return validateSkillArchive(createCanonicalArchive(id, files))
}

export function readSkillArchive(input: Buffer) {
  const issues: SkillIssue[] = []
  const files = normalize(parse(input, issues), issues)
  const error = issues.find((item) => item.severity === "error")
  if (error) throw new Error(error.message)
  return files.map((file) => ({ ...file, data: Buffer.from(file.data) }))
}

export function readPortableMetadata(markdown: string): PortableMetadata {
  const source = frontmatter(markdown)
  return {
    ...(clean(source.fields.name) ? { name: clean(source.fields.name) } : {}),
    ...(clean(source.fields.description) ? { description: clean(source.fields.description) } : {}),
    fields: source.fields,
    body: source.body,
  }
}

export function repairPortableMetadata(markdown: string, values: { name: string; description: string }) {
  const source = frontmatter(markdown)
  const doc =
    source.doc?.errors.length === 0 && source.doc.contents instanceof YAMLMap ? source.doc : parseDocument("{}")
  doc.set("name", values.name)
  doc.set("description", values.description)
  return `---\n${doc.toString().trimEnd()}\n---\n\n${source.body}`
}

export function applySkillPatches(archive: Buffer, patches: SkillPatchInput[]) {
  const issues: SkillIssue[] = []
  const parsed = parse(archive, issues)
  if (issues.some((item) => item.severity === "error")) throw new Error("snapshot archive is unsafe")
  const root = parsed[0]?.path.split("/")[0] ?? "skill"
  const files = normalize(parsed, issues)
  for (const patch of patches) {
    if (!safePath(patch.path) || !patch.patch.startsWith("replace-base64:")) throw new Error("invalid repair patch")
    const file = files.find((item) => item.path === patch.path)
    const before = file ? sha(file.data) : "0".repeat(64)
    if (before !== patch.beforeSha256) throw new Error("repair patch before hash mismatch")
    const data = Buffer.from(patch.patch.slice("replace-base64:".length), "base64")
    if (data.length > SKILL_LIMITS.fileBytes || sha(data) !== patch.afterSha256)
      throw new Error("repair patch after hash mismatch")
    if (file) file.data = data
    else files.push({ path: patch.path, data, mode: 0o644 })
  }
  return validateSkillArchive(pack(root, files))
}

function parse(input: Buffer, issues: SkillIssue[]): Entry[] {
  const raw = gunzipSync(input, { maxOutputLength: SKILL_LIMITS.extractedBytes + 1 })
  if (raw.length > SKILL_LIMITS.extractedBytes) throw new Error("skill upload exceeds extracted size limit")
  const entries: Entry[] = []
  for (let offset = 0; offset + 512 <= raw.length; ) {
    const header = raw.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const expected = octal(header.subarray(148, 156))
    const actual = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 0x20 : byte), 0)
    if (!expected || expected !== actual) {
      issues.push(issue("security-archive-header", "error", "Archive contains an invalid tar header checksum."))
      break
    }
    const name = text(header.subarray(0, 100))
    const prefix = text(header.subarray(345, 500))
    const path = prefix ? `${prefix}/${name}` : name
    const size = octal(header.subarray(124, 136))
    const mode = octal(header.subarray(100, 108)) || 0o644
    const type = String.fromCharCode(header[156] ?? 0)
    const next = offset + 512 + Math.ceil(size / 512) * 512
    if (!Number.isSafeInteger(size) || size < 0 || next > raw.length) {
      issues.push(
        issue("security-archive-truncated", "error", "Archive entry is truncated or has an invalid size.", {
          file: path,
        }),
      )
      break
    }
    if (!safePath(path.replace(/\/+$/, "")))
      issues.push(issue("security-path", "error", "Archive contains an unsafe path.", { file: path }))
    else if (type === "1" || type === "2")
      issues.push(issue("security-link", "error", "Archive links are not allowed.", { file: path }))
    else if (type === "x" || type === "g")
      issues.push(
        issue("ignored-files-remove", "warning", "Removed archive metadata from the publication snapshot.", {
          file: path,
          fixable: true,
        }),
      )
    else if ((type === "0" || type === "\0") && size <= SKILL_LIMITS.fileBytes)
      entries.push({ path, data: Buffer.from(raw.subarray(offset + 512, offset + 512 + size)), mode })
    else if ((type === "0" || type === "\0") && size > SKILL_LIMITS.fileBytes)
      issues.push(issue("security-file-size", "error", "Archive file exceeds the size limit.", { file: path }))
    else if (type !== "5")
      issues.push(issue("security-entry-type", "error", "Archive entry type is not allowed.", { file: path }))
    offset = next
  }
  if (entries.length > SKILL_LIMITS.files)
    issues.push(issue("security-file-count", "error", "Archive contains too many files."))
  return entries
}

function normalize(entries: Entry[], issues: SkillIssue[]) {
  const roots = new Set(entries.map((entry) => entry.path.split("/")[0]))
  const strip = roots.size === 1 && entries.every((entry) => entry.path.includes("/"))
  const seen = new Set<string>()
  return entries.flatMap((entry) => {
    const path = strip ? entry.path.split("/").slice(1).join("/") : entry.path
    if (!path || ignored(path)) {
      issues.push(
        issue("ignored-files-remove", "warning", "Removed an ignored file from the publication snapshot.", {
          file: path || entry.path,
          fixable: true,
        }),
      )
      return []
    }
    const key = path.normalize("NFC").toLocaleLowerCase()
    if (seen.has(key)) {
      issues.push(
        issue("security-duplicate-path", "error", "Archive contains duplicate or case-colliding paths.", {
          file: path,
        }),
      )
      return []
    }
    seen.add(key)
    return [{ ...entry, path }]
  })
}

function scan(files: Entry[], issues: SkillIssue[]) {
  for (const file of files) {
    const document = DOCUMENT.test(file.path)
    if (!OOXML.test(file.path) && (ARCHIVE.test(file.path) || archiveMagic(file.data)))
      issues.push(issue("security-nested-archive", "error", "Nested archives are not allowed.", { file: file.path }))
    if (BINARY.test(file.path) || binaryMagic(file.data))
      issues.push(
        issue("security-executable", "error", "Executable binary content is not allowed.", { file: file.path }),
      )
    if (/^scripts\//.test(file.path))
      issues.push(
        issue("scripts-present", "warning", "The package contains scripts; the service will never execute them.", {
          file: file.path,
        }),
      )
    if (
      TEXT.test(file.path) ||
      file.path === SKILL_ROOT_FILE ||
      file.path === SKILL_METADATA_FILE ||
      (!IMAGE.test(file.path) && !document && utf8(file.data))
    ) {
      const value = decode(file, issues)
      if (SECRET.some((pattern) => pattern.test(value)))
        issues.push(
          issue("security-secret", "error", "Potential credential or private key detected.", { file: file.path }),
        )
      if (
        /\.(?:md|html?|svg|xml)$/i.test(file.path) &&
        /<\/?(?:script|iframe|object|embed|form|input|style|meta|link|svg|math)\b|\bon\w+\s*=|javascript\s*:|data\s*:\s*text\/html|expression\s*\(/i.test(
          value,
        )
      ) {
        issues.push(
          issue("security-markdown-xss", "error", "Markdown contains unsafe HTML or URL content.", { file: file.path }),
        )
      }
    } else if (IMAGE.test(file.path)) scanImage(file, issues)
    else if (document) scanDocument(file, issues)
    else issues.push(issue("security-file-type", "error", "File type is not allowed.", { file: file.path }))
  }
}

function utf8(data: Buffer) {
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(data)
    return [...value].every((char) => {
      const code = char.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
    })
  } catch {
    return false
  }
}

function scanDocument(file: Entry, issues: SkillIssue[]) {
  if (/\.pdf$/i.test(file.path)) {
    scanPdf(file, issues)
    return
  }
  scanOoxml(file, issues)
}

function scanPdf(file: Entry, issues: SkillIssue[]) {
  const value = file.data.toString("latin1")
  if (!value.startsWith("%PDF-") || !/%%EOF\s*$/.test(value) || !/\bxref\b/.test(value) || !/\btrailer\b/.test(value)) {
    issues.push(
      issue("security-pdf-invalid", "error", "PDF structure is malformed or unsupported.", { file: file.path }),
    )
    return
  }
  const blocked =
    /\/(?:Encrypt|ObjStm|XRef|JavaScript|JS|Launch|EmbeddedFile|Filespec|OpenAction|AA|RichMedia|XFA|SubmitForm|GoToR|URI)\b/
  if (blocked.test(value)) {
    issues.push(
      issue("security-pdf-active-content", "error", "PDF contains encryption, compressed objects, or active content.", {
        file: file.path,
      }),
    )
  }
}

function scanOoxml(file: Entry, issues: SkillIssue[]) {
  let entries: ReturnType<typeof parseZip>
  try {
    entries = parseZip(file.data, {
      files: SKILL_LIMITS.files,
      fileBytes: SKILL_LIMITS.fileBytes,
      totalBytes: SKILL_LIMITS.extractedBytes,
      pathBytes: SKILL_LIMITS.pathBytes,
    })
  } catch (err) {
    issues.push(
      issue("security-office-invalid", "error", `Office document is malformed: ${message(err)}`, { file: file.path }),
    )
    return
  }
  const names = new Set(entries.map((entry) => entry.path.toLocaleLowerCase()))
  if (!names.has("[content_types].xml") || !names.has("_rels/.rels")) {
    issues.push(
      issue("security-office-invalid", "error", "Office document is missing required OOXML files.", {
        file: file.path,
      }),
    )
    return
  }
  const blocked = entries.find((entry) =>
    /(?:vbaproject\.bin|\/embeddings\/|\/oleobjects\/|\/activex\/|customui\/)/i.test(entry.path),
  )
  if (blocked) {
    issues.push(
      issue("security-office-active-content", "error", "Office document contains macros or embedded active content.", {
        file: `${file.path}:${blocked.path}`,
      }),
    )
  }
  for (const entry of entries.filter((item) => /\.rels$/i.test(item.path))) {
    const value = entry.data.toString("utf8")
    if (/TargetMode\s*=\s*["']External["']/i.test(value)) {
      issues.push(
        issue("security-office-external-link", "error", "Office document contains an external relationship.", {
          file: `${file.path}:${entry.path}`,
        }),
      )
    }
  }
}

function scanImage(file: Entry, issues: SkillIssue[]) {
  const dimensions = /\.png$/i.test(file.path)
    ? pngSize(file.data)
    : /\.jpe?g$/i.test(file.path)
      ? jpegSize(file.data)
      : webpSize(file.data)
  if (!dimensions) {
    issues.push(
      issue("security-image-invalid", "error", "Image bytes are malformed or do not match the file extension.", {
        file: file.path,
      }),
    )
    return
  }
  const [width, height] = dimensions
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_000_000) {
    issues.push(issue("security-image-size", "error", "Image dimensions exceed the limit.", { file: file.path }))
  }
}

function pngSize(data: Buffer): [number, number] | undefined {
  if (!data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return undefined
  const size =
    data.length >= 24 && data.readUInt32BE(8) === 13 && data.subarray(12, 16).toString() === "IHDR"
      ? ([data.readUInt32BE(16), data.readUInt32BE(20)] as [number, number])
      : undefined
  if (!size) return undefined
  for (let offset = 8; offset + 12 <= data.length; ) {
    const bytes = data.readUInt32BE(offset)
    const end = offset + 12 + bytes
    if (end > data.length) return undefined
    const type = data.subarray(offset + 4, offset + 8).toString()
    if (type === "IEND") return bytes === 0 && end === data.length ? size : undefined
    offset = end
  }
  return undefined
}

function jpegSize(data: Buffer): [number, number] | undefined {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data.at(-2) !== 0xff || data.at(-1) !== 0xd9)
    return undefined
  for (let offset = 2; offset + 4 <= data.length - 2; ) {
    if (data[offset] !== 0xff) return undefined
    while (data[offset] === 0xff) offset++
    const marker = data[offset++]
    if (marker === undefined || marker === 0xd9) break
    if (marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > data.length) return undefined
    const bytes = data.readUInt16BE(offset)
    if (bytes < 2 || offset + bytes > data.length) return undefined
    const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (frame && bytes >= 7) return [data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3)]
    offset += bytes
  }
  return undefined
}

function webpSize(data: Buffer): [number, number] | undefined {
  if (
    data.length < 20 ||
    data.subarray(0, 4).toString() !== "RIFF" ||
    data.subarray(8, 12).toString() !== "WEBP" ||
    data.readUInt32LE(4) + 8 !== data.length
  )
    return undefined
  for (let offset = 12; offset + 8 <= data.length; ) {
    const type = data.subarray(offset, offset + 4).toString()
    const bytes = data.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + bytes
    if (end > data.length) return undefined
    if (type === "VP8X" && bytes >= 10) return [data.readUIntLE(start + 4, 3) + 1, data.readUIntLE(start + 7, 3) + 1]
    if (type === "VP8 " && bytes >= 10 && data.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return [data.readUInt16LE(start + 6) & 0x3fff, data.readUInt16LE(start + 8) & 0x3fff]
    }
    if (type === "VP8L" && bytes >= 5 && data[start] === 0x2f) {
      const bits = data.readUInt32LE(start + 1)
      return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]
    }
    offset = end + (bytes % 2)
  }
  return undefined
}

function frontmatter(value: string) {
  const match = value.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!match) return { fields: {} as Record<string, unknown>, body: value, doc: undefined }
  const doc = parseDocument(match[1] ?? "")
  const fields = doc.errors.length === 0 && doc.contents ? doc.toJS() : {}
  return {
    fields: typeof fields === "object" && fields !== null ? (fields as Record<string, unknown>) : {},
    body: value.slice(match[0].length),
    doc,
  }
}

function pack(id: string, files: Entry[]) {
  const chunks: Buffer[] = []
  for (const file of files.toSorted((a, b) => a.path.localeCompare(b.path))) {
    const path = `${id}/${file.path}`
    const header = Buffer.alloc(512)
    write(header, 0, 100, path)
    write(header, 100, 8, oct(file.mode & 0o777, 7))
    write(header, 108, 8, oct(0, 7))
    write(header, 116, 8, oct(0, 7))
    write(header, 124, 12, oct(file.data.length, 11))
    write(header, 136, 12, oct(0, 11))
    header.fill(0x20, 148, 156)
    header[156] = 0x30
    write(header, 257, 6, "ustar")
    write(header, 263, 2, "00")
    write(
      header,
      148,
      8,
      `${oct(
        header.reduce((sum, byte) => sum + byte, 0),
        6,
      )}\0 `,
    )
    chunks.push(header, file.data, Buffer.alloc((512 - (file.data.length % 512)) % 512))
  }
  chunks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(chunks), { level: 9 })
}

const MEDIUM = new Set(["security-secret", "scripts-present", "security-office-external-link"])
const CRITICAL = new Set([
  "security-path",
  "security-link",
  "security-executable",
  "security-nested-archive",
  "security-markdown-xss",
  "security-office-active-content",
  "security-pdf-active-content",
])

const MESSAGES: Record<string, string> = {
  "skill-file-missing": "Skill 根目录必须包含 SKILL.md。",
  "skill-filename": "已将根目录技能文件规范化为 SKILL.md。",
  "invalid-id": "Skill ID 格式无效。",
  "invalid-semver": "语义版本格式无效。",
  "frontmatter-normalize": "已规范化名称和描述字段。",
  "skill-json-create": "已生成缺失的 skill.json。",
  "metadata-json-invalid": "skill.json 格式无效。",
  "semantic-body-too-short": "Skill 指令过短，无法形成可执行能力。",
  "ignored-files-remove": "已从发布快照中移除忽略文件或归档元数据。",
  "scripts-present": "包含脚本文件；市场服务不会执行这些脚本，使用前请自行审查。",
  "security-secret": "检测到可能的凭据、密码、令牌或密钥内容，请确认其中不包含真实敏感信息。",
  "security-office-external-link": "Office 文档包含外部链接，打开时可能访问外部资源。",
  "security-path": "归档包含不安全路径。",
  "security-link": "归档包含不允许的链接条目。",
  "security-executable": "归档包含不允许的可执行二进制内容。",
  "security-nested-archive": "归档包含无法继续安全扫描的嵌套归档。",
  "security-markdown-xss": "Markdown 包含不安全的 HTML 或 URL 内容。",
  "security-office-active-content": "Office 文档包含宏或嵌入式活动内容。",
  "security-pdf-active-content": "PDF 包含加密、压缩对象或活动内容。",
  "security-archive-header": "归档头校验失败。",
  "security-archive-truncated": "归档条目不完整或大小无效。",
  "security-duplicate-path": "归档包含重复或大小写冲突路径。",
  "security-entry-type": "归档包含不支持的条目类型。",
  "security-file-count": "归档文件数量超过限制。",
  "security-file-size": "归档内单个文件超过大小限制。",
  "security-file-type": "归档包含不支持的文件类型。",
  "security-image-invalid": "图片内容损坏或与扩展名不匹配。",
  "security-image-size": "图片尺寸超过限制。",
  "security-office-invalid": "Office 文档结构损坏或不受支持。",
  "security-pdf-invalid": "PDF 结构损坏或不受支持。",
  "security-text-encoding": "文本文件不是有效的 UTF-8。",
}

function issue(
  code: string,
  severity: SkillIssue["severity"],
  message: string,
  extra: Partial<SkillIssue> = {},
): SkillIssue {
  const riskLevel = CRITICAL.has(code) ? "critical" : MEDIUM.has(code) ? "medium" : "none"
  return {
    code,
    severity: riskLevel === "medium" ? "warning" : severity,
    message: MESSAGES[code] ?? message,
    fixable: false,
    repairKind: extra.fixable ? "deterministic" : "none",
    riskLevel,
    ...extra,
  }
}

function decode(file: Entry, issues: SkillIssue[]) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(file.data)
  } catch {
    issues.push(issue("security-text-encoding", "error", "Text file is not valid UTF-8.", { file: file.path }))
    return file.data.toString("utf8")
  }
}

function readJson(file: Entry, issues: SkillIssue[]) {
  const value = decode(file, issues)
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
  } catch (err) {
    issues.push(issue("metadata-json-invalid", "error", `skill.json is invalid: ${message(err)}`, { file: file.path }))
  }
  return {} as Record<string, unknown>
}

function safePath(path: string) {
  if (
    !path ||
    Buffer.byteLength(path) > SKILL_LIMITS.pathBytes ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\") ||
    [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return false
  return path.split("/").every((part) => part && part !== "." && part !== "..")
}

function ignored(path: string) {
  const parts = path.split("/")
  return parts.some((part) => part.startsWith("._") || (SKILL_IGNORES as readonly string[]).includes(part))
}

function binaryMagic(data: Buffer) {
  const magic = data.subarray(0, 4).toString("hex")
  return (
    magic === "7f454c46" ||
    data.subarray(0, 2).toString() === "MZ" ||
    ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "0061736d"].includes(magic)
  )
}

function archiveMagic(data: Buffer) {
  return (
    data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    data.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ||
    data.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) ||
    data.subarray(0, 7).toString() === "Rar!\u001a\u0007" ||
    data.subarray(257, 262).toString() === "ustar"
  )
}

function bodyDescription(body: string) {
  return clean(body.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith("#")) ?? "").slice(0, 240)
}

function tagList(value: unknown) {
  const raw = (
    Array.isArray(value)
      ? value.map(String)
      : String(value ?? "")
          .replace(/^\[|\]$/g, "")
          .split(",")
  )
    .map(unquote)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(slug)
  return [...new Set(raw)].slice(0, 32)
}

function slug(value: string) {
  return (
    clean(value)
      .toLocaleLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 128) || "skill"
  )
}

function title(value: string) {
  return value
    .split(/[-_.]+/)
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : ""))
    .join(" ")
}

function clean(value: unknown) {
  return unquote(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
}

function unquote(value: string) {
  const text = value.trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      return text.startsWith('"') ? String(JSON.parse(text)) : text.slice(1, -1)
    } catch {
      return text.slice(1, -1)
    }
  }
  return text
}

function sha(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function text(value: Buffer) {
  return value.toString("utf8").replace(/\0.*$/, "").trim()
}

function octal(value: Buffer) {
  return Number.parseInt(text(value).replace(/\s/g, "") || "0", 8)
}

function oct(value: number, width: number) {
  return value.toString(8).padStart(width, "0").slice(-width)
}

function write(target: Buffer, offset: number, length: number, value: string) {
  target.write(value.slice(0, length), offset, length, "utf8")
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}
