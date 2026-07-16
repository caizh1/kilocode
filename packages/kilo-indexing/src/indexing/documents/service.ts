import { createHash } from "crypto"
import { readFile, stat } from "fs/promises"
import path from "path"
import { globIterate } from "glob"
import { minimatch } from "minimatch"
import { v5 as uuidv5 } from "uuid"
import type { CodeIndexConfigManager } from "../config-manager"
import type { IEmbedder } from "../interfaces/embedder"
import type { IVectorStore, PointStruct, VectorStoreSearchResult } from "../interfaces/vector-store"
import type {
  IndexingTelemetryEvent,
  IndexingTelemetryReporter,
  IndexingTelemetryTrigger,
} from "../interfaces/telemetry"
import { DOCUMENT_CHUNK_NAMESPACE } from "../constants"
import { FileIgnore } from "../../file/ignore"
import { Log } from "../../util/log"
import { generateRelativeIgnorePath } from "../shared/get-relative-path"
import { checkpointMetaHash, normalizedRoot, workspaceId } from "../rag-checkpoint"
import { constrained, type IndexingPressure } from "../memory"
import type { IgnoreMatcher } from "../shared/load-ignore"
import { DocumentIndexCache } from "./cache"
import { chunkDocument } from "./chunker"
import { extractDocument } from "./extractors"
import {
  DOCUMENT_EXTENSIONS,
  UNSUPPORTED_DOCUMENT_EXTENSIONS,
  type DocumentChunk,
  type DocumentIndexStatus,
  type DocumentSearchOptions,
  type DocumentSearchResult,
} from "./types"

const log = Log.create({ service: "document-index" })
const schema = 1
const extractor = 1
const chunker = 1
const patterns = [...DOCUMENT_EXTENSIONS, ...UNSUPPORTED_DOCUMENT_EXTENSIONS].map((ext) => `**/*${ext}`)
type Telemetry = IndexingTelemetryEvent extends infer Event
  ? Event extends unknown
    ? Omit<Event, "provider" | "vectorStore" | "modelId">
    : never
  : never

export class DocumentIndexService {
  private readonly cache: DocumentIndexCache
  private task: Promise<void> | undefined
  private close: Promise<void> | undefined
  private disposed = false
  private status: DocumentIndexStatus = disabled("Document RAG disabled.")
  private pressure: IndexingPressure = "normal"

  constructor(
    private readonly workspace: string,
    private readonly cacheDirectory: string,
    private readonly config: CodeIndexConfigManager,
    private readonly embedder: IEmbedder | undefined,
    private readonly store: IVectorStore | undefined,
    private readonly ignore: IgnoreMatcher,
    private readonly onStatus?: () => void,
    private readonly onTelemetry?: IndexingTelemetryReporter,
  ) {
    this.cache = new DocumentIndexCache(cacheDirectory, workspace)
    this.status = this.initialStatus()
  }

  getStatus(): DocumentIndexStatus {
    return {
      ...this.status,
      recentErrors: this.status.recentErrors?.slice(),
    }
  }

  dispose(): Promise<void> {
    this.disposed = true
    if (this.close) return this.close
    const task = this.task
    this.close = (async () => {
      try {
        await task
      } finally {
        await this.store?.close?.()
      }
    })()
    return this.close
  }

  setMemoryPressure(pressure: IndexingPressure): void {
    this.pressure = pressure
  }

  async rebuild(trigger: IndexingTelemetryTrigger = "manual"): Promise<void> {
    if (this.disposed) return
    if (!this.store) {
      this.setStatus(error("Document RAG requires a configured embedding vector store."))
      return
    }
    await this.store.deleteCollection()
    if (this.disposed) return
    await this.cache.clear()
    if (this.disposed) return
    await this.start(trigger, true)
  }

  async start(trigger: IndexingTelemetryTrigger = "background", force = false): Promise<void> {
    if (this.disposed) return
    if (this.task) {
      await this.task
      return
    }
    this.task = this.run(trigger, force).finally(() => {
      this.task = undefined
    })
    await this.task
  }

  async search(query: string, options: DocumentSearchOptions = {}): Promise<DocumentSearchResult[]> {
    if (!this.embedder || !this.store) return []
    if (!this.config.currentDocuments.enabled) return []
    const embedding = await this.embedder.createEmbeddings([query])
    const vector = embedding.embeddings[0]
    if (!vector) throw new Error("Failed to generate embedding for document query.")
    const max = options.maxResults ?? this.config.currentDocuments.searchMaxResults
    const raw = await this.store.search(vector, options.directoryPrefix, this.config.currentSearchMinScore, max)
    return raw.flatMap((item) => convert(item))
  }

  private initialStatus(): DocumentIndexStatus {
    const cfg = this.config.currentDocuments
    if (!cfg.enabled) return disabled("Document RAG disabled.")
    if (cfg.paths.length === 0) return standby("No document folders configured.")
    if (!this.embedder || !this.store) return error("Document RAG requires configured embeddings.")
    return standby("Document RAG ready.")
  }

  private async run(trigger: IndexingTelemetryTrigger, force: boolean): Promise<void> {
    const cfg = this.config.currentDocuments
    if (!cfg.enabled) {
      this.setStatus(disabled("Document RAG disabled."))
      return
    }
    if (cfg.paths.length === 0) {
      this.setStatus(standby("No document folders configured."))
      return
    }
    if (!this.embedder || !this.store) {
      this.setStatus(error("Document RAG requires configured embeddings."))
      return
    }

    const meta = this.meta()
    await this.cache.initialize(meta)
    if (this.disposed) return
    this.emit({ type: "started", source: "scan", trigger })

    const started = Date.now()
    let indexed = 0
    let skipped = 0
    let errors = 0
    let chunks = 0

    try {
      this.setStatus(progress("Discovering document files...", 0, 0))
      const discovery = await this.discover()
      if (this.disposed) return
      if (discovery.limited) {
        const message = `Document RAG paused after finding more than ${cfg.maxFiles} documents. Narrow document paths or excludes before rebuilding.`
        this.setStatus(standby(message))
        log.warn("document indexing file limit reached", {
          workspacePath: this.workspace,
          maxFiles: cfg.maxFiles,
        })
        return
      }
      const created = await this.store.initialize()
      if (this.disposed) return
      if (created || force) {
        await this.cache.clear()
        if (this.disposed) return
      }
      await this.store.markIndexingIncomplete()
      if (this.disposed) return

      const files = discovery.files
      skipped += discovery.skipped
      this.setStatus(progress("Starting Document RAG indexing...", 0, files.length))
      const seen = new Set(files.map((file) => path.normalize(path.relative(this.workspace, file))))
      let checkpoint = Date.now()

      for (const [index, file] of files.entries()) {
        if (this.disposed) return
        const rel = path.normalize(path.relative(this.workspace, file))
        try {
          const info = await stat(file)
          if (this.disposed) return
          if (info.size > cfg.maxFileBytes) {
            skipped += 1
            this.cache.delete(rel)
            await this.store.deletePointsByFilePath(rel)
            if (this.disposed) return
            this.report(index + 1, files.length, `Skipped large document: ${path.basename(file)}`, skipped, errors)
            continue
          }
          const hash = await fileHash(file)
          if (this.disposed) return
          if (this.cache.get(rel) === hash) {
            indexed += 1
            this.report(index + 1, files.length, `Document unchanged: ${path.basename(file)}`, skipped, errors)
            continue
          }
          const sections = await extractDocument(file, cfg.maxExtractedBytesPerFile)
          if (this.disposed) return
          const items = sections.flatMap((section) =>
            chunkDocument(section, this.workspace, cfg.chunkChars, cfg.chunkOverlapChars),
          )
          await this.upsert(file, hash, items, meta)
          if (this.disposed) return
          this.cache.set(rel, hash)
          if ((index + 1) % 8 === 0 || Date.now() - checkpoint >= 2_000) {
            await this.cache.flush()
            if (this.disposed) return
            checkpoint = Date.now()
          }
          indexed += 1
          chunks += items.length
          this.report(index + 1, files.length, `Indexed document: ${path.basename(file)}`, skipped, errors)
        } catch (err) {
          if (this.disposed) return
          errors += 1
          this.record("documents:index", err, rel)
          this.report(index + 1, files.length, `Document indexing issue: ${path.basename(file)}`, skipped, errors)
        }
      }

      for (const file of Object.keys(this.cache.all())) {
        if (this.disposed) return
        if (seen.has(path.normalize(file))) continue
        await this.store.deletePointsByFilePath(file)
        if (this.disposed) return
        this.cache.delete(file)
      }

      await this.cache.flush()
      if (this.disposed) return
      await this.store.markIndexingComplete()
      if (this.disposed) return
      this.setStatus({
        state: errors > 0 ? "Complete" : "Complete",
        message: errors > 0 ? "Document RAG indexed with issues." : "Document RAG up-to-date.",
        processedFiles: files.length,
        totalFiles: files.length,
        percent: 100,
        detail: `${indexed} indexed, ${skipped} skipped, ${errors} errors, ${chunks} chunks.`,
        lastFullScanAt: new Date().toISOString(),
        errorCount: errors,
        staleCount: 0,
        skippedCount: skipped,
        validFileCount: indexed,
        recentErrors: this.status.recentErrors,
      })
      this.emit({
        type: "completed",
        source: "scan",
        trigger,
        mode: "full",
        filesIndexed: indexed,
        filesDiscovered: files.length,
        totalBlocks: chunks,
        batchErrors: errors,
      })
      log.info("document indexing complete", {
        workspacePath: this.workspace,
        elapsedMs: Date.now() - started,
        files: files.length,
        indexed,
        skipped,
        errors,
        chunks,
      })
    } catch (err) {
      if (this.disposed) return
      this.record("documents:run", err)
      this.setStatus(error(err instanceof Error ? err.message : String(err), this.status.recentErrors))
      this.emit({
        type: "error",
        source: "scan",
        location: "documents:run",
        error: err instanceof Error ? err.message : String(err),
        trigger,
        pipeline: "documents",
      })
    }
  }

  private async discover(): Promise<{ files: string[]; skipped: number; limited: boolean }> {
    const cfg = this.config.currentDocuments
    const out = new Set<string>()
    let skipped = 0

    const add = (file: string) => {
      const relative = generateRelativeIgnorePath(file, this.workspace)
      if (!relative) return false
      if (FileIgnore.match(relative)) return false
      if (this.ignore.ignores(relative)) return false
      if (!included(relative, cfg.include)) return false
      if (excluded(relative, cfg.exclude)) return false
      const ext = path.extname(file).toLowerCase()
      const doc = DOCUMENT_EXTENSIONS.includes(ext as never)
      const unsupported = UNSUPPORTED_DOCUMENT_EXTENSIONS.includes(ext as never)
      if (!doc && !unsupported) return false
      if (unsupported) {
        skipped += 1
        return false
      }
      out.add(file)
      return out.size > cfg.maxFiles
    }

    for (const item of cfg.paths) {
      if (this.disposed) return { files: [...out].sort(), skipped, limited: false }
      const root = path.resolve(this.workspace, item)
      const rel = path.relative(this.workspace, root)
      if (path.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${path.sep}`)) {
        throw new Error(`document path must be within the current workspace: ${item}`)
      }
      const info = await stat(root).catch(() => undefined)
      if (this.disposed) return { files: [...out].sort(), skipped, limited: false }
      if (!info) continue
      if (!info.isDirectory()) {
        if (add(root)) return { files: [...out].sort(), skipped, limited: true }
        continue
      }
      for await (const file of globIterate(patterns, {
        cwd: root,
        absolute: true,
        nodir: true,
        dot: false,
        nocase: true,
        ignore: FileIgnore.PATTERNS,
      })) {
        if (this.disposed) return { files: [...out].sort(), skipped, limited: false }
        if (add(file)) return { files: [...out].sort(), skipped, limited: true }
      }
    }
    return { files: [...out].sort(), skipped, limited: false }
  }

  private async upsert(file: string, hash: string, chunks: DocumentChunk[], meta: string): Promise<void> {
    if (this.disposed || !this.embedder || !this.store) return
    const rel = path.normalize(path.relative(this.workspace, file))
    const generation = digest(`${meta}\0${rel}\0${hash}`)
    const texts = chunks.map((item) => item.content)
    if (texts.length === 0) {
      await this.store.deletePointsByFilePath(rel)
      return
    }
    const batch = Math.max(
      1,
      Math.min(this.config.currentEmbeddingBatchSize ?? 60, constrained(this.pressure) ? 16 : 60),
    )
    for (let index = 0; index < texts.length; index += batch) {
      if (this.disposed) return
      const slice = texts.slice(index, index + batch)
      const { embeddings } = await this.embedder.createEmbeddings(slice)
      if (this.disposed) return
      const points = embeddings.flatMap<PointStruct>((vector, offset) => {
        const chunk = chunks[index + offset]
        if (!chunk) return []
        return [point(chunk, vector, this.workspace, meta, generation)]
      })
      await this.store.upsertPoints(points)
      if (this.disposed) return
    }
    if (this.disposed) return
    await this.store.activateFileGeneration?.(rel, generation, "documents")
    if (this.disposed) return
    await this.store.deleteInactiveFilePoints?.(rel, generation)
  }

  private report(done: number, total: number, message: string, skipped: number, errors: number): void {
    const next = progress(message, done, total)
    next.skippedCount = skipped
    next.errorCount = errors
    next.recentErrors = this.status.recentErrors
    this.setStatus(next)
  }

  private record(location: string, err: unknown, file?: string): void {
    const msg = err instanceof Error ? err.message : String(err)
    const list = this.status.recentErrors?.slice() ?? []
    list.unshift({
      time: new Date().toISOString(),
      source: "documents",
      location,
      message: msg.replace(/\s+/g, " ").trim(),
      ...(file ? { file } : {}),
    })
    list.splice(5)
    this.status = { ...this.status, recentErrors: list }
    log.warn("document indexing issue", { workspacePath: this.workspace, location, file, error: msg })
  }

  private setStatus(status: DocumentIndexStatus): void {
    if (this.disposed) return
    this.status = status
    this.onStatus?.()
  }

  private meta(): string {
    const cfg = this.config.currentDocuments
    return checkpointMetaHash({
      root: this.workspace,
      schemaVersion: schema,
      parserVersion: extractor,
      chunkerVersion: chunker,
      embedderProvider: this.config.currentEmbedderProvider,
      embedderModel: this.config.currentModelId ?? "default",
      embeddingDimension: this.config.currentModelDimension ?? 0,
      vectorStoreProvider: this.config.getConfig().vectorStoreProvider ?? "lancedb",
      collectionName: this.store?.getCollectionName?.() ?? "documents",
      ignoreFingerprint: digest(JSON.stringify(cfg)),
    })
  }

  private emit(event: Telemetry): void {
    if (this.disposed) return
    const next = event.type === "error" ? { ...event, pipeline: event.pipeline ?? "documents" } : event
    this.onTelemetry?.({
      ...next,
      provider: this.config.currentEmbedderProvider,
      vectorStore: this.config.getConfig().vectorStoreProvider ?? "lancedb",
      modelId: this.config.currentModelId,
    })
  }
}

function point(
  chunk: DocumentChunk,
  vector: number[],
  workspace: string,
  meta: string,
  generation: string,
): PointStruct {
  const rel = path.normalize(path.relative(workspace, chunk.filePath))
  const range = `${chunk.startLine}:${chunk.endLine}`
  const id = uuidv5(
    [workspaceId(workspace), rel, chunk.chunkHash, range, generation].join("\0"),
    DOCUMENT_CHUNK_NAMESPACE,
  )
  return {
    id,
    vector,
    payload: {
      workspaceId: workspaceId(workspace),
      normalizedRoot: normalizedRoot(workspace),
      filePath: rel,
      fileHash: digest(`${rel}\0${generation}`),
      chunkHash: chunk.chunkHash,
      chunkRange: range,
      runId: "documents",
      generation,
      checkpointMetaHash: meta,
      active: false,
      codeChunk: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      segmentHash: chunk.chunkHash,
      sourceRef: chunk.sourceRef,
      documentKind: chunk.kind,
      ...(chunk.page ? { page: chunk.page } : {}),
      ...(chunk.sheet ? { sheet: chunk.sheet } : {}),
    },
  }
}

function convert(item: VectorStoreSearchResult): DocumentSearchResult[] {
  const payload = item.payload
  if (!payload) return []
  if (
    typeof payload.filePath !== "string" ||
    typeof payload.codeChunk !== "string" ||
    typeof payload.startLine !== "number" ||
    typeof payload.endLine !== "number" ||
    typeof item.score !== "number"
  ) {
    return []
  }
  const ext = path.extname(payload.filePath).toLowerCase()
  const sourceRef =
    typeof payload.sourceRef === "string"
      ? payload.sourceRef
      : ext === ".pdf"
        ? `${payload.filePath}#page=${payload.startLine}`
        : ext === ".xlsx" || ext === ".ods"
          ? `${payload.filePath}#rows=${payload.startLine}-${payload.endLine}`
          : `${payload.filePath}:${payload.startLine}-${payload.endLine}`
  return [
    {
      filePath: payload.filePath.replaceAll("\\", "/"),
      sourceRef: sourceRef.replaceAll("\\", "/"),
      score: item.score,
      content: payload.codeChunk,
      startLine: payload.startLine,
      endLine: payload.endLine,
    },
  ]
}

function disabled(message: string): DocumentIndexStatus {
  return {
    state: "Disabled",
    message,
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    detail: message,
    errorCount: 0,
    staleCount: 0,
    skippedCount: 0,
  }
}

function standby(message: string): DocumentIndexStatus {
  return {
    ...disabled(message),
    state: "Standby",
  }
}

function error(message: string, recentErrors?: DocumentIndexStatus["recentErrors"]): DocumentIndexStatus {
  return {
    ...disabled(message),
    state: "Error",
    errorCount: 1,
    recentErrors,
  }
}

function progress(message: string, processedFiles: number, totalFiles: number): DocumentIndexStatus {
  const percent = totalFiles > 0 ? Math.min(100, Math.round((processedFiles / totalFiles) * 100)) : 0
  return {
    state: "In Progress",
    message,
    processedFiles,
    totalFiles,
    percent,
    detail: message,
    errorCount: 0,
    staleCount: 0,
    skippedCount: 0,
  }
}

async function fileHash(filePath: string): Promise<string> {
  return digest(await readFile(filePath))
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function included(file: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true
  return patterns.some((pattern) => minimatch(file, pattern, { nocase: true }))
}

function excluded(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(file, pattern, { nocase: true }))
}
