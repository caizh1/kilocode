import { createHash } from "node:crypto"
import * as yauzl from "yauzl"

export const DIAGNOSTIC_MAX = 50 * 1024 * 1024
export const DIAGNOSTIC_EXPANDED = 100 * 1024 * 1024
export interface DiagnosticManifest {
  schemaVersion: 1
  id: string
  version: string
  platform: string
  from: string
  to: string
  summary: string
  partial: boolean
  sources: Array<{ name: string; status: string; message?: string }>
  files: Array<{ name: string; size: number; sha256: string }>
}
export async function inspectDiagnostics(file: string, signal: AbortSignal): Promise<DiagnosticManifest> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (err, value) => err || !value ? reject(err ?? new Error("诊断包无法打开")) : resolve(value)))
  return new Promise((resolve, reject) => {
    const names = new Set<string>()
    const actual = new Map<string, { size: number; sha256: string }>()
    let expanded = 0
    let manifest: DiagnosticManifest | undefined
    let ended = false
    const fail = (err: unknown) => { if (ended) return; ended = true; signal.removeEventListener("abort", abort); zip.close(); reject(err) }
    const abort = () => fail(new Error("诊断校验已取消"))
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) { abort(); return }
    zip.on("error", fail)
    zip.on("entry", (entry: yauzl.Entry) => {
      const name = entry.fileName
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000
      if (names.size >= 256 || !/^[^\\\x00-\x1f:]+\.(?:json|jsonl|md)$/.test(name) || name.startsWith("/") || name.split("/").some((p) => p === "." || p === ".." || !p) || names.has(name) || mode === 0xa000 || (entry.generalPurposeBitFlag & 1)) {
        fail(new Error("诊断包包含不允许的路径、重复文件或加密条目")); return
      }
      names.add(name)
      expanded += entry.uncompressedSize
      if (!Number.isSafeInteger(expanded) || expanded > DIAGNOSTIC_EXPANDED || (name === "manifest.json" && entry.uncompressedSize > 256 * 1024)) { fail(new Error("诊断包展开大小超限")); return }
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) { fail(err ?? new Error("诊断条目读取失败")); return }
        const chunks: Buffer[] = []
        const hash = createHash("sha256")
        let size = 0
        stream.on("error", fail)
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (ended || size > entry.uncompressedSize || size > DIAGNOSTIC_EXPANDED) { stream.destroy(); fail(new Error("诊断条目实际大小超限")); return }
          hash.update(chunk)
          if (name === "manifest.json") chunks.push(chunk)
        })
        stream.on("end", () => {
          if (ended) return
          actual.set(name, { size, sha256: hash.digest("hex") })
          if (name === "manifest.json") {
            try { manifest = JSON.parse(Buffer.concat(chunks).toString("utf8")) as DiagnosticManifest } catch (error) { fail(error); return }
          }
          zip.readEntry()
        })
      })
    })
    zip.on("end", () => {
      if (ended) return
      try {
        const value = manifest
        if (!value || value.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(value.id) || typeof value.summary !== "string" || value.summary.length > 16000 || typeof value.partial !== "boolean" || !Array.isArray(value.sources) || value.sources.length > 100 || !Array.isArray(value.files) || value.files.length !== actual.size - 1) throw new Error("诊断清单格式无效")
        for (const key of ["version", "platform", "from", "to"] as const) if (typeof value[key] !== "string" || value[key].length > 128) throw new Error("诊断清单字段无效")
        if (!Number.isFinite(Date.parse(value.from)) || !Number.isFinite(Date.parse(value.to)) || Date.parse(value.from) > Date.parse(value.to)) throw new Error("诊断时间范围无效")
        const declared = new Set<string>()
        for (const item of value.files) {
          if (!item || typeof item.name !== "string" || item.name === "manifest.json" || declared.has(item.name)) throw new Error("诊断清单条目无效")
          declared.add(item.name)
          const found = actual.get(item.name)
          if (!found || found.size !== item.size || found.sha256 !== item.sha256) throw new Error("诊断文件校验失败")
        }
        for (const source of value.sources) if (!source || typeof source.name !== "string" || source.name.length > 128 || !["ok", "missing", "partial"].includes(source.status) || (source.message !== undefined && (typeof source.message !== "string" || source.message.length > 2000))) throw new Error("诊断来源格式无效")
        if (!actual.has("摘要.md") || !actual.has("环境.json")) throw new Error("诊断包缺少摘要或环境信息")
        ended = true; signal.removeEventListener("abort", abort); resolve(value)
      } catch (error) { fail(error) }
    })
    zip.readEntry()
  })
}
