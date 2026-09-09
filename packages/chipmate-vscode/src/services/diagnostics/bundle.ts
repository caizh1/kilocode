import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, lstat, readdir, unlink, rename } from "node:fs/promises"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { Transform } from "node:stream"
import { ZipFile } from "yazl"
import { redactText, sanitize } from "@opencode-ai/core/chipmate/diagnostics/redact"
import type { DiagnosticRecord } from "@opencode-ai/core/chipmate/diagnostics/store"

export const BUNDLE_MAX = 50 * 1024 * 1024
export interface DiagnosticSource { name: string; status: "ok" | "partial" | "missing"; message?: string }
export interface Bundle { id: string; path: string; sha256: string; size: number; partial: boolean }
export interface BundleInput {
  root: string; salt: string; version: string; platform: string; from: string; to: string; description: string
  environment: unknown; records: DiagnosticRecord[]; sources: DiagnosticSource[]; supplements?: Record<string, unknown>; attachment?: unknown
}
export async function buildBundle(input: BundleInput, signal: AbortSignal): Promise<Bundle> {
  signal.throwIfAborted()
  await mkdir(input.root, { recursive: true, mode: 0o700 })
  const stat = await lstat(input.root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("诊断包目录不可为链接")
  const id = randomUUID()
  const zip = new ZipFile()
  const files: { name: string; size: number; sha256: string }[] = []
  let expanded = 0
  const add = (name: string, value: string) => {
    const data = Buffer.from(value, "utf8")
    expanded += data.length
    if (expanded > 100 * 1024 * 1024) throw new Error("诊断内容超过预算，请缩短收集时间范围")
    files.push({ name, size: data.length, sha256: createHash("sha256").update(data).digest("hex") })
    zip.addBuffer(data, name, { mode: 0o600, mtime: new Date(input.to) })
  }
  const errors = input.records.filter((record) => record.level === "ERROR")
  const partial = input.sources.some((source) => source.status !== "ok")
  const summary = ["# ChipMate 诊断摘要", `诊断编号：${id}`, `时间范围：${input.from} 至 ${input.to}`, `问题描述：${redactText(input.description, input.salt) || "未填写"}`, `记录总数：${input.records.length}；错误记录：${errors.length}`, `完整度：${partial ? "部分资料未采集或已截断" : "已完成所列来源采集"}`, "", "## 收集来源", ...input.sources.map((source) => `- ${source.name}：${source.status === "ok" ? "已收集" : source.status === "partial" ? "部分收集" : "未收集"}${source.message ? `；${redactText(source.message, input.salt)}` : ""}`), "", "## 最近错误", ...errors.slice(-20).map((record) => `- ${record.time} ${record.source}：${redactText(record.event, input.salt)}`)].join("\n").slice(0, 15000)
  add("摘要.md", summary)
  add("环境.json", JSON.stringify(sanitize(input.environment, input.salt), null, 2))
  const sources = new Map<string, DiagnosticRecord[]>()
  for (const record of input.records) {
    const name = record.source.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64)
    const group = sources.get(name) ?? []
    group.push(record); sources.set(name, group)
  }
  for (const [name, records] of sources) add(`日志/${name}.jsonl`, records.map((record) => JSON.stringify(sanitize(record, input.salt))).join("\n") + "\n")
  for (const [name, value] of Object.entries(input.supplements ?? {})) add(`状态/${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`, JSON.stringify(sanitize(value, input.salt), null, 2))
  if (input.attachment !== undefined) add("会话.json", JSON.stringify(input.attachment, null, 2))
  const manifest = { schemaVersion: 1, id, version: input.version, platform: input.platform, from: input.from, to: input.to, summary, partial, sources: input.sources, files }
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), "manifest.json", { mode: 0o600 })
  const temporary = join(input.root, `${id}.part`)
  const target = join(input.root, `${id}.zip`)
  const hash = createHash("sha256")
  let size = 0
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length
    if (size > BUNDLE_MAX) { callback(new Error("诊断 ZIP 超过 50 MiB，请缩短时间范围")); return }
    hash.update(chunk); callback(null, chunk)
  } })
  const output = pipeline(zip.outputStream, meter, createWriteStream(temporary, { flags: "wx", mode: 0o600 }), { signal })
  zip.end()
  try {
    await output; signal.throwIfAborted(); await rename(temporary, target)
    await pruneBundles(input.root, id)
    return { id, path: target, size, sha256: hash.digest("hex"), partial }
  } catch (error) { await unlink(temporary).catch(() => undefined); throw error }
}
export async function pruneBundles(root: string, keep?: string) {
  const files = []
  for (const name of await readdir(root)) {
    if (!/^[a-f0-9-]{36}\.zip$/.test(name)) continue
    const stat = await lstat(join(root, name)).catch(() => undefined)
    if (stat?.isFile() && !stat.isSymbolicLink()) files.push({ name, time: stat.mtimeMs })
  }
  const sorted = files.sort((a, b) => b.time - a.time)
  for (let index = 0; index < sorted.length; index++) {
    const item = sorted[index]
    if (item.name === `${keep}.zip`) continue
    if (index >= 3 || item.time < Date.now() - 7 * 86400_000) await unlink(join(root, item.name))
  }
}
export async function verifyBundle(bundle: Bundle) {
  const stat = await lstat(bundle.path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bundle.size || stat.size > BUNDLE_MAX) throw new Error("本地诊断包已变化")
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(bundle.path)) hash.update(chunk)
  if (hash.digest("hex") !== bundle.sha256) throw new Error("本地诊断包校验失败")
}
