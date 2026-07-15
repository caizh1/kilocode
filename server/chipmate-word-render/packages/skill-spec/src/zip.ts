import { inflateRawSync } from "node:zlib"

export interface ZipEntry {
  path: string
  data: Buffer
  mode: number
}

export interface ZipLimits {
  files: number
  fileBytes: number
  totalBytes: number
  pathBytes: number
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

export function parseZip(input: Buffer, limits: ZipLimits): ZipEntry[] {
  const end = eocd(input)
  if (end < 0) throw new Error("ZIP end record is missing or truncated")
  if (input.readUInt16LE(end + 4) !== 0 || input.readUInt16LE(end + 6) !== 0)
    throw new Error("Multi-disk ZIP archives are not supported")

  const count = input.readUInt16LE(end + 10)
  const size = input.readUInt32LE(end + 12)
  const start = input.readUInt32LE(end + 16)
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff)
    throw new Error("ZIP64 archives are not supported")
  if (count > limits.files || start + size > end) throw new Error("ZIP archive exceeds structural limits")

  const files: ZipEntry[] = []
  const seen = new Set<string>()
  let offset = start
  let total = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > input.length || input.readUInt32LE(offset) !== CENTRAL)
      throw new Error("ZIP central directory is malformed")
    const flags = input.readUInt16LE(offset + 8)
    const method = input.readUInt16LE(offset + 10)
    const checksum = input.readUInt32LE(offset + 16)
    const compressed = input.readUInt32LE(offset + 20)
    const expanded = input.readUInt32LE(offset + 24)
    const nameBytes = input.readUInt16LE(offset + 28)
    const extraBytes = input.readUInt16LE(offset + 30)
    const commentBytes = input.readUInt16LE(offset + 32)
    const disk = input.readUInt16LE(offset + 34)
    const attrs = input.readUInt32LE(offset + 38)
    const local = input.readUInt32LE(offset + 42)
    const next = offset + 46 + nameBytes + extraBytes + commentBytes
    if (next > input.length || disk !== 0) throw new Error("ZIP central directory entry is malformed")
    if ((flags & 1) !== 0) throw new Error("Encrypted ZIP entries are not allowed")
    if (method !== 0 && method !== 8) throw new Error("ZIP compression method is not supported")
    const encoding = (flags & 0x800) !== 0 ? "utf8" : "latin1"
    const name = input.subarray(offset + 46, offset + 46 + nameBytes).toString(encoding)
    offset = next
    if (name.endsWith("/")) continue
    if (!safe(name, limits.pathBytes)) throw new Error(`Unsafe ZIP entry path: ${name}`)
    const key = name.normalize("NFC").toLocaleLowerCase()
    if (seen.has(key)) throw new Error(`Duplicate or case-colliding ZIP path: ${name}`)
    seen.add(key)
    if (expanded > limits.fileBytes) throw new Error(`ZIP entry exceeds file size limit: ${name}`)
    total += expanded
    if (total > limits.totalBytes) throw new Error("ZIP archive exceeds extracted size limit")
    if (compressed === 0 && expanded > 0) throw new Error(`ZIP entry has an invalid compression ratio: ${name}`)
    if (compressed > 0 && expanded / compressed > 1_000)
      throw new Error(`ZIP entry exceeds compression ratio limit: ${name}`)
    if (local + 30 > input.length || input.readUInt32LE(local) !== LOCAL)
      throw new Error(`ZIP local header is malformed: ${name}`)
    const localName = input.readUInt16LE(local + 26)
    const localExtra = input.readUInt16LE(local + 28)
    const begin = local + 30 + localName + localExtra
    const finish = begin + compressed
    if (finish > input.length) throw new Error(`ZIP entry is truncated: ${name}`)
    const packed = input.subarray(begin, finish)
    const data = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: expanded + 1 })
    if (data.length !== expanded || crc32(data) !== checksum) throw new Error(`ZIP entry checksum mismatch: ${name}`)
    const mode = ((attrs >>> 16) & 0o777) || (name.startsWith("scripts/") ? 0o755 : 0o644)
    files.push({ path: name, data, mode })
  }
  if (offset !== start + size) throw new Error("ZIP central directory size does not match its entries")
  return files
}

function eocd(input: Buffer) {
  if (input.length < 22) return -1
  const first = Math.max(0, input.length - 65_557)
  for (let offset = input.length - 22; offset >= first; offset--) {
    if (input.readUInt32LE(offset) !== EOCD) continue
    const comment = input.readUInt16LE(offset + 20)
    if (offset + 22 + comment === input.length) return offset
  }
  return -1
}

function safe(path: string, max: number) {
  if (
    !path ||
    Buffer.byteLength(path) > max ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\") ||
    [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return false
  return path.split("/").every((part) => part && part !== "." && part !== "..")
}

function crc32(data: Buffer) {
  let value = 0xffffffff
  for (const byte of data) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
