import { createHash } from "node:crypto"
import readline from "node:readline"
import { StringDecoder } from "node:string_decoder"
import { SaxesParser, type SaxesTagPlain } from "saxes"
import type { Jurisdiction, NormalizedPatentRecord, PatentClaim } from "./contracts.js"

const PARSER_VERSION = "cnipa-st36-compatible-v3"
const RECORD_TAGS = new Set(["patentdocument", "exchangedocument", "patent", "patentdocumentandrelated"])
const MAX_FIELD = 4 * 1024 * 1024
const MAX_JSON_FILE = 64 * 1024 * 1024

export { PARSER_VERSION }

export async function* parsePatentStream(
  name: string,
  stream: NodeJS.ReadableStream,
  jurisdiction: Jurisdiction,
): AsyncGenerator<NormalizedPatentRecord> {
  if (/\.(?:jsonl|ndjson)$/i.test(name)) {
    yield* parseJsonLines(stream, jurisdiction)
    return
  }
  if (/\.json$/i.test(name)) {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_JSON_FILE) throw new Error("单个 JSON 数据文件超过 64 MiB；大批量数据必须使用 JSONL 或 XML 流格式")
      chunks.push(bytes)
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
    const rows = Array.isArray(value) ? value : [value]
    for (const row of rows) yield normalizeJson(row, jurisdiction)
    return
  }
  yield* parseXml(stream, jurisdiction)
}

async function* parseJsonLines(
  stream: NodeJS.ReadableStream,
  jurisdiction: Jurisdiction,
): AsyncGenerator<NormalizedPatentRecord> {
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    yield normalizeJson(JSON.parse(trimmed) as unknown, jurisdiction)
  }
}

function normalizeJson(value: unknown, fallback: Jurisdiction): NormalizedPatentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON 专利记录必须是对象")
  const item = value as Record<string, unknown>
  const jurisdiction = text(item.jurisdiction || item.country || fallback).toUpperCase() as Jurisdiction
  const doc = text(item.publicationNumber || item.publication_number || item.docNumber || item.doc_number)
  const kind = nullable(item.kindCode || item.kind_code || item.kind)
  const publicationNumber = normalizeNumber(jurisdiction, doc, kind)
  if (!publicationNumber) throw new Error("JSON 专利记录缺少公开号")
  const priorities = strings(item.priorities || item.priorityClaims)
  const family = nullable(item.familyId || item.family_id)
  return {
    sourceRecordId: text(item.sourceRecordId || item.source_record_id || publicationNumber),
    publicationNumber,
    applicationNumber: nullable(item.applicationNumber || item.application_number),
    jurisdiction,
    kindCode: kind,
    language: nullable(item.language || item.lang),
    title: nullable(item.title),
    abstract: nullable(item.abstract || item.abstractText || item.abstract_text),
    description: nullable(item.description || item.descriptionText || item.description_text),
    filingDate: normalizeDate(nullable(item.filingDate || item.filing_date)),
    priorityDate: normalizeDate(nullable(item.priorityDate || item.priority_date)),
    publicationDate: normalizeDate(nullable(item.publicationDate || item.publication_date)) || "",
    familyId: family || derivedFamily(priorities),
    familySource: family ? "official" : priorities.length ? "derived" : null,
    legalStatus: nullable(item.legalStatus || item.legal_status),
    legalStatusDate: normalizeDate(nullable(item.legalStatusDate || item.legal_status_date)),
    applicants: strings(item.applicants),
    inventors: strings(item.inventors),
    classifications: strings(item.classifications || item.ipc || item.cpc),
    priorities,
    citations: strings(item.citations),
    claims: claims(item.claims),
    deleted: item.deleted === true || text(item.operation).toLowerCase() === "delete",
  }
}

async function* parseXml(
  stream: NodeJS.ReadableStream,
  fallback: Jurisdiction,
): AsyncGenerator<NormalizedPatentRecord> {
  const output: NormalizedPatentRecord[] = []
  const decoder = new StringDecoder("utf8")
  let error: Error | undefined
  const parser = new SaxesParser({ xmlns: false, fragment: false })
  let current: Builder | undefined
  let depth = 0
  const stack: Array<{ name: string; attributes: Record<string, string>; text: string }> = []

  parser.on("opentag", (tag: SaxesTagPlain) => {
    const name = local(tag.name)
    if (!current && RECORD_TAGS.has(key(name))) {
      current = builder(fallback, attributes(tag))
      depth = 1
      stack.length = 0
    } else if (current) depth += 1
    if (current) stack.push({ name, attributes: attributes(tag), text: "" })
  })
  parser.on("text", (value) => {
    const node = stack[stack.length - 1]
    if (current && node && node.text.length < MAX_FIELD) node.text += value
  })
  parser.on("cdata", (value) => {
    const node = stack[stack.length - 1]
    if (current && node && node.text.length < MAX_FIELD) node.text += value
  })
  parser.on("closetag", () => {
    if (!current) return
    const node = stack.pop()
    if (node) {
      apply(
        current,
        stack.map((item) => item.name),
        node,
      )
      const parent = stack[stack.length - 1]
      if (parent && parent.text.length < MAX_FIELD) parent.text += ` ${node.text}`
    }
    depth -= 1
    if (depth === 0) {
      try {
        output.push(finish(current))
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught))
      }
      current = undefined
      stack.length = 0
    }
  })
  parser.on("error", (caught) => {
    error = caught
  })

  for await (const chunk of stream) {
    parser.write(decoder.write(Buffer.from(chunk)))
    if (error) throw error
    while (output.length) yield output.shift()!
  }
  parser.write(decoder.end())
  parser.close()
  if (error) throw error
  while (output.length) yield output.shift()!
}

interface Builder {
  jurisdiction: Jurisdiction
  root: Record<string, string>
  publication: Partial<Record<"country" | "doc-number" | "kind" | "date", string>>
  application: Partial<Record<"country" | "doc-number" | "kind" | "date", string>>
  title: string[]
  abstract: string[]
  description: string[]
  claims: PatentClaim[]
  applicants: string[]
  inventors: string[]
  classifications: string[]
  priorities: string[]
  priorityDates: string[]
  citations: string[]
  familyId?: string
  language?: string
  filingDate?: string
  legalStatus?: string
  legalStatusDate?: string
  deleted: boolean
}

function builder(jurisdiction: Jurisdiction, root: Record<string, string>): Builder {
  const country = text(root.country || root["country-code"]).toUpperCase()
  const language = nullable(root.lang || root.language)
  return {
    jurisdiction: (country || jurisdiction) as Jurisdiction,
    root,
    publication: {},
    application: {},
    title: [],
    abstract: [],
    description: [],
    claims: [],
    applicants: [],
    inventors: [],
    classifications: [],
    priorities: [],
    priorityDates: [],
    citations: [],
    ...(language ? { language } : {}),
    deleted: /delete|deleted|remove/i.test(text(root.status || root.operation)),
  }
}

function apply(
  target: Builder,
  parents: string[],
  node: { name: string; attributes: Record<string, string>; text: string },
) {
  const value = compact(node.text)
  if (!value) return
  const path = [...parents, node.name].map(key).join("/")
  const name = key(node.name)
  const inPublication = path.includes("publicationreference") || path.includes("publicationreferencedocument")
  const inApplication = path.includes("applicationreference")
  const referenceName = name === "docnumber" ? "doc-number" : name
  if (inPublication && ["country", "doc-number", "kind", "date"].includes(referenceName)) {
    target.publication[referenceName as keyof typeof target.publication] ||= value
    return
  }
  if (inApplication && ["country", "doc-number", "kind", "date"].includes(referenceName)) {
    target.application[referenceName as keyof typeof target.application] ||= value
    return
  }
  if (name === "inventiontitle" || name === "title") push(target.title, value)
  else if (path.includes("abstract") && ["p", "paragraph", "paragraphs", "text"].includes(name))
    push(target.abstract, value)
  else if (path.includes("description") && ["p", "paragraph", "paragraphs", "text"].includes(name)) {
    push(target.description, value)
  } else if (name === "claim") {
    target.claims.push({
      number: node.attributes.num || node.attributes.number || String(target.claims.length + 1),
      independent: independent(node.attributes),
      language: node.attributes.lang || target.language || null,
      text: value,
    })
  } else if (path.includes("applicant") && ["name", "orgname", "lastname"].includes(name))
    push(target.applicants, value)
  else if (path.includes("inventor") && ["name", "lastname"].includes(name)) push(target.inventors, value)
  else if (/classification(?:ipc|cpc)|mainclassification|furtherclassification/.test(path)) {
    if (["text", "classificationsymbol", "mainclassification", "furtherclassification"].includes(name)) {
      push(target.classifications, value.replace(/\s+/g, ""))
    }
  } else if (path.includes("priorityclaim") && name === "docnumber") push(target.priorities, value)
  else if (path.includes("priorityclaim") && name === "date") push(target.priorityDates, value)
  else if (path.includes("citation") && name === "docnumber") push(target.citations, value)
  else if (name === "familyid") target.familyId ||= value
  else if (name === "filingdate") target.filingDate ||= value
  else if (name === "legalstatus" || name === "legalstate") target.legalStatus ||= value
  else if (name === "legalstatusdate" || name === "eventdate") target.legalStatusDate ||= value
}

function finish(value: Builder): NormalizedPatentRecord {
  const country = (value.publication.country || value.root.country || value.jurisdiction).toUpperCase() as Jurisdiction
  const doc = value.publication["doc-number"] || value.root["doc-number"] || value.root.docnumber || value.root.id
  const kind = nullable(value.publication.kind || value.root.kind)
  const publicationNumber = normalizeNumber(country, doc, kind)
  if (!publicationNumber) throw new Error("XML 专利记录缺少公开号")
  const priorities = unique(value.priorities.map((item) => item.replace(/\s+/g, "")))
  const familyId = nullable(value.familyId) || derivedFamily(priorities)
  return {
    sourceRecordId: text(value.root.id || value.root["file-reference-id"] || value.root.docnumber || publicationNumber),
    publicationNumber,
    applicationNumber: normalizeNumber(
      (value.application.country || country).toUpperCase() as Jurisdiction,
      value.application["doc-number"],
      null,
    ),
    jurisdiction: country,
    kindCode: kind,
    language: nullable(value.language),
    title: joined(value.title),
    abstract: joined(value.abstract),
    description: joined(value.description),
    filingDate: normalizeDate(value.filingDate || value.application.date),
    priorityDate: earliest(value.priorityDates.map(normalizeDate).filter(Boolean) as string[]),
    publicationDate: normalizeDate(value.publication.date || value.root.datepublication || value.root.date) || "",
    familyId,
    familySource: value.familyId ? "official" : familyId ? "derived" : null,
    legalStatus: nullable(value.legalStatus),
    legalStatusDate: normalizeDate(value.legalStatusDate),
    applicants: unique(value.applicants),
    inventors: unique(value.inventors),
    classifications: unique(value.classifications),
    priorities,
    citations: unique(value.citations),
    claims: value.claims,
    deleted: value.deleted,
  }
}

function local(name: string): string {
  return name.split(":").pop()?.toLowerCase() || name.toLowerCase()
}

function key(name: string): string {
  return name.replace(/[-_]/g, "")
}

function attributes(tag: SaxesTagPlain): Record<string, string> {
  return Object.fromEntries(Object.entries(tag.attributes).map(([key, value]) => [local(key), String(value)]))
}

function independent(attrs: Record<string, string>): boolean | null {
  const value = text(attrs.independent || attrs.type).toLowerCase()
  if (/true|yes|independent|main/.test(value)) return true
  if (/false|no|dependent/.test(value)) return false
  return null
}

function claims(value: unknown): PatentClaim[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (typeof item === "string" && item.trim()) {
      return [{ number: String(index + 1), independent: null, language: null, text: compact(item) }]
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const claim = item as Record<string, unknown>
    const body = text(claim.text)
    if (!body) return []
    return [
      {
        number: text(claim.number || index + 1),
        independent: typeof claim.independent === "boolean" ? claim.independent : null,
        language: nullable(claim.language),
        text: compact(body),
      },
    ]
  })
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map(text).filter(Boolean))
  if (typeof value === "string") return unique(value.split(/[;,|]/).map(compact).filter(Boolean))
  return []
}

function normalizeNumber(country: Jurisdiction, doc: unknown, kind: unknown): string | null {
  const number = text(doc)
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
  if (!number) return null
  const prefix = number.startsWith(country) ? "" : country
  const suffix = text(kind)
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
  return `${prefix}${number}${suffix && !number.endsWith(suffix) ? suffix : ""}`
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, "")
  if (digits.length !== 8) return null
  const result = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  return Number.isFinite(Date.parse(result)) ? result : null
}

function derivedFamily(priorities: string[]): string | null {
  if (!priorities.length) return null
  return `DERIVED-${createHash("sha256")
    .update([...priorities].sort().join("|"))
    .digest("hex")
    .slice(0, 24)}`
}

function earliest(values: string[]): string | null {
  return [...values].sort()[0] ?? null
}

function joined(values: string[]): string | null {
  const value = unique(values).join("\n").slice(0, MAX_FIELD)
  return value || null
}

function push(values: string[], value: string): void {
  if (value && values.join("\n").length < MAX_FIELD) values.push(value)
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(compact).filter(Boolean))]
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim()
}

function nullable(value: unknown): string | null {
  return text(value) || null
}
