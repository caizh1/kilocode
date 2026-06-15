import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  encodeBoundedJson,
  splitArrayRecordIntoBoundedJsonParts,
  splitRecordIntoBoundedJsonParts,
} from "../bounded-json"
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
  CodePostingsDocumentPartData,
  CodePostingsFileRecord,
  CodePostingsFileRecordStatus,
  CodePostingsManifest,
  CodePostingsSearchOptions,
  CodePostingsSearchResult,
  CodePostingsStatusInput,
  CodePostingsStorageStatus,
  CodePostingsTermDocument,
  CodePostingsTermPartData,
  ICodePostingsStorage,
} from "../types"
import { copy, dict, own } from "../dict"
import { buildPostingsDocument } from "./builder"
import { tokenizeQuery } from "./tokenizer"

const k1 = 1.2
const b = 0.75
const writeConcurrency = 4
const log = Log.create({ service: "codepostings-storage" })

export class CodePostingsJsonStorage implements ICodePostingsStorage {
  private manifest?: CodePostingsManifest
  private stage?: CodePostingsManifest
  private old?: CodePostingsManifest
  private seen?: Set<string>
  private pending = new Map<string, CodePostingsDocument>()
  private docsCache?: { generation?: string; docs: Record<string, CodePostingsDocument> }
  private termsCache?: { generation?: string; terms: Record<string, CodePostingsTermDocument[]> }
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
      const existing = own(manifest.records, rel)
      if (existing?.status === "ok" && existing.fileHash === fileHash && (await this.doc(manifest, rel))) {
        this.markSeen(rel)
        return
      }

      const updatedAt = this.now()
      const doc = buildPostingsDocument({
        workspacePath: this.opts.workspacePath,
        graph: { ...graph, filePath: rel, fileHash },
        content: input.content,
        updatedAt,
      })
      manifest.records[rel] = {
        filePath: rel,
        docFile: this.docName(rel, manifest.dataGeneration),
        fileHash,
        status: "ok",
        documentLength: doc.documentLength,
        updatedAt,
      }
      this.pending.set(rel, doc)
      this.markSeen(rel)
      this.refresh(manifest, updatedAt)
      if (!this.rebuilding) await this.commitActive(manifest)
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
      this.pending.delete(rel)
      if (status !== "stale") this.markSeen(rel)
      this.refresh(manifest, updatedAt)
      if (!this.rebuilding) await this.commitActive(manifest)
    })
  }

  public async getFilePostings(filePath: string): Promise<CodePostingsDocument | undefined> {
    const rel = this.relative(filePath)
    const staged = this.rebuilding ? this.stage : undefined
    const pending = this.pending.get(rel)
    if (pending) return pending
    if (staged) return this.doc(staged, rel)
    return this.doc(this.load(), rel)
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

    const terms = await this.terms(manifest)
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
      await rm(this.root, { recursive: true, force: true })
      this.manifest = this.empty()
      this.stage = undefined
      this.old = undefined
      this.seen = undefined
      this.pending.clear()
      this.docsCache = undefined
      this.termsCache = undefined
      this.schemaMismatch = false
      this.tokenizerMismatch = false
      this.graphSchemaMismatch = false
      this.parserMismatch = false
      this.rebuilding = false
      await this.writeManifest()
    })
  }

  public async ensureCompatible(): Promise<IndexingCompatibilityDecision> {
    return this.enqueue(async () => {
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
      this.pending.clear()
      this.docsCache = undefined
      this.termsCache = undefined
      this.schemaMismatch = false
      this.tokenizerMismatch = false
      this.graphSchemaMismatch = false
      this.parserMismatch = false
      this.rebuilding = false
      await this.writeManifest()
      return decision
    })
  }

  public status(): CodePostingsStorageStatus {
    this.load()
    const rebuild = this.needsRebuild()
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
      lastFullScanAt: rebuild ? undefined : manifest.lastFullScanAt,
      postingsDirectory: this.root,
      diagnostics: manifest.diagnostics,
    }
  }

  public async beginFullScan(): Promise<void> {
    await this.enqueue(async () => {
      const current = this.load()
      this.stage = this.needsRebuild() ? this.empty(globalThis.crypto.randomUUID()) : this.scanBase(current)
      this.seen = new Set()
      this.pending.clear()
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
      this.pruneUnseen(manifest)
      manifest.lastFullScanAt = now
      this.refresh(manifest, now)
      await this.commit(manifest, this.stageManifestPath)
      await rename(this.stageManifestPath, this.manifestPath)
      this.manifest = manifest
      this.stage = undefined
      this.seen = undefined
      this.pending.clear()
      this.rebuilding = false
      await this.cleanupOldGenerations()
    })
  }

  public async cleanupAbandonedArtifacts(): Promise<IndexingCleanupStats> {
    return this.enqueue(async () => {
      const stats = emptyCleanupStats()
      const root = await cleanupRoot(this.root, stats, "codepostings")
      if (!root) return stats

      const manifest = this.readManifestFile(this.manifestPath)
      if (manifest?.workspacePath && manifest.workspacePath !== this.opts.workspacePath) {
        stats.skipped.push("codepostings: active manifest workspace mismatch")
        return stats
      }

      await removeSafe(this.stageManifestPath, root, stats, "codepostings: rebuild manifest")
      this.stage = undefined
      if (!manifest) return stats

      const keep = new Set([
        ...(manifest.docParts ?? []).map((part) => normalize(part.path)),
        ...(manifest.termParts ?? []).map((part) => normalize(part.path)),
      ])
      await this.cleanupDir(this.docs, root, keep, manifest.dataGeneration, stats, "docs")
      await this.cleanupDir(this.termsDir, root, keep, manifest.dataGeneration, stats, "terms")
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

  private async doc(manifest: CodePostingsManifest, rel: string): Promise<CodePostingsDocument | undefined> {
    const record = own(manifest.records, rel)
    if (!record || record.status !== "ok") return undefined
    const pending = this.pending.get(rel)
    if (pending) return pending
    const doc = (await this.docsFor(manifest))[rel]
    if (!doc) return undefined
    if (doc.postingsSchemaVersion !== CODE_POSTINGS_SCHEMA_VERSION) return undefined
    if (doc.tokenizerVersion !== CODE_POSTINGS_TOKENIZER_VERSION) return undefined
    if (doc.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION) return undefined
    if (doc.parserVersion !== CODE_GRAPH_PARSER_VERSION) return undefined
    if (doc.fileHash !== record.fileHash) return undefined
    return doc
  }

  private async docsFor(manifest: CodePostingsManifest): Promise<Record<string, CodePostingsDocument>> {
    if (!manifest.docParts?.length) return dict()
    const cached = this.docsCache
    if (cached && cached.generation === manifest.dataGeneration) return cached.docs
    const docs = dict<CodePostingsDocument>()
    for (const part of manifest.docParts) {
      const payload = await this.readJson<CodePostingsDocumentPartData>(part.path)
      this.assertPart(payload, part.key)
      for (const [file, doc] of Object.entries(payload.documents)) docs[file] = normalizeDoc(doc)
    }
    this.docsCache = { generation: manifest.dataGeneration, docs }
    return docs
  }

  private async terms(manifest: CodePostingsManifest): Promise<Record<string, CodePostingsTermDocument[]>> {
    if (!manifest.termParts?.length) return dict()
    const cached = this.termsCache
    if (cached && cached.generation === manifest.dataGeneration) return cached.terms
    const terms = dict<CodePostingsTermDocument[]>()
    for (const part of manifest.termParts) {
      const payload = await this.readJson<CodePostingsTermPartData>(part.path)
      this.assertPart(payload, part.key)
      for (const [term, docs] of Object.entries(payload.terms)) {
        terms[term] = [...(terms[term] ?? []), ...docs.map(normalizeTerm)]
      }
    }
    this.termsCache = { generation: manifest.dataGeneration, terms }
    return terms
  }

  private assertPart(
    payload: Pick<
      CodePostingsDocumentPartData,
      "postingsSchemaVersion" | "tokenizerVersion" | "graphSchemaVersion" | "parserVersion" | "key"
    >,
    key: string,
  ): void {
    if (
      payload.key !== key ||
      payload.postingsSchemaVersion !== CODE_POSTINGS_SCHEMA_VERSION ||
      payload.tokenizerVersion !== CODE_POSTINGS_TOKENIZER_VERSION ||
      payload.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION ||
      payload.parserVersion !== CODE_GRAPH_PARSER_VERSION
    ) {
      throw new Error(`Code postings sidecar part ${key} does not match the current storage version.`)
    }
  }

  private async commitActive(manifest: CodePostingsManifest): Promise<void> {
    await this.commit(manifest, this.manifestPath)
    this.manifest = manifest
    this.pending.clear()
    await this.cleanupOldGenerations()
  }

  private async commit(manifest: CodePostingsManifest, file: string): Promise<void> {
    const baseDocs = await this.docsFor(manifest)
    const generation = globalThis.crypto.randomUUID()
    manifest.dataGeneration = generation
    const docs = dict<CodePostingsDocument>()
    for (const [rel, record] of Object.entries(manifest.records)) {
      if (record.status !== "ok") continue
      const doc = this.pending.get(rel) ?? baseDocs[rel]
      if (!doc) {
        delete manifest.records[rel]
        continue
      }
      docs[rel] = doc
      record.docFile = this.docName(rel, generation)
      record.fileHash = doc.fileHash
      record.documentLength = doc.documentLength
    }
    const docParts = splitRecordIntoBoundedJsonParts<CodePostingsDocument, CodePostingsDocumentPartData>({
      record: docs,
      label: "postings docs",
      pathForPart: (_index, key) => `docs/${generation}/${key}.json`,
      createPayload: (documents, key) => ({
        postingsSchemaVersion: CODE_POSTINGS_SCHEMA_VERSION,
        tokenizerVersion: CODE_POSTINGS_TOKENIZER_VERSION,
        graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
        parserVersion: CODE_GRAPH_PARSER_VERSION,
        key,
        documents,
      }),
    })
    const termRecord = this.termRecord(docs)
    const termParts = splitArrayRecordIntoBoundedJsonParts<CodePostingsTermDocument, CodePostingsTermPartData>({
      record: termRecord,
      label: "postings terms",
      pathForPart: (_index, key) => `terms/${generation}/${key}.json`,
      createPayload: (terms, key) => ({
        postingsSchemaVersion: CODE_POSTINGS_SCHEMA_VERSION,
        tokenizerVersion: CODE_POSTINGS_TOKENIZER_VERSION,
        graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
        parserVersion: CODE_GRAPH_PARSER_VERSION,
        key,
        terms,
      }),
    })
    await writeParts([...docParts, ...termParts], async (part) => {
      await this.atomicJson(path.join(this.root, part.path), part.payload)
    })
    manifest.docParts = info(docParts)
    manifest.termParts = info(termParts)
    this.refresh(manifest, manifest.updatedAt)
    await this.atomicJson(file, manifest)
    this.docsCache = { generation, docs }
    this.termsCache = { generation, terms: termRecord }
  }

  private termRecord(docs: Record<string, CodePostingsDocument>): Record<string, CodePostingsTermDocument[]> {
    const terms = dict<CodePostingsTermDocument[]>()
    for (const doc of Object.values(docs)) {
      for (const [term, item] of Object.entries(doc.terms)) {
        const list = terms[term] ?? []
        list.push(normalizeTerm(item))
        terms[term] = list
      }
    }
    return terms
  }

  private get root() {
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
    return this.schemaMismatch || this.tokenizerMismatch || this.graphSchemaMismatch || this.parserMismatch
  }

  private markSeen(rel: string): void {
    if (this.rebuilding) this.seen?.add(rel)
  }

  private pruneUnseen(manifest: CodePostingsManifest): void {
    if (!this.rebuilding || !this.seen) return
    for (const rel of Object.keys(manifest.records)) {
      if (this.seen.has(rel)) continue
      delete manifest.records[rel]
      this.pending.delete(rel)
    }
  }

  private load(): CodePostingsManifest {
    if (this.manifest) return this.manifest
    if (!existsSync(this.manifestPath)) {
      this.manifest = this.empty()
      return this.manifest
    }

    const parsed = JSON.parse(readFileSync(this.manifestPath, "utf-8")) as CodePostingsManifest
    if (parsed.workspacePath && parsed.workspacePath !== this.opts.workspacePath) {
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
    const parsed = JSON.parse(readFileSync(this.stageManifestPath, "utf-8")) as CodePostingsManifest
    if (parsed.workspacePath && parsed.workspacePath !== this.opts.workspacePath) return undefined
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

  private compatibility(manifest: CodePostingsManifest | undefined): IndexingCompatibilityDecision {
    if (!manifest) return { action: "rebuild", reason: "missing compatibility metadata" }
    if (manifest.workspacePath !== this.opts.workspacePath) return { action: "rebuild", reason: "workspace mismatch" }
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
    for (const part of [...manifest.docParts, ...manifest.termParts]) {
      if (!existsSync(path.join(this.root, part.path))) return { action: "rebuild", reason: "missing postings sidecar" }
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

  private docName(_filePath: string, generation = "active"): string {
    return `docs/${generation}`
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

  private async readJson<T>(relative: string): Promise<T> {
    return JSON.parse(await readFile(path.join(this.root, relative), "utf-8")) as T
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
    generation: string | undefined,
    stats: IndexingCleanupStats,
    label: "docs" | "terms",
  ): Promise<void> {
    for (const item of await list(dir)) {
      if (!item.directory) continue
      if (generation && item.name === generation) {
        await this.cleanupTree(item.path, root, keep, stats, label)
        continue
      }
      await removeSafe(item.path, root, stats, `codepostings: orphan ${label} generation ${item.name}`)
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

function info<T>(
  parts: Array<{ key: string; path: string; entries: number; estimatedBytes: number; payload: T }>,
): CodeGraphShardPartInfo[] {
  return parts.map((part) => ({
    key: part.key,
    path: part.path,
    entries: part.entries,
    estimatedBytes: part.estimatedBytes,
  }))
}

async function writeParts<T>(parts: T[], write: (part: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(writeConcurrency, parts.length)) }, async () => {
    while (next < parts.length) {
      const part = parts[next]!
      next += 1
      await write(part)
    }
  })
  await Promise.all(workers)
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
