import { Gzip } from "fflate"

const LIMITS = {
  files: 500,
  fileBytes: 10 * 1024 * 1024,
  uploadBytes: 50 * 1024 * 1024,
  extractedBytes: 100 * 1024 * 1024,
  pathBytes: 1024,
} as const

const IGNORES = new Set([".DS_Store", ".git", "__MACOSX", "node_modules", "Thumbs.db"])
const encoder = new TextEncoder()

export interface SkillFolderFile {
  path: string
  file: File
  name: string
  prefix: string
}

export interface SkillFolderScan {
  root: string
  files: SkillFolderFile[]
  ignored: string[]
  bytes: number
}

export interface SkillFolderProgress {
  stage: "scanning" | "packing"
  path: string
  completed: number
  total: number
  loaded: number
  bytes: number
}

export function scanSkillFolder(input: Iterable<File>): SkillFolderScan {
  const source = [...input]
  if (!source.length) throw new Error("所选文件夹为空。")
  const roots = new Set(source.map((file) => parts(file)[0]).filter(Boolean))
  if (roots.size !== 1) throw new Error("一次只能选择一个 Skill 文件夹。")
  const root = [...roots][0]!
  const ignored: string[] = []
  const seen = new Set<string>()
  const files: SkillFolderFile[] = []
  let bytes = 0
  for (const file of source) {
    const raw = parts(file)
    if (raw[0] !== root || raw.length < 2) throw new Error("文件夹内容缺少稳定的根目录。")
    const path = raw.slice(1).join("/").normalize("NFC")
    if (raw.some((part) => IGNORES.has(part) || part.startsWith("._"))) {
      ignored.push(path)
      continue
    }
    validate(path)
    const key = path.toLocaleLowerCase()
    if (seen.has(key)) throw new Error(`存在重复或大小写冲突路径：${path}`)
    seen.add(key)
    if (file.size > LIMITS.fileBytes) throw new Error(`文件超过 10 MiB：${path}`)
    bytes += file.size
    if (bytes > LIMITS.extractedBytes) throw new Error("文件夹展开大小超过 100 MiB。")
    const target = split(path)
    files.push({ path, file, ...target })
  }
  if (files.length > LIMITS.files) throw new Error("文件夹内文件数量超过 500 个。")
  if (!files.some((item) => item.path.toLocaleLowerCase() === "skill.md"))
    throw new Error("所选文件夹根目录必须包含 SKILL.md。")
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { root, files, ignored, bytes }
}

export async function packSkillFolder(scan: SkillFolderScan, progress?: (value: SkillFolderProgress) => void) {
  const chunks: Uint8Array[] = []
  const gzip = new Gzip({ level: 9, mtime: 0 }, (chunk, final) => {
    if (chunk.length) chunks.push(chunk.slice())
    if (final) return
  })
  let loaded = 0
  for (const [index, item] of scan.files.entries()) {
    progress?.({
      stage: "packing",
      path: item.path,
      completed: index,
      total: scan.files.length,
      loaded,
      bytes: scan.bytes,
    })
    gzip.push(header(item), false)
    const reader = item.file.stream().getReader()
    while (true) {
      const part = await reader.read()
      if (part.done) break
      loaded += part.value.byteLength
      gzip.push(part.value, false)
      progress?.({
        stage: "packing",
        path: item.path,
        completed: index,
        total: scan.files.length,
        loaded,
        bytes: scan.bytes,
      })
    }
    const padding = (512 - (item.file.size % 512)) % 512
    if (padding) gzip.push(new Uint8Array(padding), false)
  }
  gzip.push(new Uint8Array(1024), true)
  const blob = new Blob(
    chunks.map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer),
    { type: "application/gzip" },
  )
  if (blob.size > LIMITS.uploadBytes) throw new Error("文件夹压缩后超过 50 MiB。")
  progress?.({
    stage: "packing",
    path: "打包完成",
    completed: scan.files.length,
    total: scan.files.length,
    loaded: scan.bytes,
    bytes: scan.bytes,
  })
  return blob
}

export async function dropSkillFolder(data: DataTransfer) {
  const roots = [...data.items].flatMap((item) => {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?(): DropEntry | null }).webkitGetAsEntry?.()
    return entry ? [entry] : []
  })
  if (roots.length !== 1 || !roots[0]?.isDirectory) throw new Error("请一次拖入一个 Skill 文件夹。")
  const files: File[] = []
  await walk(roots[0], "", files)
  return files
}

interface DropEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  file?(done: (file: File) => void, fail: (error: DOMException) => void): void
  createReader?(): { readEntries(done: (entries: DropEntry[]) => void, fail: (error: DOMException) => void): void }
}

async function walk(entry: DropEntry, parent: string, files: File[]): Promise<void> {
  const path = parent ? `${parent}/${entry.name}` : entry.name
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject))
    Object.defineProperty(file, "webkitRelativePath", { configurable: true, value: path })
    files.push(file)
    return
  }
  if (!entry.isDirectory || !entry.createReader) return
  const reader = entry.createReader()
  while (true) {
    const entries = await new Promise<DropEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!entries.length) return
    for (const child of entries) await walk(child, path, files)
  }
}

function parts(file: File) {
  const path = (file.webkitRelativePath || file.name).replaceAll("\\", "/")
  return path.split("/").filter(Boolean)
}

function validate(path: string) {
  if (!path || encoder.encode(path).byteLength > LIMITS.pathBytes || path.startsWith("/") || /^[A-Za-z]:/.test(path))
    throw new Error(`路径无效或过长：${path || "（空路径）"}`)
  if (
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          [...part].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
      )
  )
    throw new Error(`路径包含不安全字符：${path}`)
}

function split(path: string) {
  if (encoder.encode(path).byteLength <= 100) return { name: path, prefix: "" }
  const points = [...path.matchAll(/\//g)].map((match) => match.index)
  for (const point of points.toReversed()) {
    const prefix = path.slice(0, point)
    const name = path.slice(point + 1)
    if (encoder.encode(prefix).byteLength <= 155 && encoder.encode(name).byteLength <= 100) return { name, prefix }
  }
  throw new Error(`路径无法写入 USTAR 归档：${path}`)
}

function header(item: SkillFolderFile) {
  const data = new Uint8Array(512)
  write(data, 0, 100, item.name)
  write(data, 100, 8, oct(item.path.startsWith("scripts/") ? 0o755 : 0o644, 7))
  write(data, 108, 8, oct(0, 7))
  write(data, 116, 8, oct(0, 7))
  write(data, 124, 12, oct(item.file.size, 11))
  write(data, 136, 12, oct(0, 11))
  data.fill(0x20, 148, 156)
  data[156] = 0x30
  write(data, 257, 6, "ustar")
  write(data, 263, 2, "00")
  if (item.prefix) write(data, 345, 155, item.prefix)
  const sum = data.reduce((total, byte) => total + byte, 0)
  write(data, 148, 8, `${oct(sum, 6)}\0 `)
  return data
}

function write(target: Uint8Array, offset: number, size: number, value: string) {
  const data = encoder.encode(value)
  if (data.byteLength > size) throw new Error(`归档字段超过限制：${value}`)
  target.set(data, offset)
}

function oct(value: number, width: number) {
  return Math.max(0, Math.floor(value)).toString(8).padStart(width, "0").slice(-width)
}
