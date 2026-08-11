import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { once } from "node:events"
import path from "node:path"
import { createInterface } from "node:readline"
import { encodeBoundedJson } from "../bounded-json"
import { cleanupRoot, emptyCleanupStats, list, rel as relpath, removeSafe } from "../../cleanup"
import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  CODE_POSTINGS_SCHEMA_VERSION,
  CODE_POSTINGS_STORAGE_DIR,
  CODE_POSTINGS_STORAGE_VERSION_DIR,
  CODE_POSTINGS_TOKENIZER_VERSION,
} from "../constants"
import type { IndexingCleanupStats, IndexingCompatibilityDecision } from "../../interfaces/cleanup"
import { Log } from "../../../util/log"
import type {
  CodeGraphFileGraph,
  CodeGraphLineRange,
  CodeGraphShardPartInfo,
  CodePostingsDocument,
  CodePostingsFileRecord,
  CodePostingsFileRecordStatus,
  CodePostingsManifest,
  CodePostingsSearchOptions,
  CodePostingsSearchResult,
  CodePostingsStatusInput,
  CodePostingsStorageStatus,
  CodePostingsTermDocument,
  ICodePostingsStorage,
} from "../types"
import { copy, dict, own } from "../dict"
import { buildPostingsDocument } from "./builder"
import { tokenizeQuery } from "./tokenizer"
import { normalizeWorkspace, workspaceKey } from "../../workspace-key"

const k1 = 1.2
const b = 0.75
const bucketCount = 64
const rangeChunk = 512
const cacheLimit = 64 * 1024 * 1024
const log = Log.create({ service: "codepostings-storage" })
type ScanState = "never" | "interrupted" | "complete" | "needs-rebuild"

type TermLine = {
  term: string
  document: CodePostingsTermDocument
}

type DocHeader = Omit<CodePostingsDocument, "terms">

export class CodePostingsJsonStorage implements ICodePostingsStorage {
  private readonly workspace: string
  private readonly key: string
  private manifest?: CodePostingsManifest
  private stage?: CodePostingsManifest
  private old?: CodePostingsManifest
  private seen?: Set<string>
  private readonly cache = new Map<string, { doc: CodePostingsDocument; bytes: number }>()
  private readonly loads = new Map<string, Promise<CodePostingsDocument | undefined>>()
  private cacheBytes = 0
  private schemaMismatch = false
  private tokenizerMismatch = false
  private graphSchemaMismatch = false
  private parserMismatch = false
  private invalid = false
  private rebuilding = false
  private queue: Promise<void> = Promise.resolve()
  private checkpointFiles = 0
  private checkpointAt = 0
  private migrated = false
  private scan?: ScanState

  constructor(
    private readonly opts: {
      workspacePath: string
      cacheDirectory: string
      clock?: () => Date
    },
  ) {
    this.workspace = normalizeWorkspace(opts.workspacePath)
    this.key = workspaceKey(this.workspace)
  }

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
      const existing = own(manifest.records, rel)
      if (existing?.status === "ok" && existing.fileHash === fileHash && (await this.doc(existing))) {
        this.markSeen(rel)
        return
      }

      if (!this.rebuilding) manifest.dataGeneration = globalThis.crypto.randomUUID()
      const updatedAt = this.now()
      const doc = buildPostingsDocument({
        workspacePath: this.opts.workspacePath,
        graph: { ...graph, filePath: rel, fileHash },
        content: input.content,
        updatedAt,
      })
      const record: CodePostingsFileRecord = {
        filePath: rel,
        docFile: this.docName(rel, manifest.dataGeneration),
        fileHash,
        status: "ok",
        documentLength: doc.documentLength,
        updatedAt,
      }
      record.docParts = [await this.writeDoc(record.docFile, doc)]
      manifest.records[rel] = record
      this.remember(record, doc)
      this.markSeen(rel)
      this.refresh(manifest, updatedAt)
      if (this.rebuilding) await this.checkpoint(manifest)
      else await this.commitActive(manifest, doc)
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
      const existing = own(manifest.records, rel)
      const updatedAt = this.now()
      const record: CodePostingsFileRecord = {
        filePath: rel,
        docFile: existing?.docFile ?? this.docName(rel, manifest.dataGeneration),
        status,
        updatedAt,
      }
      const hash = input.fileHash ?? existing?.fileHash
      if (hash) record.fileHash = hash
      if (input.error) record.error = input.error.slice(0, 500)
      manifest.records[rel] = record
      this.forget(existing)
      if (status !== "stale") this.markSeen(rel)
      this.refresh(manifest, updatedAt)
      if (this.rebuilding) await this.checkpoint(manifest)
      else await this.commitActive(manifest)
    })
  }

  public async getFilePostings(filePath: string): Promise<CodePostingsDocument | undefined> {
    const rel = this.relative(filePath)
    const staged = this.rebuilding ? this.stage : undefined
    const record = staged ? own(staged.records, rel) : own(this.load().records, rel)
    if (!record || record.status !== "ok") return undefined
    return this.doc(record)
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
    const queryTerms = tokenizeQuery(query)
    if (!queryTerms.length) return []

    const manifest = this.load()
    const records = Object.values(manifest.records).filter((record) => record.status === "ok")
    const prefix = normalizePrefix(options.directoryPrefix)
    const scoped = prefix ? records.filter((record) => inPrefix(record.filePath, prefix)) : records
    const allowed = new Map(scoped.map((record) => [record.filePath, record]))
    const count = scoped.length
    if (count === 0) return []

    const terms = await this.terms(manifest, queryTerms)
    const avg = scoped.reduce((sum, record) => sum + (record.documentLength ?? 1), 0) / count || 1
    const scored = new Map<
      string,
      {
        score: number
        terms: Set<string>
        fields: Set<string>
        ranges: CodePostingsTermDocument["ranges"]
      }
    >()

    for (const term of queryTerms) {
      const docs = (terms[term] ?? []).filter((doc) => {
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
        const item = scored.get(doc.filePath) ?? {
          score: 0,
          terms: new Set<string>(),
          fields: new Set<string>(),
          ranges: [],
        }
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
      this.migrated = true
      await rm(this.root, { recursive: true, force: true })
      this.manifest = this.empty()
      this.stage = undefined
      this.old = undefined
      this.seen = undefined
      this.clearCache()
      this.schemaMismatch = false
      this.tokenizerMismatch = false
      this.graphSchemaMismatch = false
      this.parserMismatch = false
      this.invalid = false
      this.rebuilding = false
      await this.writeManifest()
      this.scan = "never"
    })
  }

  public async ensureCompatible(): Promise<IndexingCompatibilityDecision> {
    return this.enqueue(async () => {
      await this.migrateLegacy()
      const manifest = this.readManifestFile(this.manifestPath)
      const decision = this.compatibility(manifest)
      log.info("Code Postings compatibility check", {
        visible: true,
        workspacePath: this.opts.workspacePath,
        action: decision.action,
        reason: decision.reason,
      })
      if (decision.action === "reuse") return decision
      await rm(this.root, { recursive: true, force: true })
      this.manifest = this.empty()
      this.stage = undefined
      this.old = undefined
      this.clearCache()
      this.schemaMismatch = false
      this.tokenizerMismatch = false
      this.graphSchemaMismatch = false
      this.parserMismatch = false
      this.invalid = false
      this.rebuilding = false
      await this.writeManifest()
      this.scan = "never"
      return decision
    })
  }

  public status(): CodePostingsStorageStatus {
    this.load()
    const scan = this.getScanState()
    const rebuild = this.needsRebuild() || scan === "needs-rebuild"
    const manifest = rebuild ? (this.old ?? this.empty()) : this.manifest!
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
      lastFullScanAt: rebuild || scan !== "complete" ? undefined : manifest.lastFullScanAt,
      postingsDirectory: this.root,
      diagnostics: manifest.diagnostics,
    }
  }

  public getScanState(): ScanState {
    if (this.scan) return this.scan
    if (existsSync(this.stageManifestPath)) {
      const stage = this.readManifestFile(this.stageManifestPath)
      this.scan = !stage || this.compatibility(stage).action === "rebuild" ? "needs-rebuild" : "interrupted"
      return this.scan
    }
    if (!existsSync(this.manifestPath)) {
      this.scan = "never"
      return this.scan
    }
    const manifest = this.readManifestFile(this.manifestPath)
    if (!manifest || this.compatibility(manifest).action === "rebuild") {
      this.scan = "needs-rebuild"
      return this.scan
    }
    this.scan = manifest.lastFullScanAt ? "complete" : "never"
    return this.scan
  }

  public async beginFullScan(): Promise<void> {
    await this.enqueue(async () => {
      this.scan = undefined
      await this.migrateLegacy()
      const current = this.load()
      this.stage =
        this.loadStage() ?? (this.needsRebuild() ? this.empty(globalThis.crypto.randomUUID()) : this.scanBase(current))
      this.stage.dataGeneration ??= globalThis.crypto.randomUUID()
      this.seen = new Set()
      this.checkpointFiles = 0
      this.checkpointAt = Date.now()
      this.clearCache()
      this.schemaMismatch = false
      this.tokenizerMismatch = false
      this.graphSchemaMismatch = false
      this.parserMismatch = false
      this.invalid = false
      this.rebuilding = true
      await this.writeStageManifest()
      this.scan = "interrupted"
    })
  }

  public async markFullScanComplete(): Promise<void> {
    await this.enqueue(async () => {
      if (!this.canWrite()) return
      const manifest = this.active()
      const now = this.now()
      this.pruneUnseen(manifest)
      manifest.lastFullScanAt = now
      this.refresh(manifest, now)
      await this.commit(manifest, this.stageManifestPath)
      await rename(this.stageManifestPath, this.manifestPath)
      this.manifest = manifest
      this.stage = undefined
      this.seen = undefined
      this.clearCache()
      this.rebuilding = false
      this.scan = "complete"
      await this.cleanupOldGenerations()
    })
  }

  public async cleanupAbandonedArtifacts(): Promise<IndexingCleanupStats> {
    return this.enqueue(async () => {
      const stats = emptyCleanupStats()
      const root = await cleanupRoot(this.root, stats, "codepostings")
      if (!root) return stats

      const manifest = this.readManifestFile(this.manifestPath)
      const stage = this.readManifestFile(this.stageManifestPath)
      if (manifest?.workspacePath && normalizeWorkspace(manifest.workspacePath) !== this.workspace) {
        stats.skipped.push("codepostings: active manifest workspace mismatch")
        return stats
      }
      if (stage?.workspacePath && normalizeWorkspace(stage.workspacePath) !== this.workspace) {
        stats.skipped.push("codepostings: rebuild manifest workspace mismatch")
        return stats
      }

      if (!manifest && !stage) return stats

      const keep = new Set([
        ...[manifest, stage].flatMap((item) => (item?.docParts ?? []).map((part) => normalize(part.path))),
        ...[manifest, stage].flatMap((item) => (item?.termParts ?? []).map((part) => normalize(part.path))),
      ])
      await this.cleanupDir(this.docs, root, keep, undefined, stats, "docs")
      await this.cleanupDir(this.termsDir, root, keep, undefined, stats, "terms")
      return stats
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

  private async doc(record: CodePostingsFileRecord): Promise<CodePostingsDocument | undefined> {
    if (record.status !== "ok" || !record.docParts?.length) return undefined
    const key = record.docParts.map((part) => part.path).join("\0")
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached.doc
    }
    const active = this.loads.get(key)
    if (active) return active
    const load = this.readDoc(record).finally(() => this.loads.delete(key))
    this.loads.set(key, load)
    return load
  }

  private async readDoc(record: CodePostingsFileRecord): Promise<CodePostingsDocument | undefined> {
    const part = record.docParts?.[0]
    if (!part) return undefined
    const lines = createInterface({ input: createReadStream(path.join(this.root, part.path)), crlfDelay: Infinity })
    let header: DocHeader | undefined
    const terms = dict<CodePostingsTermDocument>()
    for await (const line of lines) {
      if (!line) continue
      const value = JSON.parse(line) as { header?: DocHeader } | TermLine
      if ("header" in value) {
        header = value.header
        continue
      }
      const entry = value as TermLine
      const item = normalizeTerm(entry.document)
      const current = terms[entry.term]
      terms[entry.term] = current ? { ...current, ranges: [...current.ranges, ...item.ranges] } : item
    }
    if (!header || header.fileHash !== record.fileHash) return undefined
    if (
      header.postingsSchemaVersion !== CODE_POSTINGS_SCHEMA_VERSION ||
      header.tokenizerVersion !== CODE_POSTINGS_TOKENIZER_VERSION ||
      header.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION ||
      header.parserVersion !== CODE_GRAPH_PARSER_VERSION
    ) {
      return undefined
    }
    const doc = normalizeDoc({ ...header, terms })
    this.remember(record, doc)
    return doc
  }

  private async terms(
    manifest: CodePostingsManifest,
    query: string[],
  ): Promise<Record<string, CodePostingsTermDocument[]>> {
    const wanted = new Set(query)
    const keys = new Set(query.map(bucket))
    const terms = dict<CodePostingsTermDocument[]>()
    const merged = new Map<string, CodePostingsTermDocument>()
    for (const part of manifest.termParts ?? []) {
      if (!keys.has(part.key)) continue
      const lines = createInterface({ input: createReadStream(path.join(this.root, part.path)), crlfDelay: Infinity })
      for await (const line of lines) {
        if (!line) continue
        const value = JSON.parse(line) as TermLine
        if (!wanted.has(value.term)) continue
        const item = normalizeTerm(value.document)
        const active = manifest.records[item.filePath]
        if (active?.status !== "ok" || active.fileHash !== item.fileHash) continue
        const key = `${value.term}\0${item.filePath}`
        const current = merged.get(key)
        merged.set(key, current ? { ...current, ranges: [...current.ranges, ...item.ranges] } : item)
      }
    }
    for (const [key, doc] of merged) {
      const term = key.slice(0, key.indexOf("\0"))
      const docs = terms[term] ?? []
      docs.push(doc)
      terms[term] = docs
    }
    return terms
  }

  private async commitActive(manifest: CodePostingsManifest, doc?: CodePostingsDocument): Promise<void> {
    if (doc) {
      manifest.termParts = [
        ...(manifest.termParts ?? []),
        ...(await this.writeTermDeltas(doc, manifest.dataGeneration!)),
      ]
    }
    manifest.docParts = Object.values(manifest.records).flatMap((record) => record.docParts ?? [])
    await this.atomicJson(this.manifestPath, manifest)
    this.manifest = manifest
    await this.cleanupOldGenerations()
  }

  private async checkpoint(manifest: CodePostingsManifest): Promise<void> {
    this.checkpointFiles += 1
    const now = Date.now()
    if (this.checkpointFiles < 64 && now - this.checkpointAt < 2_000) return
    manifest.docParts = Object.values(manifest.records).flatMap((record) => record.docParts ?? [])
    await this.writeStageManifest()
    this.checkpointFiles = 0
    this.checkpointAt = now
  }

  private async writeTermDeltas(doc: CodePostingsDocument, generation: string): Promise<CodeGraphShardPartInfo[]> {
    const dir = path.join(this.termsDir, generation)
    await mkdir(dir, { recursive: true })
    const streams = new Map<string, ReturnType<typeof createWriteStream>>()
    const stats = new Map<string, { entries: number; bytes: number }>()
    for (const [term, item] of Object.entries(doc.terms)) {
      for (const chunk of chunks(item.ranges)) {
        const value: TermLine = { term, document: { ...item, ranges: chunk } }
        const line = `${JSON.stringify(value)}\n`
        const key = bucket(term)
        const stream = streams.get(key) ?? createWriteStream(path.join(dir, `${key}.jsonl`), { encoding: "utf-8" })
        streams.set(key, stream)
        await append(stream, line)
        const current = stats.get(key) ?? { entries: 0, bytes: 0 }
        current.entries += 1
        current.bytes += Buffer.byteLength(line)
        stats.set(key, current)
      }
    }
    await Promise.all([...streams.values()].map(finish))
    return [...stats].map(([key, value]) => ({
      key,
      path: `terms/${generation}/${key}.jsonl`,
      entries: value.entries,
      estimatedBytes: value.bytes,
    }))
  }

  private async commit(manifest: CodePostingsManifest, file: string): Promise<void> {
    const generation = globalThis.crypto.randomUUID()
    manifest.dataGeneration = generation
    const dir = path.join(this.termsDir, generation)
    await mkdir(dir, { recursive: true })
    const streams = new Map<string, ReturnType<typeof createWriteStream>>()
    const stats = new Map<string, { entries: number; bytes: number }>()
    for (const [rel, record] of Object.entries(manifest.records)) {
      if (record.status !== "ok") continue
      const doc = await this.doc(record)
      if (!doc) {
        delete manifest.records[rel]
        continue
      }
      record.fileHash = doc.fileHash
      record.documentLength = doc.documentLength
      for (const [term, item] of Object.entries(doc.terms)) {
        for (const chunk of chunks(item.ranges)) {
          const value: TermLine = { term, document: { ...item, ranges: chunk } }
          const line = `${JSON.stringify(value)}\n`
          const key = bucket(term)
          const stream = streams.get(key) ?? createWriteStream(path.join(dir, `${key}.jsonl`), { encoding: "utf-8" })
          streams.set(key, stream)
          await append(stream, line)
          const current = stats.get(key) ?? { entries: 0, bytes: 0 }
          current.entries += 1
          current.bytes += Buffer.byteLength(line)
          stats.set(key, current)
        }
      }
    }
    await Promise.all([...streams.values()].map(finish))
    manifest.docParts = Object.values(manifest.records).flatMap((record) => record.docParts ?? [])
    manifest.termParts = [...stats]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({
        key,
        path: `terms/${generation}/${key}.jsonl`,
        entries: value.entries,
        estimatedBytes: value.bytes,
      }))
    this.refresh(manifest, manifest.updatedAt)
    await this.atomicJson(file, manifest)
  }

  private async migrateLegacy(): Promise<void> {
    if (this.migrated) return
    this.migrated = true
    if (!existsSync(this.legacyRoot)) return
    log.warn("legacy shared Code Postings cache retained and ignored", {
      visible: true,
      workspacePath: this.opts.workspacePath,
      reason: "workspace-isolated storage requires a fresh scan",
    })
  }

  private get root() {
    return path.join(this.opts.cacheDirectory, CODE_POSTINGS_STORAGE_DIR, this.key, CODE_POSTINGS_STORAGE_VERSION_DIR)
  }

  private get legacyRoot() {
    return path.join(this.opts.cacheDirectory, CODE_POSTINGS_STORAGE_DIR, CODE_POSTINGS_STORAGE_VERSION_DIR)
  }

  private get docs() {
    return path.join(this.root, "docs")
  }

  private get termsDir() {
    return path.join(this.root, "terms")
  }

  private get manifestPath() {
    return path.join(this.root, "manifest.json")
  }

  private get stageManifestPath() {
    return path.join(this.root, "manifest.rebuild.json")
  }

  private canWrite(): boolean {
    this.load()
    return !this.needsRebuild() || this.rebuilding
  }

  private needsRebuild(): boolean {
    return (
      this.invalid || this.schemaMismatch || this.tokenizerMismatch || this.graphSchemaMismatch || this.parserMismatch
    )
  }

  private markSeen(rel: string): void {
    if (this.rebuilding) this.seen?.add(rel)
  }

  private pruneUnseen(manifest: CodePostingsManifest): void {
    if (!this.rebuilding || !this.seen) return
    for (const rel of Object.keys(manifest.records)) {
      if (this.seen.has(rel)) continue
      this.forget(manifest.records[rel])
      delete manifest.records[rel]
    }
  }

  private load(): CodePostingsManifest {
    if (this.manifest) return this.manifest
    if (!existsSync(this.manifestPath)) {
      this.manifest = this.empty()
      return this.manifest
    }

    const parsed = this.readManifestFile(this.manifestPath)
    if (!parsed) {
      this.invalid = true
      this.manifest = this.empty()
      return this.manifest
    }
    if (parsed.workspacePath && normalizeWorkspace(parsed.workspacePath) !== this.workspace) {
      this.manifest = this.empty()
      return this.manifest
    }
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
      ...(parsed.lastFullScanAt ? { lastFullScanAt: parsed.lastFullScanAt } : {}),
      records: copy(parsed.records),
      docParts: parsed.docParts ?? [],
      termParts: parsed.termParts ?? [],
    }
    return this.manifest
  }

  private loadStage(): CodePostingsManifest | undefined {
    if (this.stage) return this.stage
    if (!existsSync(this.stageManifestPath)) return undefined
    const parsed = this.readManifestFile(this.stageManifestPath)
    if (!parsed) return undefined
    if (parsed.workspacePath && normalizeWorkspace(parsed.workspacePath) !== this.workspace) return undefined
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
      records: copy(parsed.records),
      docParts: parsed.docParts ?? [],
      termParts: parsed.termParts ?? [],
      ...(parsed.lastFullScanAt ? { lastFullScanAt: parsed.lastFullScanAt } : {}),
    }
    return this.stage
  }

  private readManifestFile(file: string): CodePostingsManifest | undefined {
    if (!existsSync(file)) return undefined
    try {
      return JSON.parse(readFileSync(file, "utf-8")) as CodePostingsManifest
    } catch (err) {
      void err
      return undefined
    }
  }

  private compatibility(manifest: CodePostingsManifest | undefined, root = this.root): IndexingCompatibilityDecision {
    if (!manifest) return { action: "rebuild", reason: "missing compatibility metadata" }
    if (!manifest.workspacePath) return { action: "rebuild", reason: "missing compatibility metadata" }
    if (normalizeWorkspace(manifest.workspacePath) !== this.workspace)
      return { action: "rebuild", reason: "workspace mismatch" }
    if (manifest.postingsSchemaVersion !== CODE_POSTINGS_SCHEMA_VERSION)
      return { action: "rebuild", reason: "schema mismatch" }
    if (manifest.tokenizerVersion !== CODE_POSTINGS_TOKENIZER_VERSION)
      return { action: "rebuild", reason: "tokenizer mismatch" }
    if (manifest.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION)
      return { action: "rebuild", reason: "graph schema mismatch" }
    if (manifest.parserVersion !== CODE_GRAPH_PARSER_VERSION) return { action: "rebuild", reason: "parser mismatch" }
    if (
      !manifest.records ||
      typeof manifest.records !== "object" ||
      Array.isArray(manifest.records) ||
      typeof manifest.documentCount !== "number" ||
      !Array.isArray(manifest.diagnostics)
    ) {
      return { action: "rebuild", reason: "missing compatibility metadata" }
    }
    if (!Array.isArray(manifest.docParts) || !Array.isArray(manifest.termParts)) {
      return { action: "rebuild", reason: "storage layout changed" }
    }
    for (const record of Object.values(manifest.records)) {
      if (record.status !== "ok") continue
      if (!Array.isArray(record.docParts) || record.docParts.length === 0) {
        return { action: "rebuild", reason: "storage layout changed" }
      }
    }
    for (const part of [...manifest.docParts, ...manifest.termParts]) {
      if (!existsSync(path.join(root, part.path))) return { action: "rebuild", reason: "missing postings sidecar" }
    }
    return { action: "reuse", reason: "compatible" }
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
      records: dict(),
      docParts: [],
      termParts: [],
    }
  }

  private clone(manifest: CodePostingsManifest): CodePostingsManifest {
    return {
      workspacePath: manifest.workspacePath || this.opts.workspacePath,
      postingsSchemaVersion: CODE_POSTINGS_SCHEMA_VERSION,
      tokenizerVersion: CODE_POSTINGS_TOKENIZER_VERSION,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      documentCount: manifest.documentCount ?? 0,
      updatedAt: manifest.updatedAt ?? this.now(),
      diagnostics: [...(manifest.diagnostics ?? [])],
      ...(manifest.dataGeneration ? { dataGeneration: manifest.dataGeneration } : {}),
      ...(manifest.lastFullScanAt ? { lastFullScanAt: manifest.lastFullScanAt } : {}),
      records: copy(structuredClone(manifest.records ?? {})),
      docParts: structuredClone(manifest.docParts ?? []),
      termParts: structuredClone(manifest.termParts ?? []),
    }
  }

  private scanBase(manifest: CodePostingsManifest): CodePostingsManifest {
    if (!manifest.dataGeneration && Object.keys(manifest.records ?? {}).length === 0) {
      return this.empty(globalThis.crypto.randomUUID())
    }
    return this.clone(manifest)
  }

  private refresh(manifest: CodePostingsManifest, updatedAt: string): void {
    manifest.documentCount = Object.values(manifest.records).filter((record) => record.status === "ok").length
    manifest.updatedAt = updatedAt
  }

  private relative(filePath: string): string {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(this.opts.workspacePath, filePath)
    const rel = path.relative(this.opts.workspacePath, abs)
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return filePath.replace(/\\/g, "/")
    return rel.split(path.sep).join("/")
  }

  private docName(filePath: string, generation = "active"): string {
    const key = createHash("sha256").update(filePath).digest("hex")
    return `docs/${generation}/${key}.jsonl`
  }

  private now(): string {
    return (this.opts.clock?.() ?? new Date()).toISOString()
  }

  private async writeManifest(): Promise<void> {
    await this.atomicJson(this.manifestPath, this.load())
  }

  private async writeStageManifest(): Promise<void> {
    await this.atomicJson(this.stageManifestPath, this.active())
  }

  private async writeDoc(relative: string, doc: CodePostingsDocument): Promise<CodeGraphShardPartInfo> {
    const file = path.join(this.root, relative)
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${globalThis.crypto.randomUUID()}.tmp`
    const stream = createWriteStream(tmp, { encoding: "utf-8" })
    const { terms, ...header } = doc
    let entries = 1
    let bytes = 0
    const first = `${JSON.stringify({ header })}\n`
    await append(stream, first)
    bytes += Buffer.byteLength(first)
    for (const [term, item] of Object.entries(terms)) {
      for (const chunk of chunks(item.ranges)) {
        const line = `${JSON.stringify({ term, document: { ...item, ranges: chunk } } satisfies TermLine)}\n`
        await append(stream, line)
        entries += 1
        bytes += Buffer.byteLength(line)
      }
    }
    await finish(stream)
    await rename(tmp, file)
    return { key: path.basename(relative, ".jsonl"), path: relative, entries, estimatedBytes: bytes }
  }

  private remember(record: CodePostingsFileRecord, doc: CodePostingsDocument): void {
    const key = record.docParts?.map((part) => part.path).join("\0")
    if (!key) return
    const bytes = record.docParts?.reduce((sum, part) => sum + part.estimatedBytes, 0) ?? 0
    if (bytes > cacheLimit) return
    const old = this.cache.get(key)
    if (old) this.cacheBytes -= old.bytes
    this.cache.delete(key)
    this.cache.set(key, { doc, bytes })
    this.cacheBytes += bytes
    while (this.cacheBytes > cacheLimit && this.cache.size > 1) {
      const first = this.cache.entries().next().value as
        | [string, { doc: CodePostingsDocument; bytes: number }]
        | undefined
      if (!first) break
      this.cache.delete(first[0])
      this.cacheBytes -= first[1].bytes
    }
  }

  private forget(record?: CodePostingsFileRecord): void {
    const key = record?.docParts?.map((part) => part.path).join("\0")
    if (!key) return
    const cached = this.cache.get(key)
    if (!cached) return
    this.cache.delete(key)
    this.cacheBytes -= cached.bytes
  }

  private clearCache(): void {
    this.cache.clear()
    this.loads.clear()
    this.cacheBytes = 0
  }

  private async atomicJson(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${globalThis.crypto.randomUUID()}.tmp`
    await writeFile(tmp, encodeBoundedJson(value, { label: "code postings JSON" }))
    await rename(tmp, file)
  }

  private async cleanupDir(
    dir: string,
    root: string,
    keep: Set<string>,
    _generation: string | undefined,
    stats: IndexingCleanupStats,
    label: "docs" | "terms",
  ): Promise<void> {
    for (const item of await list(dir)) {
      if (!item.directory) continue
      await this.cleanupTree(item.path, root, keep, stats, label)
      if ((await list(item.path)).length === 0) {
        await removeSafe(item.path, root, stats, `codepostings: empty ${label} generation ${item.name}`)
      }
    }
  }

  private async cleanupTree(
    dir: string,
    root: string,
    keep: Set<string>,
    stats: IndexingCleanupStats,
    label: string,
  ): Promise<void> {
    for (const item of await list(dir)) {
      if (item.directory) {
        await this.cleanupTree(item.path, root, keep, stats, label)
        continue
      }
      if (!item.file) continue
      const file = normalize(relpath(this.root, item.path))
      if (keep.has(file)) continue
      await removeSafe(item.path, root, stats, `codepostings: orphan ${label} part ${item.name}`)
    }
  }

  private async cleanupOldGenerations(): Promise<void> {
    const manifest = this.manifest
    if (!manifest?.dataGeneration) return
    const stats = emptyCleanupStats()
    const root = await cleanupRoot(this.root, stats, "codepostings")
    if (!root) return
    const keep = new Set([
      ...(manifest.docParts ?? []).map((part) => normalize(part.path)),
      ...(manifest.termParts ?? []).map((part) => normalize(part.path)),
    ])
    await this.cleanupDir(this.docs, root, keep, manifest.dataGeneration, stats, "docs")
    await this.cleanupDir(this.termsDir, root, keep, manifest.dataGeneration, stats, "terms")
  }
}

function bucket(term: string): string {
  const value = createHash("sha256").update(term).digest()[0]! % bucketCount
  return value.toString(16).padStart(2, "0")
}

function chunks<T>(items: T[]): T[][] {
  if (items.length === 0) return [[]]
  const out: T[][] = []
  for (let index = 0; index < items.length; index += rangeChunk) out.push(items.slice(index, index + rangeChunk))
  return out
}

async function append(stream: ReturnType<typeof createWriteStream>, line: string): Promise<void> {
  if (stream.write(line)) return
  await once(stream, "drain")
}

async function finish(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  stream.end()
  await once(stream, "finish")
}

function normalizePrefix(input?: string) {
  if (!input) return undefined
  return input
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+$/, "")
}

function inPrefix(filePath: string, prefix: string) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`)
}

function range(item: Partial<CodeGraphLineRange>): item is CodeGraphLineRange {
  return (
    Number.isFinite(item.startLine) &&
    Number.isFinite(item.endLine) &&
    item.startLine! > 0 &&
    item.endLine! >= item.startLine!
  )
}

function normalize(file: string): string {
  return file.replace(/\\/g, "/")
}

function normalizeDoc(doc: CodePostingsDocument): CodePostingsDocument {
  const terms = dict<CodePostingsTermDocument>()
  if (doc.terms && typeof doc.terms === "object" && !Array.isArray(doc.terms)) {
    for (const [term, item] of Object.entries(doc.terms)) terms[term] = normalizeTerm(item)
  }
  return { ...doc, terms }
}

function normalizeTerm(doc: CodePostingsTermDocument): CodePostingsTermDocument {
  const fields = dict<number>()
  if (doc.fields && typeof doc.fields === "object" && !Array.isArray(doc.fields)) {
    for (const [field, value] of Object.entries(doc.fields)) {
      if (typeof value === "number") fields[field] = value
    }
  }
  return {
    ...doc,
    fields,
    ranges: Array.isArray(doc.ranges) ? doc.ranges : [],
  }
}
