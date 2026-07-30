import { createHash } from "node:crypto"
import JSZip from "jszip"

export type RuleLevel = "MUST" | "SHOULD" | "ADVICE"
export type RuleCheck = "mechanical" | "semantic"

export interface ReviewRule {
  id: string
  revision: number
  level: RuleLevel
  title: string
  description: string
  appliesTo: string[]
  languages: Array<"c" | "cpp">
  exceptions: string[]
  check: RuleCheck
  contentHash: string
}

export interface ReviewRulePack {
  schemaVersion: 1
  version: string
  status: "DRAFT" | "PUBLISHED" | "RETIRED"
  contentHash: string
  sourceHash: string
  publishedAt?: string
  rules: ReviewRule[]
}

const mechanical = new Set(["C-011", "C-014", "C-015", "C-018", "C-035", "C-038"])
const MAX_DOCUMENT_XML_BYTES = 16 * 1024 * 1024
const labels = new Set([
  "强制级别",
  "适用范围",
  "规则说明",
  "推荐写法",
  "不推荐写法",
  "理由",
  "例外情况",
  "团队落地建议",
  "技术复核",
  "来源依据",
  "来源状态",
  "示例与说明",
  "返回规则速查",
])

export class RulePackValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RulePackValidationError"
  }
}

export async function parseRulePack(input: Buffer, version: string): Promise<ReviewRulePack> {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new RulePackValidationError("RulePack version must be a valid semantic version.")
  }
  const zip = await JSZip.loadAsync(input).catch((err: unknown) => {
    throw new RulePackValidationError(`DOCX archive is invalid: ${message(err)}`)
  })
  const entry = zip.file("word/document.xml")
  if (!entry || !zip.file("[Content_Types].xml")) {
    throw new RulePackValidationError("The upload is not a valid DOCX package.")
  }
  if (uncompressed(entry) > MAX_DOCUMENT_XML_BYTES) {
    throw new RulePackValidationError("DOCX word/document.xml exceeds the 16 MiB safety limit.")
  }
  const xml = await entry.async("string")
  if (Buffer.byteLength(xml) > MAX_DOCUMENT_XML_BYTES) {
    throw new RulePackValidationError("DOCX word/document.xml exceeds the 16 MiB safety limit.")
  }
  const paragraphs = text(xml)
  const starts = paragraphs.flatMap((paragraph, index) => {
    const previous = paragraphs[index - 1]
    if (!/^(C-\d{3})\s+.+$/.test(paragraph.text)) return []
    if (paragraph.style === "Heading3" || previous?.text === "返回规则速查") return [index]
    return []
  })
  const rules: ReviewRule[] = []
  for (const [offset, index] of starts.entries()) {
    const current = paragraphs[index]
    if (!current) continue
    const match = current.text.match(/^(C-\d{3})\s+(.+)$/)
    if (!match) continue
    const id = match[1]
    const title = match[2]
    if (!id || !title) continue
    const end = starts[offset + 1] ?? paragraphs.length
    const card = paragraphs.slice(index + 1, end).map((paragraph) => paragraph.text)
    const level = parseLevel(field(card, "强制级别"))
    const description = field(card, "规则说明")
    const appliesTo = list(field(card, "适用范围"))
    const exceptions = list(field(card, "例外情况"))
    if (!description) throw new RulePackValidationError(`${id} is missing 规则说明.`)
    const draft = {
      id,
      revision: 1,
      level,
      title: title.trim(),
      description,
      appliesTo,
      languages: ["c"] as Array<"c" | "cpp">,
      exceptions,
      check: mechanical.has(id) && exceptions.length === 0 ? ("mechanical" as const) : ("semantic" as const),
    }
    rules.push({ ...draft, contentHash: hash(stable(draft)) })
  }
  if (!rules.length) throw new RulePackValidationError("No detailed C-xxx rule cards were found in the DOCX.")
  const ids = new Set<string>()
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new RulePackValidationError(`Duplicate rule ID: ${rule.id}.`)
    ids.add(rule.id)
  }
  const sourceHash = hash(input)
  const contentHash = hash(stable({ version, rules }))
  return {
    schemaVersion: 1,
    version,
    status: "DRAFT",
    contentHash,
    sourceHash,
    rules,
  }
}

function text(xml: string) {
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((match) => ({
      text: [...match[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:tab|br)\b[^>]*\/>/g)]
        .map((part) => (part[1] === undefined ? " " : entities(part[1])))
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
      style: match[0].match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1],
    }))
    .filter((paragraph) => paragraph.text)
}

function field(card: string[], label: string) {
  const start = card.indexOf(label)
  if (start === -1) return ""
  const values: string[] = []
  for (let index = start + 1; index < card.length; index++) {
    const value = card[index]
    if (!value || labels.has(value)) break
    values.push(value)
  }
  return values.join(" ").trim()
}

function parseLevel(value: string): RuleLevel {
  if (value === "必须") return "MUST"
  if (value === "应该") return "SHOULD"
  if (value === "建议") return "ADVICE"
  throw new RulePackValidationError(`Unsupported rule level: ${value || "<missing>"}.`)
}

function list(value: string) {
  if (!value || value === "无。" || value === "无") return []
  return value
    .split(/[；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function entities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`
}

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function uncompressed(entry: JSZip.JSZipObject) {
  const value = entry as unknown as { _data?: { uncompressedSize?: unknown } }
  const size = value._data?.uncompressedSize
  return typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? size : 0
}
