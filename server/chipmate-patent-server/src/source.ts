import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import type { Jurisdiction, SourceManifest } from "./contracts.js"
import { isJurisdiction } from "./contracts.js"

const ARCHIVE = /\.(?:zip|tar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz)$/i
const CONTENT = /\.(?:xml|jsonl|ndjson|json)(?:\.gz)?$/i

export async function loadManifest(file: string): Promise<SourceManifest> {
  const sidecar = `${file}.manifest.json`
  const body = await fs
    .readFile(sidecar, "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
      return inferManifest(file)
    })
  return validateManifest(body)
}

export async function* contentStreams(
  file: string,
  manifest?: SourceManifest,
): AsyncGenerator<{ name: string; stream: Readable; records?: number }> {
  const lower = file.toLowerCase()
  if (ARCHIVE.test(lower)) {
    const entries = (await command("bsdtar", ["-tf", file]))
      .split("\n")
      .map((item) => item.trim())
      .filter((item) => item && CONTENT.test(item))
    if (!entries.length) throw new Error("归档中没有可识别的 XML/JSON/JSONL 数据文件")
    const declared = new Map(manifest?.files?.map((item) => [path.posix.normalize(item.path), item]) ?? [])
    if (declared.size) {
      const found = new Set(entries.map((entry) => path.posix.normalize(entry)))
      const missing = [...declared.keys()].filter((entry) => !found.has(entry))
      if (missing.length) throw new Error(`manifest 声明的归档文件不存在：${missing.slice(0, 10).join(", ")}`)
      const undeclared = entries.filter((entry) => !declared.has(path.posix.normalize(entry)))
      if (undeclared.length)
        throw new Error(`归档包含 manifest 未声明的数据文件：${undeclared.slice(0, 10).join(", ")}`)
    }
    for (const entry of entries) {
      assertEntry(entry)
      const metadata = declared.get(path.posix.normalize(entry))
      const stream = childStream("bsdtar", ["-xOf", file, entry])
      yield {
        name: entry,
        stream: metadata?.sha256 ? verifying(stream, metadata.sha256, entry) : stream,
        ...(metadata?.records !== undefined ? { records: metadata.records } : {}),
      }
    }
    return
  }
  if (lower.endsWith(".gz")) {
    yield { name: path.basename(file, ".gz"), stream: childStream("gzip", ["-dc", file]) }
    return
  }
  if (!CONTENT.test(lower)) throw new Error(`不支持的数据包格式：${path.basename(file)}`)
  yield {
    name: path.basename(file),
    stream: Readable.fromWeb((await fs.open(file, "r")).readableWebStream({ autoClose: true })),
  }
}

function inferManifest(file: string): SourceManifest {
  const filename = path.basename(file)
  const upper = filename.toUpperCase()
  const jurisdiction = upper.match(/(?:^|[-_.])(CN|JP|KR|US|EP|RU)(?:[-_.]|$)/)?.[1]
  if (!isJurisdiction(jurisdiction)) {
    throw new Error(`无法从文件名识别地区，请提供 ${filename}.manifest.json`)
  }
  const stem = filename
    .replace(/\.(?:zip|tar|gz|tgz|bz2|tbz2|xz|txz|xml|jsonl|ndjson|json)+$/gi, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 160)
  const dates = upper.match(/(?:19|20)\d{6}|(?:19|20)\d{2}[-_.]?\d{2}[-_.]?\d{2}/g) ?? []
  const periodStart = dates[0] ? normalizeDate(dates[0]) : undefined
  const periodEnd = dates[1] ? normalizeDate(dates[1]) : periodStart
  const dataType = /LEGAL|STATUS|LAW/.test(upper)
    ? "legal-status"
    : /CITATION|CITE/.test(upper)
      ? "citation"
      : /BIB|BIBLIO/.test(upper)
        ? "bibliographic"
        : /FULL|CLAIM|DESC/.test(upper)
          ? "fulltext"
          : "mixed"
  return {
    schemaVersion: 1,
    source: "CNIPA",
    jurisdiction,
    batchId: `CNIPA-${jurisdiction}-${stem}`,
    dataType,
    coverageScope: "supplemental",
    ...(periodStart ? { periodStart } : {}),
    ...(periodEnd ? { periodEnd } : {}),
  }
}

function validateManifest(value: unknown): SourceManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("数据包 manifest 必须是对象")
  const item = value as Record<string, unknown>
  if (item.schemaVersion !== 1 || item.source !== "CNIPA" || !isJurisdiction(item.jurisdiction)) {
    throw new Error("数据包 manifest 的 schemaVersion、source 或 jurisdiction 无效")
  }
  if (typeof item.batchId !== "string" || !/^[a-zA-Z0-9._-]{3,200}$/.test(item.batchId)) {
    throw new Error("数据包 manifest.batchId 无效")
  }
  const types = ["fulltext", "bibliographic", "legal-status", "citation", "mixed"]
  if (typeof item.dataType !== "string" || !types.includes(item.dataType))
    throw new Error("数据包 manifest.dataType 无效")
  const manifest: SourceManifest = {
    schemaVersion: 1,
    source: "CNIPA",
    jurisdiction: item.jurisdiction,
    batchId: item.batchId,
    dataType: item.dataType as SourceManifest["dataType"],
    coverageScope: "supplemental",
  }
  if (item.coverageScope !== undefined) {
    const scopes = ["historical-baseline", "incremental", "supplemental"]
    if (typeof item.coverageScope !== "string" || !scopes.includes(item.coverageScope)) {
      throw new Error("数据包 manifest.coverageScope 无效")
    }
    manifest.coverageScope = item.coverageScope as NonNullable<SourceManifest["coverageScope"]>
  }
  if (item.sequence !== undefined) {
    if (!Number.isSafeInteger(item.sequence) || Number(item.sequence) < 0) throw new Error("manifest.sequence 无效")
    manifest.sequence = Number(item.sequence)
  }
  if (item.periodStart !== undefined) manifest.periodStart = checkedDate(item.periodStart, "periodStart")
  if (item.periodEnd !== undefined) manifest.periodEnd = checkedDate(item.periodEnd, "periodEnd")
  if (item.declaredRecords !== undefined) {
    if (!Number.isSafeInteger(item.declaredRecords) || Number(item.declaredRecords) < 0) {
      throw new Error("manifest.declaredRecords 无效")
    }
    manifest.declaredRecords = Number(item.declaredRecords)
  }
  if (item.files !== undefined) {
    if (!Array.isArray(item.files) || item.files.length === 0) throw new Error("manifest.files 必须是非空数组")
    const names = new Set<string>()
    manifest.files = item.files.map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`manifest.files[${index}] 无效`)
      const file = value as Record<string, unknown>
      if (typeof file.path !== "string") throw new Error(`manifest.files[${index}].path 无效`)
      assertEntry(file.path)
      const normalized = path.posix.normalize(file.path)
      if (names.has(normalized)) throw new Error(`manifest.files 包含重复路径：${normalized}`)
      names.add(normalized)
      const output: NonNullable<SourceManifest["files"]>[number] = { path: normalized }
      if (file.sha256 !== undefined) {
        if (typeof file.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(file.sha256)) {
          throw new Error(`manifest.files[${index}].sha256 无效`)
        }
        output.sha256 = file.sha256.toLowerCase()
      }
      if (file.records !== undefined) {
        if (!Number.isSafeInteger(file.records) || Number(file.records) < 0) {
          throw new Error(`manifest.files[${index}].records 无效`)
        }
        output.records = Number(file.records)
      }
      return output
    })
  }
  return manifest
}

function checkedDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`manifest.${field} 无效`)
  }
  return value
}

function normalizeDate(value: string): string | undefined {
  const digits = value.replace(/\D/g, "")
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : undefined
}

function assertEntry(entry: string): void {
  const normalized = path.posix.normalize(entry)
  if (entry.includes("\0") || path.posix.isAbsolute(entry) || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`归档包含不安全路径：${entry}`)
  }
}

function childStream(commandName: string, args: string[]): Readable {
  const child = spawn(commandName, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  const stderr: Buffer[] = []
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
  child.once("error", (error) => child.stdout.destroy(error))
  child.once("close", (code) => {
    if (code !== 0)
      child.stdout.destroy(new Error(`${commandName} 失败：${Buffer.concat(stderr).toString("utf8").slice(0, 1_000)}`))
  })
  return child.stdout
}

function verifying(source: Readable, expected: string, name: string): Readable {
  const hash = createHash("sha256")
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
    final(callback) {
      const actual = hash.digest("hex")
      callback(actual === expected ? undefined : new Error(`归档文件 ${name} 的 SHA-256 不匹配：${actual}`))
    },
  })
  source.pipe(transform)
  return transform
}

async function command(commandName: string, args: string[]): Promise<string> {
  const child = spawn(commandName, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (value) => resolve(value ?? 1))
  })
  if (code !== 0) throw new Error(`${commandName} 失败：${Buffer.concat(stderr).toString("utf8").slice(0, 1_000)}`)
  return Buffer.concat(stdout).toString("utf8")
}

export function manifestForTest(jurisdiction: Jurisdiction, batchId: string): SourceManifest {
  return {
    schemaVersion: 1,
    source: "CNIPA",
    jurisdiction,
    batchId,
    dataType: "mixed",
    coverageScope: "supplemental",
  }
}
