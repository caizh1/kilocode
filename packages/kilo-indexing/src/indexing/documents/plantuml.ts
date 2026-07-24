import { createHash } from "node:crypto"
import { inflateRawSync, inflateSync } from "node:zlib"

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const local = 0x04034b50
const central = 0x02014b50
const eocd = 0x06054b50

type Entry = {
  name: string
  method: number
  packed: number
  unpacked: number
  offset: number
  limit: number
}

export type DocxPlantUmlOptions = {
  maxImages?: number
  maxSourceBytes?: number
  maxTotalSourceBytes?: number
  maxMediaBytes?: number
  maxPngBytes?: number
}

export type DocxPlantUmlDiagram = {
  mediaPath: string
  source: string
  version?: string
  sha256: string
}

export type DocxPlantUmlResult = {
  diagrams: DocxPlantUmlDiagram[]
  warnings: string[]
  truncated: boolean
}

const defaults = {
  images: 32,
  source: 128 * 1024,
  total: 512 * 1024,
  media: 64 * 1024 * 1024,
  image: 16 * 1024 * 1024,
}

export async function extractDocxPlantUml(
  input: Uint8Array,
  options: DocxPlantUmlOptions = {},
): Promise<DocxPlantUmlResult> {
  const opts = {
    images: size(options.maxImages, defaults.images),
    source: size(options.maxSourceBytes, defaults.source),
    total: size(options.maxTotalSourceBytes, defaults.total),
    media: size(options.maxMediaBytes, defaults.media),
    image: size(options.maxPngBytes, defaults.image),
  }
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const entries = inspect(bytes, opts.media, opts.image)
  const warnings: string[] = []
  const selected = entries.slice(0, opts.images)
  const diagrams: DocxPlantUmlDiagram[] = []
  let total = 0
  let media = 0
  let truncated = entries.length > selected.length

  for (const entry of selected) {
    const remaining = Math.min(opts.image, Math.max(0, opts.media - media))
    if (remaining < 1) {
      warning(warnings, `${entry.name}: DOCX PNG media exceeds the ${opts.media}-byte safety limit.`)
      truncated = true
      break
    }
    const data = (() => {
      try {
        return unpack(bytes, entry, remaining)
      } catch (err) {
        warning(warnings, `${entry.name}: ${message(err)}`)
        truncated = true
        return undefined
      }
    })()
    if (!data) continue
    media += data.byteLength
    const parsed = (() => {
      try {
        return metadata(data, opts.source)
      } catch (err) {
        warning(warnings, `${entry.name}: ${message(err)}`)
        return undefined
      }
    })()
    if (!parsed) continue
    const used = Buffer.byteLength(parsed.source, "utf8")
    if (total + used > opts.total) {
      warning(warnings, `${entry.name}: PlantUML source exceeds the document source budget.`)
      truncated = true
      continue
    }
    total += used
    diagrams.push({
      mediaPath: entry.name,
      source: parsed.source,
      version: parsed.version,
      sha256: createHash("sha256").update(data).digest("hex"),
    })
  }

  return { diagrams, warnings, truncated }
}

function inspect(bytes: Buffer, maxMedia: number, maxPng: number) {
  const entries: Entry[] = []
  const end = findEocd(bytes)
  const disk = bytes.readUInt16LE(end + 4)
  const startDisk = bytes.readUInt16LE(end + 6)
  const diskEntries = bytes.readUInt16LE(end + 8)
  const count = bytes.readUInt16LE(end + 10)
  const size = bytes.readUInt32LE(end + 12)
  const start = bytes.readUInt32LE(end + 16)
  if (disk !== 0 || startDisk !== 0 || diskEntries !== count) {
    throw new Error("Multi-disk DOCX archives are not supported.")
  }
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) {
    throw new Error("ZIP64 DOCX archives are not supported.")
  }
  if (start + size > end || start > bytes.length) throw new Error("DOCX has an invalid ZIP central directory.")
  let total = 0
  let offset = start
  const names = new Set<string>()
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== central) {
      throw new Error("DOCX has an invalid ZIP central directory entry.")
    }
    const flags = bytes.readUInt16LE(offset + 8)
    const method = bytes.readUInt16LE(offset + 10)
    const diskStart = bytes.readUInt16LE(offset + 34)
    const localOffset = bytes.readUInt32LE(offset + 42)
    const packed = bytes.readUInt32LE(offset + 20)
    const unpacked = bytes.readUInt32LE(offset + 24)
    const nameSize = bytes.readUInt16LE(offset + 28)
    const extra = bytes.readUInt16LE(offset + 30)
    const comment = bytes.readUInt16LE(offset + 32)
    const next = offset + 46 + nameSize + extra + comment
    if (next > bytes.length || next > start + size) throw new Error("DOCX has an invalid ZIP central directory.")
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString("utf8")
    offset = next
    if (!safe(name)) throw new Error(`DOCX contains an unsafe ZIP path: ${name}`)
    if (!/^word\/media\/[^/]+\.png$/i.test(name)) continue
    if (names.has(name.toLowerCase())) throw new Error(`DOCX contains a duplicate PNG media path: ${name}`)
    names.add(name.toLowerCase())
    if ((flags & 1) !== 0) throw new Error(`DOCX contains encrypted PNG media: ${name}`)
    if (diskStart !== 0) throw new Error(`DOCX media entry spans multiple disks: ${name}`)
    if (packed === 0xffffffff || unpacked === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error(`DOCX media entry uses unbounded ZIP64 sizing: ${name}`)
    }
    if (localOffset >= start) throw new Error(`DOCX media entry has an invalid local offset: ${name}`)
    if (packed > maxPng) throw new Error(`${name} exceeds the ${maxPng}-byte compressed PNG safety limit.`)
    if (unpacked > maxPng) throw new Error(`${name} exceeds the ${maxPng}-byte PNG safety limit.`)
    total += unpacked
    if (total > maxMedia) throw new Error(`DOCX PNG media exceeds the ${maxMedia}-byte safety limit.`)
    entries.push({
      name,
      method,
      packed,
      unpacked,
      offset: localOffset,
      limit: start,
    })
  }
  if (offset !== start + size) throw new Error("DOCX central directory size does not match its entries.")
  return entries
}

function unpack(bytes: Buffer, entry: Entry, max: number) {
  if (entry.offset + 30 > entry.limit || bytes.readUInt32LE(entry.offset) !== local) {
    throw new Error("ZIP local entry is invalid.")
  }
  const flags = bytes.readUInt16LE(entry.offset + 6)
  const method = bytes.readUInt16LE(entry.offset + 8)
  const nameSize = bytes.readUInt16LE(entry.offset + 26)
  const extra = bytes.readUInt16LE(entry.offset + 28)
  const start = entry.offset + 30 + nameSize + extra
  const end = start + entry.packed
  if ((flags & 1) !== 0) throw new Error("ZIP local entry is encrypted.")
  if (method !== entry.method) throw new Error("ZIP compression methods do not match.")
  if (end > entry.limit || end > bytes.length) throw new Error("ZIP media payload is truncated.")
  const name = bytes.subarray(entry.offset + 30, entry.offset + 30 + nameSize).toString("utf8")
  if (name !== entry.name) throw new Error("ZIP local media path does not match the central directory.")
  const packed = bytes.subarray(start, end)
  const data =
    entry.method === 0
      ? Buffer.from(packed)
      : entry.method === 8
        ? inflateRawSync(packed, { maxOutputLength: Math.min(max, entry.unpacked) + 1 })
        : undefined
  if (!data) throw new Error(`ZIP compression method ${entry.method} is unsupported.`)
  if (data.byteLength !== entry.unpacked) throw new Error("ZIP media size does not match the central directory.")
  if (data.byteLength > max) throw new Error(`PNG exceeds the ${max}-byte safety limit.`)
  return data
}

function metadata(input: Uint8Array, max: number) {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (bytes.length < png.length || !bytes.subarray(0, png.length).equals(png)) return undefined
  const found: Array<{ source: string; version?: string }> = []
  let ended = false
  for (let offset = png.length; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) throw new Error("PNG contains a truncated chunk.")
    const kind = bytes.subarray(offset + 4, offset + 8).toString("ascii")
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    offset = end
    if (kind === "iTXt") {
      const parsed = text(data, max)
      if (parsed) found.push(parsed)
    }
    if (kind !== "IEND") continue
    if (length !== 0) throw new Error("PNG has an invalid IEND chunk.")
    if (offset !== bytes.length) throw new Error("PNG contains data after IEND.")
    ended = true
    break
  }
  if (!ended) throw new Error("PNG is missing its IEND chunk.")
  if (found.length > 1) throw new Error("PNG contains multiple PlantUML metadata chunks.")
  return found[0]
}

function text(data: Buffer, max: number) {
  const keywordEnd = data.indexOf(0)
  if (keywordEnd < 1) throw new Error("PlantUML iTXt has an invalid keyword.")
  if (data.subarray(0, keywordEnd).toString("latin1").toLowerCase() !== "plantuml") return undefined
  let offset = keywordEnd + 1
  if (offset + 2 > data.length) throw new Error("PlantUML iTXt is truncated.")
  const compressed = data[offset++]
  const method = data[offset++]
  const languageEnd = data.indexOf(0, offset)
  if (languageEnd < 0) throw new Error("PlantUML iTXt has an invalid language tag.")
  offset = languageEnd + 1
  const translatedEnd = data.indexOf(0, offset)
  if (translatedEnd < 0) throw new Error("PlantUML iTXt has an invalid translated keyword.")
  offset = translatedEnd + 1
  if (compressed !== 0 && compressed !== 1) throw new Error("PlantUML iTXt has an invalid compression flag.")
  if (compressed === 1 && method !== 0) throw new Error("PlantUML iTXt uses an unsupported compression method.")
  const raw =
    compressed === 1
      ? inflateSync(data.subarray(offset), { maxOutputLength: max + 4096 })
      : data.subarray(offset)
  if (raw.byteLength > max + 4096) throw new Error(`PlantUML metadata exceeds the ${max}-byte safety limit.`)
  const decoded = normalize(raw.toString("utf8"))
  const starts = [...decoded.matchAll(/@startuml\b/gi)]
  const ends = [...decoded.matchAll(/@enduml\b/gi)]
  if (starts.length !== 1 || ends.length !== 1) throw new Error("PlantUML metadata must contain exactly one UML diagram.")
  const start = starts[0]?.index ?? -1
  const finish = (ends[0]?.index ?? -1) + (ends[0]?.[0].length ?? 0)
  if (start < 0 || finish <= start) throw new Error("PlantUML metadata has invalid diagram boundaries.")
  const source = decoded.slice(start, finish).trim()
  if (Buffer.byteLength(source, "utf8") > max) {
    throw new Error(`PlantUML source exceeds the ${max}-byte safety limit.`)
  }
  const version = decoded.slice(finish).trim().split(/\n/)[0]?.trim() || undefined
  return { source, version }
}

function normalize(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/\u0000/g, "")
}

function safe(name: string) {
  if (!name || name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name)) return false
  const parts = name.endsWith("/") ? name.slice(0, -1).split("/") : name.split("/")
  return parts.every((part) => part && part !== "." && part !== "..")
}

function findEocd(bytes: Buffer) {
  const start = Math.max(0, bytes.length - 65_557)
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== eocd) continue
    const comment = bytes.readUInt16LE(offset + 20)
    if (offset + 22 + comment === bytes.length) return offset
  }
  throw new Error("DOCX is missing a valid ZIP end record.")
}

function size(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

function warning(warnings: string[], value: string) {
  if (warnings.length < 64) warnings.push(value)
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}
