import { Unzip, UnzipInflate, type UnzipFile } from "fflate"

export const FILE_LIMIT = 512 * 1024 * 1024
export const BATCH_LIMIT = 20
export const BATCH_BYTES = 10 * 1024 * 1024 * 1024
const ENTRY_LIMIT = 100_000
const NOTE_LIMIT = 200
const META_LIMIT = 1024 * 1024
const CHUNK = 64 * 1024
const CANCELLED = "BATCH_CANCELLED"

export type BatchKind = "file" | "folder" | "zip" | "tar"

export interface BatchInput {
  file: File
  path: string
}

export interface BatchSource {
  id: string
  file: File
  path: string
  kind: BatchKind
}

export interface BatchItem {
  id: string
  sourceId: string
  entry: number
  name: string
  path: string
  size: number
  kind: BatchKind
}

export interface BatchNote {
  path: string
  reason: string
}

export interface BatchScan {
  sources: BatchSource[]
  items: BatchItem[]
  notes: BatchNote[]
  ignored: number
  errors: BatchNote[]
}

export interface LogicalBatch {
  index: number
  items: BatchItem[]
  bytes: number
}

export type BatchProgress = (path: string, loaded: number, total: number) => void
export type BatchEmit = (item: BatchItem, blob: Blob) => Promise<void>
export type BatchFail = (item: BatchItem, error: string) => Promise<void> | void

export function partition(items: BatchItem[]): LogicalBatch[] {
  const groups: LogicalBatch[] = []
  for (const item of items) {
    const current = groups.at(-1)
    if (!current || current.items.length >= BATCH_LIMIT || current.bytes + item.size > BATCH_BYTES) {
      groups.push({ index: groups.length + 1, items: [item], bytes: item.size })
      continue
    }
    current.items.push(item)
    current.bytes += item.size
  }
  return groups
}

interface Handle {
  kind: "file" | "directory"
  name: string
  getFile?(): Promise<File>
  values?(): AsyncIterable<Handle>
}

interface Entry {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?(callback: (file: File) => void, error?: (error: DOMException) => void): void
  createReader?(): { readEntries(callback: (entries: Entry[]) => void, error?: (error: DOMException) => void): void }
}

interface TarMeta {
  index: number
  path: string
  name: string
  size: number
  type: string
}

export function listInputs(files: FileList | File[]): BatchInput[] {
  return Array.from(files).map((file) => ({ file, path: file.webkitRelativePath || file.name }))
}

export async function dropInputs(data: DataTransfer): Promise<BatchInput[]> {
  const items = Array.from(data.items)
  const result: BatchInput[] = []
  for (const item of items) {
    const modern = (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<Handle | null> })
      .getAsFileSystemHandle
    const handle = modern ? await modern.call(item) : null
    if (handle) {
      await walkHandle(handle, "", result)
      continue
    }
    const legacy = (item as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.()
    if (legacy) {
      await walkEntry(legacy, "", result)
      continue
    }
    const file = item.getAsFile()
    if (file) result.push({ file, path: file.name })
  }
  return result.length ? result : listInputs(data.files)
}

export async function scanInputs(inputs: BatchInput[], progress?: BatchProgress): Promise<BatchScan> {
  const state: BatchScan = { sources: [], items: [], notes: [], ignored: 0, errors: [] }
  const seen = new Set<File>()
  for (const input of inputs) {
    if (seen.has(input.file)) {
      note(state, input.path, "重复选择")
      continue
    }
    seen.add(input.file)
    const kind = classify(input.file.name)
    if (!kind) {
      note(state, input.path, "不是 VSIX、ZIP 或 TAR.GZ")
      continue
    }
    const source: BatchSource = {
      id: `source-${state.sources.length}-${input.file.lastModified}-${input.file.size}`,
      file: input.file,
      path: clean(input.path),
      kind: kind === "file" && clean(input.path) !== input.file.name ? "folder" : kind,
    }
    if (input.file.size > BATCH_BYTES) {
      state.errors.push({ path: source.path, reason: "输入文件超过 10 GiB" })
      continue
    }
    const before = state.items.length
    try {
      if (kind === "file") direct(source, state)
      if (kind === "zip") await scanZip(source, state, progress)
      if (kind === "tar") await scanTar(source, state, progress)
      if (state.items.length > before) state.sources.push(source)
    } catch (error) {
      state.items.splice(before)
      state.errors.push({ path: source.path, reason: message(error) })
    }
  }
  return state
}

export async function materialize(
  scan: BatchScan,
  items: BatchItem[],
  emit: BatchEmit,
  fail: BatchFail,
  progress?: BatchProgress,
  stop?: () => boolean,
): Promise<void> {
  const grouped = new Map<string, BatchItem[]>()
  for (const item of items) {
    const current = grouped.get(item.sourceId) ?? []
    current.push(item)
    grouped.set(item.sourceId, current)
  }
  for (const source of scan.sources) {
    if (stop?.()) return
    const matches = grouped.get(source.id) ?? []
    if (!matches.length) continue
    if (source.kind === "file" || source.kind === "folder") {
      const item = matches[0]
      if (item) await emit(item, source.file)
      continue
    }
    try {
      if (source.kind === "zip") await materializeZip(source, matches, emit, fail, progress, stop)
      if (source.kind === "tar") await materializeTar(source, matches, emit, fail, progress, stop)
    } catch (error) {
      if (message(error) === CANCELLED) return
      for (const item of matches) await fail(item, message(error))
    }
  }
}

function direct(source: BatchSource, state: BatchScan) {
  if (source.file.size > FILE_LIMIT) {
    note(state, source.path, "VSIX 超过 512 MiB")
    return
  }
  state.items.push({
    id: `${source.id}:0`,
    sourceId: source.id,
    entry: 0,
    name: basename(source.path),
    path: source.path,
    size: source.file.size,
    kind: source.kind,
  })
}

async function scanZip(source: BatchSource, state: BatchScan, progress?: BatchProgress) {
  const encrypted = await zipEncrypted(source.file)
  const archive = new Unzip()
  archive.register(UnzipInflate)
  const issue = { error: "", entries: 0, expanded: 0 }
  archive.onfile = (file) => {
    const index = issue.entries++
    if (issue.entries > ENTRY_LIMIT) {
      issue.error = "归档条目超过 100000 个"
      file.terminate()
      return
    }
    const path = safe(file.name)
    if (!path) {
      issue.error = `归档包含危险路径：${file.name}`
      file.terminate()
      return
    }
    if (!isVsix(path)) {
      note(state, `${source.path}/${path}`, "归档内非 VSIX")
      return
    }
    if (encrypted.has(index)) {
      note(state, `${source.path}/${path}`, "加密 ZIP 条目不受支持")
      return
    }
    const size = { value: 0, failed: "" }
    file.ondata = (error, data, final) => {
      if (error) {
        size.failed = /password|encrypt/i.test(error.message) ? "加密 ZIP 条目不受支持" : error.message
        return
      }
      size.value += data.length
      issue.expanded += data.length
      if (size.value > FILE_LIMIT) size.failed = "VSIX 超过 512 MiB"
      if (issue.expanded > BATCH_BYTES) issue.error = "归档展开后超过 10 GiB"
      if (!final) return
      if (file.size && size.value > 10 * 1024 * 1024 && size.value / file.size > 100)
        size.failed = "压缩比异常"
      if (size.failed) {
        note(state, `${source.path}/${path}`, size.failed)
        return
      }
      state.items.push({
        id: `${source.id}:${index}`,
        sourceId: source.id,
        entry: index,
        name: basename(path),
        path: `${source.path}/${path}`,
        size: size.value,
        kind: "zip",
      })
    }
    try {
      file.start()
    } catch (error) {
      note(state, `${source.path}/${path}`, /password|encrypt/i.test(message(error)) ? "加密 ZIP 条目不受支持" : message(error))
    }
  }
  await feed(source.file, (data, final) => archive.push(data, final), (loaded) => progress?.(source.path, loaded, source.file.size), issue)
  if (issue.error) throw new Error(issue.error)
}

async function materializeZip(
  source: BatchSource,
  items: BatchItem[],
  emit: BatchEmit,
  fail: BatchFail,
  progress?: BatchProgress,
  stop?: () => boolean,
) {
  const wanted = new Map(items.map((item) => [item.entry, item]))
  const done = new Set<string>()
  const pending: ZipTask[] = []
  const state: { active: ZipTask | undefined } = { active: undefined }
  const issue = { error: "", entries: 0, expanded: 0 }
  const archive = new Unzip()
  archive.register(UnzipInflate)
  archive.onfile = (file) => {
    const index = issue.entries++
    const item = wanted.get(index)
    if (!item) {
      file.terminate()
      return
    }
    const task: ZipTask = { item, file, chunks: [], size: 0, done: false, error: "" }
    file.ondata = (error, data, final) => {
      if (error) {
        task.error = error.message
        task.done = true
        return
      }
      task.size += data.length
      issue.expanded += data.length
      if (task.size > FILE_LIMIT || issue.expanded > BATCH_BYTES) {
        task.error = "解包大小超过限制"
        task.done = true
        file.terminate()
        return
      }
      task.chunks.push(data.slice())
      task.done = final
    }
    pending.push(task)
  }
  const pump = async () => {
    if (!state.active) {
      const next = pending.shift()
      if (!next) return
      state.active = next
      try {
        next.file.start()
      } catch (error) {
        next.error = message(error)
        next.done = true
      }
    }
    const active = state.active
    if (!active?.done) return
    state.active = undefined
    done.add(active.item.id)
    if (active.error) await fail(active.item, active.error)
    else await emit(active.item, new Blob([join(active.chunks).buffer as ArrayBuffer], { type: "application/vnd.microsoft.vscode.vsix" }))
    await pump()
  }
  await feed(
    source.file,
    (data, final) => archive.push(data, final),
    async (loaded) => {
      progress?.(source.path, loaded, source.file.size)
      await pump()
    },
    issue,
    stop,
  )
  await pump()
  for (const item of items) if (!done.has(item.id)) await fail(item, issue.error || "未能从 ZIP 读取该 VSIX")
}

interface ZipTask {
  item: BatchItem
  file: UnzipFile
  chunks: Uint8Array[]
  size: number
  done: boolean
  error: string
}

async function scanTar(source: BatchSource, state: BatchScan, progress?: BatchProgress) {
  await walkTar(source, async (meta, body) => {
    if (meta.type !== "0" && meta.type !== "\0") {
      note(state, `${source.path}/${meta.path}`, "不是普通文件")
      await body(false)
      return
    }
    if (!isVsix(meta.path)) {
      note(state, `${source.path}/${meta.path}`, "归档内非 VSIX")
      await body(false)
      return
    }
    if (meta.size > FILE_LIMIT) {
      note(state, `${source.path}/${meta.path}`, "VSIX 超过 512 MiB")
      await body(false)
      return
    }
    await body(false)
    state.items.push({
      id: `${source.id}:${meta.index}`,
      sourceId: source.id,
      entry: meta.index,
      name: meta.name,
      path: `${source.path}/${meta.path}`,
      size: meta.size,
      kind: "tar",
    })
  }, progress)
}

async function materializeTar(
  source: BatchSource,
  items: BatchItem[],
  emit: BatchEmit,
  fail: BatchFail,
  progress?: BatchProgress,
  stop?: () => boolean,
) {
  const wanted = new Map(items.map((item) => [item.entry, item]))
  const done = new Set<string>()
  await walkTar(source, async (meta, body) => {
    if (stop?.()) {
      await body(false)
      throw new Error(CANCELLED)
    }
    const item = wanted.get(meta.index)
    if (!item) {
      await body(false)
      return
    }
    try {
      const blob = await body(true)
      done.add(item.id)
      await emit(item, blob)
    } catch (error) {
      done.add(item.id)
      await fail(item, message(error))
    }
  }, progress)
  for (const item of items) if (!done.has(item.id)) await fail(item, "未能从 TAR.GZ 读取该 VSIX")
}

async function walkTar(
  source: BatchSource,
  visit: (meta: TarMeta, body: (keep: boolean) => Promise<Blob>) => Promise<void>,
  progress?: BatchProgress,
) {
  if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器不支持 TAR.GZ 流式解包")
  const stream = source.file.stream().pipeThrough(new DecompressionStream("gzip"))
  const bytes = new Bytes(stream.getReader(), (loaded) => progress?.(source.path, loaded, BATCH_BYTES))
  const state = { entries: 0, expanded: 0, global: {} as Record<string, string>, next: {} as Record<string, string>, long: "" }
  while (true) {
    const header = await bytes.maybe(512)
    if (!header || header.every((value) => value === 0)) break
    validateTar(header)
    state.entries += 1
    if (state.entries > ENTRY_LIMIT) throw new Error("归档条目超过 100000 个")
    const raw = tarName(header)
    const type = String.fromCharCode(header[156] || 0)
    const size = tarSize(header.subarray(124, 136))
    state.expanded += 512 + size + pad(size)
    if (state.expanded > BATCH_BYTES) throw new Error("归档展开后超过 10 GiB")
    if (type === "x" || type === "g" || type === "L") {
      if (size > META_LIMIT) throw new Error("TAR 元数据条目过大")
      const data = await bytes.take(size, true)
      await bytes.take(pad(size), false)
      const text = new TextDecoder().decode(join(data)).replace(/\0+$/, "")
      if (type === "L") state.long = text.trim()
      if (type === "x") state.next = pax(text)
      if (type === "g") state.global = { ...state.global, ...pax(text) }
      continue
    }
    const values = { ...state.global, ...state.next }
    const path = safe(values.path || state.long || raw)
    state.next = {}
    state.long = ""
    if (!path) throw new Error(`归档包含危险路径：${raw}`)
    const actual = values.size ? number(values.size, "PAX size") : size
    if (actual !== size) throw new Error("PAX size 与 TAR 条目不一致")
    const used = { value: false }
    const body = async (keep: boolean) => {
      if (used.value) throw new Error("TAR 条目已读取")
      used.value = true
      const chunks = await bytes.take(size, keep)
      await bytes.take(pad(size), false)
      return new Blob([join(chunks).buffer as ArrayBuffer], { type: "application/vnd.microsoft.vscode.vsix" })
    }
    await visit({ index: state.entries - 1, path, name: basename(path), size, type }, body)
    if (!used.value) await body(false)
  }
  if (state.expanded > 10 * 1024 * 1024 && source.file.size && state.expanded / source.file.size > 100)
    throw new Error("归档压缩比异常")
}

class Bytes {
  private readonly queue: Uint8Array[] = []
  private offset = 0
  private total = 0
  private ended = false

  constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly progress: (loaded: number) => void,
  ) {}

  async maybe(size: number): Promise<Uint8Array | undefined> {
    const chunks = await this.take(size, true, true)
    if (!chunks.length) return undefined
    return join(chunks)
  }

  async take(size: number, keep: boolean, optional = false): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = []
    let left = size
    while (left > 0) {
      if (!this.queue.length) {
        if (this.ended) {
          if (optional && left === size) return []
          throw new Error("TAR.GZ 提前结束")
        }
        const part = await this.reader.read()
        this.ended = part.done
        if (part.value?.length) this.queue.push(part.value)
        continue
      }
      const head = this.queue[0]!
      const count = Math.min(left, head.length - this.offset)
      const part = head.subarray(this.offset, this.offset + count)
      if (keep) chunks.push(part.slice())
      this.offset += count
      left -= count
      this.total += count
      this.progress(this.total)
      if (this.total > BATCH_BYTES) throw new Error("归档展开后超过 10 GiB")
      if (this.offset === head.length) {
        this.queue.shift()
        this.offset = 0
      }
    }
    return chunks
  }
}

async function feed(
  file: File,
  push: (data: Uint8Array, final: boolean) => void,
  progress: (loaded: number) => void | Promise<void>,
  issue: { error: string },
  stop?: () => boolean,
) {
  let offset = 0
  while (offset < file.size) {
    const end = Math.min(file.size, offset + CHUNK)
    push(new Uint8Array(await file.slice(offset, end).arrayBuffer()), end === file.size)
    offset = end
    await progress(offset)
    if (stop?.()) throw new Error(CANCELLED)
    if (issue.error) throw new Error(issue.error)
  }
  if (!file.size) push(new Uint8Array(), true)
}

async function walkHandle(handle: Handle, parent: string, result: BatchInput[]) {
  const path = parent ? `${parent}/${handle.name}` : handle.name
  if (handle.kind === "file" && handle.getFile) {
    result.push({ file: await handle.getFile(), path })
    return
  }
  if (!handle.values) return
  for await (const child of handle.values()) await walkHandle(child, path, result)
}

async function walkEntry(entry: Entry, parent: string, result: BatchInput[]): Promise<void> {
  const path = parent ? `${parent}/${entry.name}` : entry.name
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject))
    result.push({ file, path })
    return
  }
  if (!entry.isDirectory || !entry.createReader) return
  const reader = entry.createReader()
  while (true) {
    const entries = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!entries.length) return
    for (const child of entries) await walkEntry(child, path, result)
  }
}

function classify(name: string): "file" | "zip" | "tar" | undefined {
  const value = name.toLocaleLowerCase()
  if (value.endsWith(".vsix")) return "file"
  if (value.endsWith(".zip")) return "zip"
  if (value.endsWith(".tar.gz") || value.endsWith(".tgz")) return "tar"
  return undefined
}

function isVsix(path: string): boolean {
  return path.toLocaleLowerCase().endsWith(".vsix")
}

function clean(path: string): string {
  return path.normalize("NFKC").replaceAll("\\", "/").replace(/^\.\//, "")
}

function safe(value: string): string | undefined {
  const path = clean(value)
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return undefined
  if (path.split("/").some((part) => part === "..")) return undefined
  return path
}

function basename(path: string): string {
  return path.split("/").at(-1) || "extension.vsix"
}

function note(state: BatchScan, path: string, reason: string) {
  state.ignored += 1
  if (state.notes.length < NOTE_LIMIT) state.notes.push({ path, reason })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function join(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function pad(size: number): number {
  return (512 - (size % 512)) % 512
}

function tarName(header: Uint8Array): string {
  const name = field(header.subarray(0, 100))
  const prefix = field(header.subarray(345, 500))
  return prefix ? `${prefix}/${name}` : name
}

function field(value: Uint8Array): string {
  return new TextDecoder().decode(value).replace(/\0.*$/, "").trim()
}

function tarSize(value: Uint8Array): number {
  if (value[0]! & 0x80) {
    const bytes = value.slice()
    bytes[0] = (bytes[0] ?? 0) & 0x7f
    return bytes.reduce((sum, item) => sum * 256 + item, 0)
  }
  const raw = field(value).replaceAll(" ", "") || "0"
  if (!/^[0-7]+$/.test(raw)) throw new Error("TAR 大小字段无效")
  return number(parseInt(raw, 8), "TAR size")
}

function number(value: string | number, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} 无效`)
  return parsed
}

function validateTar(header: Uint8Array) {
  const expected = parseInt(field(header.subarray(148, 156)) || "0", 8)
  const actual = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0)
  if (!Number.isSafeInteger(expected) || expected !== actual) throw new Error("TAR 校验和无效")
}

async function zipEncrypted(file: File): Promise<Set<number>> {
  const tailSize = Math.min(file.size, 65_557)
  const tail = new Uint8Array(await file.slice(file.size - tailSize).arrayBuffer())
  let end = -1
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (u32(tail, index) !== 0x06054b50) continue
    if (index + 22 + u16(tail, index + 20) !== tail.length) continue
    end = index
    break
  }
  if (end < 0) throw new Error("ZIP 中央目录无效")
  const legacy = { count: u16(tail, end + 10), size: u32(tail, end + 12), offset: u32(tail, end + 16) }
  const directory = legacy.count === 0xffff || legacy.size === 0xffffffff || legacy.offset === 0xffffffff
    ? await zip64(file, tail, end)
    : legacy
  const { count, size, offset } = directory
  if (count > ENTRY_LIMIT) throw new Error("归档条目超过 100000 个")
  if (size > 64 * 1024 * 1024 || offset + size > file.size) throw new Error("ZIP 中央目录过大或越界")
  const data = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer())
  const encrypted = new Set<number>()
  let cursor = 0
  for (let index = 0; index < count; index += 1) {
    if (u32(data, cursor) !== 0x02014b50) throw new Error("ZIP 中央目录条目无效")
    if (u16(data, cursor + 8) & 1) encrypted.add(index)
    const name = u16(data, cursor + 28)
    const extra = u16(data, cursor + 30)
    const comment = u16(data, cursor + 32)
    cursor += 46 + name + extra + comment
    if (cursor > data.length) throw new Error("ZIP 中央目录条目越界")
  }
  return encrypted
}

async function zip64(file: File, tail: Uint8Array, end: number) {
  const locator = end - 20
  if (locator < 0 || u32(tail, locator) !== 0x07064b50) throw new Error("ZIP64 定位器无效")
  const position = u64(tail, locator + 8)
  if (position + 64 > file.size) throw new Error("ZIP64 中央目录越界")
  const data = new Uint8Array(await file.slice(position, position + 64).arrayBuffer())
  if (u32(data, 0) !== 0x06064b50) throw new Error("ZIP64 中央目录无效")
  return { count: u64(data, 32), size: u64(data, 40), offset: u64(data, 48) }
}

function u16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8)
}

function u32(data: Uint8Array, offset: number): number {
  return (u16(data, offset) | (u16(data, offset + 2) << 16)) >>> 0
}

function u64(data: Uint8Array, offset: number): number {
  const low = u32(data, offset)
  const high = u32(data, offset + 4)
  const value = high * 0x1_0000_0000 + low
  if (!Number.isSafeInteger(value)) throw new Error("ZIP64 数值超过浏览器安全范围")
  return value
}

function pax(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  let offset = 0
  while (offset < value.length) {
    const space = value.indexOf(" ", offset)
    if (space < 0) throw new Error("PAX 记录无效")
    const length = number(value.slice(offset, space), "PAX length")
    const record = value.slice(space + 1, offset + length).replace(/\n$/, "")
    const equals = record.indexOf("=")
    if (equals > 0) result[record.slice(0, equals)] = record.slice(equals + 1)
    offset += length
  }
  return result
}
