import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  CODE_POSTINGS_SCHEMA_VERSION,
  CODE_POSTINGS_STORAGE_DIR,
  CODE_POSTINGS_STORAGE_VERSION_DIR,
  CODE_POSTINGS_TOKENIZER_VERSION,
} from "../constants"
import type {
  CodeGraphFileGraph,
  CodeGraphLineRange,
  CodePostingsDocument,
  CodePostingsFileRecord,
  CodePostingsFileRecordStatus,
  CodePostingsManifest,
  CodePostingsSearchOptions,
  CodePostingsSearchResult,
  CodePostingsStatusInput,
  CodePostingsStorageStatus,
  CodePostingsTermShard,
  ICodePostingsStorage,
} from "../types"
import { buildPostingsDocument } from "./builder"
import { tokenizeQuery } from "./tokenizer"

const k1 = 1.2
const b = 0.75

export class CodePostingsJsonStorage implements ICodePostingsStorage {
  private manifest?: CodePostingsManifest
  private stage?: CodePostingsManifest
  private old?: CodePostingsManifest
  private schemaMismatch = false
  private tokenizerMismatch = false
  private graphSchemaMismatch = false
  private parserMismatch = false
  private rebuilding = false
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly opts: {
      workspacePath: string
      cacheDirectory: string
      clock?: () => Date
    },
  ) {}

  public async upsertFilePostings(
    filePath: string,
    fileHash: string,
    graph: CodeGraphFileGraph,
    input: { content?: string } = {},
  ): Promise<void> {
    await this.enqueue(async () => {
      if (!this.canWrite()) return
      const rel = this.relative(filePath)
      const manifest = this.active()
      const existing = manifest.records[rel]
      const docPath = this.docPath(existing?.docFile ?? this.docName(rel, manifest.dataGeneration))
      if (existing?.status === "ok" && existing.fileHash === fileHash && existsSync(docPath)) return

      if (existing) await this.removeDoc(rel, existing, manifest)
      const updatedAt = this.now()
      const doc = buildPostingsDocument({
        workspacePath: this.opts.workspacePath,
        graph,
        content: input.content,
        updatedAt,
      })
      await this.atomicJson(docPath, doc)
      for (const term of Object.keys(doc.terms)) {
        await this.upsertTerm(term, rel, doc.terms[term]!, updatedAt, manifest)
      }
      manifest.records[rel] = {
        filePath: rel,
        docFile: this.docName(rel, manifest.dataGeneration),
        fileHash,
        status: "ok",
        documentLength: doc.documentLength,
        updatedAt,
      }
      this.refresh(manifest, updatedAt)
      await this.writeActiveManifest()
    })
  }

  public async removeFilePostings(filePath: string): Promise<void> {
    await this.markFilePostingsStatus(filePath, "stale")
  }

  public async markFilePostingsStatus(
    filePath: string,
    status: Exclude<CodePostingsFileRecordStatus, "ok">,
    input: CodePostingsStatusInput = {},
  ): Promise<void> {
    await this.enqueue(async () => {
      if (!this.canWrite()) return
      const rel = this.relative(filePath)
      const manifest = this.active()
      const existing = manifest.records[rel]
      const docFile = existing?.docFile ?? this.docName(rel, manifest.dataGeneration)
      if (existing) await this.removeDoc(rel, existing, manifest)
      const updatedAt = this.now()
      const record: CodePostingsFileRecord = {
        filePath: rel,
        docFile,
        status,
        updatedAt,
      }
      const hash = input.fileHash ?? existing?.fileHash
      if (hash) record.fileHash = hash
      if (input.error) record.error = input.error.slice(0, 500)
      manifest.records[rel] = record
      this.refresh(manifest, updatedAt)
      await this.writeActiveManifest()
    })
  }

  public async getFilePostings(filePath: string): Promise<CodePostingsDocument | undefined> {
    const rel = this.relative(filePath)
    const staged = this.stage && (await this.readDoc(this.stage, rel))
    if (staged) return staged
    return this.readDoc(this.load(), rel)
  }

  private async readDoc(manifest: CodePostingsManifest, rel: string): Promise<CodePostingsDocument | undefined> {
    const record = manifest.records[rel]
    if (!record || record.status !== "ok") return undefined
    const file = this.docPath(record.docFile)
    if (!existsSync(file)) return undefined
    const doc = JSON.parse(await readFile(file, "utf-8")) as CodePostingsDocument
    if (doc.postingsSchemaVersion !== CODE_POSTINGS_SCHEMA_VERSION) return undefined
    if (doc.tokenizerVersion !== CODE_POSTINGS_TOKENIZER_VERSION) return undefined
    if (doc.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION) return undefined
    if (doc.parserVersion !== CODE_GRAPH_PARSER_VERSION) return undefined
    if (doc.fileHash !== record.fileHash) return undefined
    return doc
  }

  public async listFiles(): Promise<string[]> {
    if (this.status().needsRebuild) return []
    return Object.values(this.load().records)
      .filter((record) => record.status === "ok")
      .map((record) => record.filePath)
      .sort()
  }

  public async search(query: string, options: CodePostingsSearchOptions = {}): Promise<CodePostingsSearchResult[]> {
    if (this.status().needsRebuild) return []
    const terms = tokenizeQuery(query)
    if (!terms.length) return []

    const manifest = this.load()
    const records = Object.values(manifest.records).filter((record) => record.status === "ok")
    const prefix = normalizePrefix(options.directoryPrefix)
    const scoped = prefix ? records.filter((record) => inPrefix(record.filePath, prefix)) : records
    const allowed = new Map(scoped.map((record) => [record.filePath, record]))
    const count = scoped.length
    if (count === 0) return []

    const avg = scoped.reduce((sum, record) => sum + (record.documentLength ?? 1), 0) / count || 1
    const scored = new Map<
      string,
      {
        score: number
        terms: Set<string>
        fields: Set<string>
        ranges: CodePostingsTermShard["documents"][string]["ranges"]
      }
    >()

    for (const term of terms) {
      const shard = await this.term(term, manifest)
      if (!shard) continue
      const docs = Object.values(shard.documents).filter((doc) => {
        const record = allowed.get(doc.filePath)
        return record?.fileHash === doc.fileHash
      })
      if (!docs.length) continue
      const idf = Math.log(1 + (count - docs.length + 0.5) / (docs.length + 0.5))
      for (const doc of docs) {
        const record = allowed.get(doc.filePath)!
        const len = record.documentLength ?? 1
        const tf = doc.weightedFrequency
        const score = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (len / avg))))
        const item =
          scored.get(doc.filePath) ??
          ({
            score: 0,
            terms: new Set<string>(),
            fields: new Set<string>(),
            ranges: [],
          } satisfies {
            score: number
            terms: Set<string>
            fields: Set<string>
            ranges: CodePostingsTermShard["documents"][string]["ranges"]
          })
        item.score += score
        item.terms.add(term)
        for (const field of Object.keys(doc.fields)) item.fields.add(field)
        item.ranges.push(...doc.ranges)
        scored.set(doc.filePath, item)
      }
    }

    const results: CodePostingsSearchResult[] = []
    for (const [filePath, item] of scored) {
      const best = item.ranges.filter(range).sort((left, right) => right.weight - left.weight)[0]
      if (!best) {
        options.diagnostics?.push({
          name: "missing-line-range",
          reason: "bm25 hit omitted from evidence because it has no complete line range",
          filePath,
          kind: "bm25",
          count: 1,
        })
        continue
      }
      const fields = [...item.fields] as CodePostingsSearchResult["fields"]
      const confidence = fields.some((field) => field === "symbol" || field === "macro" || field === "type")
        ? "medium"
        : "low"
      results.push({
        filePath,
        startLine: best.startLine,
        endLine: best.endLine,
        displayName: best.displayName,
        reason: `BM25 lexical match on ${[...item.terms].join(", ")}`,
        confidence,
        score: item.score,
        terms: [...item.terms],
        fields,
        ...(best.shortSnippet ? { shortSnippet: best.shortSnippet } : {}),
      })
    }

    return results.sort((left, right) => right.score - left.score).slice(0, options.maxResults ?? 50)
  }

  public async clear(): Promise<void> {
    await this.enqueue(async () => {
      await rm(this.root, { recursive: true, force: true })
      this.manifest = this.empty()
      this.stage = undefined
      this.old = undefined
      this.schemaMismatch = false
      this.tokenizerMismatch = false
      this.graphSchemaMismatch = false
      this.parserMismatch = false
      this.rebuilding = false
      await this.writeManifest()
    })
  }

  public status(): CodePostingsStorageStatus {
    this.load()
    const rebuild = this.needsRebuild()
    const manifest = rebuild ? this.old ?? this.empty() : this.manifest!
    const records = Object.values(manifest.records)
    const valid = rebuild ? 0 : records.filter((record) => record.status === "ok").length
    return {
      workspacePath: this.opts.workspacePath,
      postingsSchemaVersion: CODE_POSTINGS_SCHEMA_VERSION,
      tokenizerVersion: CODE_POSTINGS_TOKENIZER_VERSION,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      documentCount: rebuild ? 0 : manifest.documentCount,
      recordCount: records.length,
      validFileCount: valid,
      parseErrorCount: records.filter((record) => record.status === "parse_error").length,
      unsupportedCount: records.filter((record) => record.status === "unsupported").length,
      staleCount: records.filter((record) => record.status === "stale").length,
      postingsErrorCount: records.filter((record) => record.status === "postings_error").length,
      schemaMismatch: this.schemaMismatch,
      tokenizerMismatch: this.tokenizerMismatch,
      graphSchemaMismatch: this.graphSchemaMismatch,
      parserMismatch: this.parserMismatch,
      needsRebuild: rebuild,
      updatedAt: manifest.updatedAt,
      lastFullScanAt: rebuild ? undefined : manifest.lastFullScanAt,
      postingsDirectory: this.root,
      diagnostics: manifest.diagnostics,
    }
  }

  public async beginFullScan(): Promise<void> {
    await this.enqueue(async () => {
      this.load()
      this.stage = this.loadStage() ?? this.empty(globalThis.crypto.randomUUID())
      this.schemaMismatch = false
      this.tokenizerMismatch = false
      this.graphSchemaMismatch = false
      this.parserMismatch = false
      this.rebuilding = true
      await this.writeStageManifest()
    })
  }

  public async markFullScanComplete(): Promise<void> {
    await this.enqueue(async () => {
      if (!this.canWrite()) return
      const manifest = this.active()
      const now = this.now()
      manifest.lastFullScanAt = now
      this.refresh(manifest, now)
      await this.writeStageManifest()
      await rename(this.stageManifestPath, this.manifestPath)
      this.manifest = manifest
      this.stage = undefined
      this.rebuilding = false
    })
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async upsertTerm(
    term: string,
    filePath: string,
    doc: CodePostingsTermShard["documents"][string],
    updatedAt: string,
    manifest: CodePostingsManifest,
  ) {
    const shard = (await this.term(term, manifest)) ?? {
      term,
      documents: {},
      updatedAt,
    }
    shard.documents[filePath] = doc
    shard.updatedAt = updatedAt
    await this.atomicJson(this.termPath(term, manifest), shard)
  }

  private async removeDoc(
    filePath: string,
    record: CodePostingsFileRecord,
    manifest: CodePostingsManifest,
  ): Promise<void> {
    const file = this.docPath(record.docFile)
    if (!existsSync(file)) return
    const doc = JSON.parse(await readFile(file, "utf-8")) as CodePostingsDocument
    for (const term of Object.keys(doc.terms)) {
      const shard = await this.term(term, manifest)
      if (!shard) continue
      delete shard.documents[filePath]
      if (Object.keys(shard.documents).length === 0) {
        await this.unlink(this.termPath(term, manifest))
        continue
      }
      shard.updatedAt = this.now()
      await this.atomicJson(this.termPath(term, manifest), shard)
    }
    await this.unlink(file)
  }

  private async term(term: string, manifest: CodePostingsManifest): Promise<CodePostingsTermShard | undefined> {
    const file = this.termPath(term, manifest)
    if (!existsSync(file)) return undefined
    return JSON.parse(await readFile(file, "utf-8")) as CodePostingsTermShard
  }

  private get root() {
    return path.join(this.opts.cacheDirectory, CODE_POSTINGS_STORAGE_DIR, CODE_POSTINGS_STORAGE_VERSION_DIR)
  }

  private get docs() {
    return path.join(this.root, "docs")
  }

  private get terms() {
    return path.join(this.root, "terms")
  }

  private get manifestPath() {
    return path.join(this.root, "manifest.json")
  }

  private get stageManifestPath() {
    return path.join(this.root, "manifest.rebuild.json")
  }

  private canWrite() {
    this.load()
    return !this.needsRebuild() || this.rebuilding
  }

  private needsRebuild() {
    return this.schemaMismatch || this.tokenizerMismatch || this.graphSchemaMismatch || this.parserMismatch
  }

  private load(): CodePostingsManifest {
    if (this.manifest) return this.manifest
    if (!existsSync(this.manifestPath)) {
      this.manifest = this.empty()
      return this.manifest
    }

    const parsed = JSON.parse(readFileSync(this.manifestPath, "utf-8")) as CodePostingsManifest
    if (
      parsed.postingsSchemaVersion !== CODE_POSTINGS_SCHEMA_VERSION ||
      parsed.tokenizerVersion !== CODE_POSTINGS_TOKENIZER_VERSION ||
      parsed.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION ||
      parsed.parserVersion !== CODE_GRAPH_PARSER_VERSION
    ) {
      this.old = parsed
      this.schemaMismatch = parsed.postingsSchemaVersion !== CODE_POSTINGS_SCHEMA_VERSION
      this.tokenizerMismatch = parsed.tokenizerVersion !== CODE_POSTINGS_TOKENIZER_VERSION
      this.graphSchemaMismatch = parsed.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION
      this.parserMismatch = parsed.parserVersion !== CODE_GRAPH_PARSER_VERSION
      this.manifest = this.empty()
      return this.manifest
    }

    this.manifest = {
      workspacePath: parsed.workspacePath || this.opts.workspacePath,
      postingsSchemaVersion: CODE_POSTINGS_SCHEMA_VERSION,
      tokenizerVersion: CODE_POSTINGS_TOKENIZER_VERSION,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      documentCount: parsed.documentCount ?? 0,
      updatedAt: parsed.updatedAt ?? this.now(),
      diagnostics: parsed.diagnostics ?? [],
      ...(parsed.dataGeneration ? { dataGeneration: parsed.dataGeneration } : {}),
      records: parsed.records ?? {},
      ...(parsed.lastFullScanAt ? { lastFullScanAt: parsed.lastFullScanAt } : {}),
    }
    return this.manifest
  }

  private loadStage(): CodePostingsManifest | undefined {
    if (this.stage) return this.stage
    if (!existsSync(this.stageManifestPath)) return undefined
    const parsed = JSON.parse(readFileSync(this.stageManifestPath, "utf-8")) as CodePostingsManifest
    if (
      parsed.postingsSchemaVersion !== CODE_POSTINGS_SCHEMA_VERSION ||
      parsed.tokenizerVersion !== CODE_POSTINGS_TOKENIZER_VERSION ||
      parsed.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION ||
      parsed.parserVersion !== CODE_GRAPH_PARSER_VERSION
    ) {
      return undefined
    }
    this.stage = {
      workspacePath: parsed.workspacePath || this.opts.workspacePath,
      postingsSchemaVersion: CODE_POSTINGS_SCHEMA_VERSION,
      tokenizerVersion: CODE_POSTINGS_TOKENIZER_VERSION,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      dataGeneration: parsed.dataGeneration ?? globalThis.crypto.randomUUID(),
      documentCount: parsed.documentCount ?? 0,
      updatedAt: parsed.updatedAt ?? this.now(),
      diagnostics: parsed.diagnostics ?? [],
      records: parsed.records ?? {},
      ...(parsed.lastFullScanAt ? { lastFullScanAt: parsed.lastFullScanAt } : {}),
    }
    return this.stage
  }

  private active(): CodePostingsManifest {
    if (!this.rebuilding) return this.load()
    const stage = this.loadStage()
    if (stage) return stage
    this.stage = this.empty(globalThis.crypto.randomUUID())
    return this.stage
  }

  private empty(dataGeneration?: string): CodePostingsManifest {
    return {
      workspacePath: this.opts.workspacePath,
      postingsSchemaVersion: CODE_POSTINGS_SCHEMA_VERSION,
      tokenizerVersion: CODE_POSTINGS_TOKENIZER_VERSION,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      documentCount: 0,
      updatedAt: this.now(),
      diagnostics: [],
      ...(dataGeneration ? { dataGeneration } : {}),
      records: {},
    }
  }

  private refresh(manifest: CodePostingsManifest, updatedAt: string): void {
    manifest.documentCount = Object.values(manifest.records).filter((record) => record.status === "ok").length
    manifest.updatedAt = updatedAt
  }

  private relative(filePath: string) {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(this.opts.workspacePath, filePath)
    const rel = path.relative(this.opts.workspacePath, abs)
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return filePath.replace(/\\/g, "/")
    return rel.split(path.sep).join("/")
  }

  private docName(filePath: string, dataGeneration?: string) {
    const file = `${digest(filePath)}.json`
    return dataGeneration ? path.join("docs", dataGeneration, file) : file
  }

  private docPath(file: string) {
    if (file.includes("/") || file.includes("\\")) return path.join(this.root, file)
    return path.join(this.docs, file)
  }

  private termPath(term: string, manifest: CodePostingsManifest) {
    const sum = digest(term)
    if (manifest.dataGeneration) {
      return path.join(this.root, "terms", manifest.dataGeneration, sum.slice(0, 2), `${sum}.json`)
    }
    return path.join(this.terms, sum.slice(0, 2), `${sum}.json`)
  }

  private now() {
    return (this.opts.clock?.() ?? new Date()).toISOString()
  }

  private async writeManifest() {
    await this.atomicJson(this.manifestPath, this.load())
  }

  private async writeStageManifest() {
    await this.atomicJson(this.stageManifestPath, this.active())
  }

  private async writeActiveManifest() {
    if (this.rebuilding) {
      await this.writeStageManifest()
      return
    }
    await this.writeManifest()
  }

  private async atomicJson(file: string, value: unknown) {
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${globalThis.crypto.randomUUID()}.tmp`
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
    await rename(tmp, file)
  }

  private async unlink(file: string) {
    try {
      await unlink(file)
    } catch (err) {
      const code = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined
      if (code !== "ENOENT") throw err
    }
  }
}

function normalizePrefix(input?: string) {
  if (!input) return undefined
  return input.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "")
}

function inPrefix(filePath: string, prefix: string) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`)
}

function range(item: Partial<CodeGraphLineRange>): item is CodeGraphLineRange {
  return Number.isFinite(item.startLine) && Number.isFinite(item.endLine) && item.startLine! > 0 && item.endLine! >= item.startLine!
}

function digest(value: string): string {
  return `${fnv(value, 0x811c9dc5)}${fnv(value, 0x45d9f3b)}`
}

function fnv(value: string, seed: number): string {
  let hash = seed
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
