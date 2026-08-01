import { createHash, randomUUID } from "crypto"
import { readFile, realpath, stat } from "fs/promises"
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
import { checkpointMetaHash, normalizedRoot, workspaceId } from "../rag-checkpoint"
import { constrained, type IndexingPressure } from "../memory"
import { loadIgnoreWithFingerprint, type IgnoreMatcher } from "../shared/load-ignore"
import { IndexingRunLock } from "../run-lock"
import { DocumentIndexCache } from "./cache"
import { chunkDocument, splitDocumentChunk } from "./chunker"
import { extractDocument } from "./extractors"
import {
  external as isExternalKey,
  id,
  key as externalKey,
  relative as externalRelative,
  same,
  token,
  within,
} from "./paths"
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
const chunker = 3
const embeddingRecoverySplits = 256
const patterns = [...DOCUMENT_EXTENSIONS, ...UNSUPPORTED_DOCUMENT_EXTENSIONS].map((ext) => `**/*${ext}`)
const office = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"])
type Telemetry = IndexingTelemetryEvent extends infer Event
  ? Event extends unknown
    ? Omit<Event, "provider" | "vectorStore" | "modelId">
    : never
  : never

type Root = {
  path: string
  external: boolean
  directory: boolean
  ignore: IgnoreMatcher
  fingerprint: string
}

type File = {
  path: string
  key: string
  source: string
}

type EmbeddedChunk = {
  chunk: DocumentChunk
  vector: number[]
}

type EmbeddingRecoveryBudget = {
  remaining: number
}

class EmbeddingCountError extends Error {}

export class DocumentIndexService {
  private readonly cache: DocumentIndexCache
  private task: Promise<void> | undefined
  private close: Promise<void> | undefined
  private disposed = false
  private status: DocumentIndexStatus = disabled("Document RAG disabled.")
  private pressure: IndexingPressure = "normal"
  private root?: string

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
    if (this.store.abortCandidate) await this.store.clearCollection()
    else await this.store.deleteCollection()
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
    const resolved = await this.resolveRoots()
    const prefix = await this.searchPrefix(options.directoryPrefix, resolved.roots)
    const embedding = await this.embedder.createEmbeddings([query], undefined, "document-query")
    const vector = embedding.embeddings[0]
    if (!vector) throw new Error("Failed to generate embedding for document query.")
    const max = options.maxResults ?? this.config.currentDocuments.searchMaxResults
    const text = query.trim().toLocaleLowerCase()
    const candidates = text ? Math.max(max, Math.min(100, max * 4)) : max
    const threshold = this.config.currentSearchMinScore
    const raw = await this.store.search(vector, prefix, threshold, candidates)
    const found = raw.flatMap((item) => convert(item, resolved.roots))
    if (!text) return found.slice(0, max)
    return found
      .sort((left, right) => {
        const a = left.content.toLocaleLowerCase().includes(text)
        const b = right.content.toLocaleLowerCase().includes(text)
        if (a !== b) return b ? 1 : -1
        return right.score - left.score
      })
      .slice(0, max)
  }

  private initialStatus(): DocumentIndexStatus {
    const cfg = this.config.currentDocuments
    if (!cfg.enabled) return disabled("Document RAG disabled.")
    if (!this.embedder || !this.store) return error("Document RAG requires configured embeddings.")
    return standby("Document RAG ready.")
  }

  private async run(trigger: IndexingTelemetryTrigger, force: boolean): Promise<void> {
    const cfg = this.config.currentDocuments
    if (!cfg.enabled || !this.embedder || !this.store) {
      await this.index(trigger, force)
      return
    }

    const lock = await this.acquire()
    if (!lock) return
    try {
      if (!this.disposed) await this.index(trigger, force)
    } finally {
      await lock.release()
    }
  }

  private async acquire(): Promise<IndexingRunLock | undefined> {
    while (!this.disposed) {
      const result = await IndexingRunLock.acquire({
        cacheDirectory: this.cacheDirectory,
        workspacePath: this.workspace,
        kind: "documents",
      })
      if (result.status === "acquired") return result.lock
      this.setStatus(standby("Document RAG waiting for another document indexing run."))
      await delay(Math.min(result.retryAfterMs, 250))
    }
    return undefined
  }

  private async index(trigger: IndexingTelemetryTrigger, force: boolean): Promise<void> {
    const cfg = this.config.currentDocuments
    if (!cfg.enabled) {
      this.setStatus(disabled("Document RAG disabled."))
      return
    }
    if (!this.embedder || !this.store) {
      this.setStatus(error("Document RAG requires configured embeddings."))
      return
    }

    const started = Date.now()
    let indexed = 0
    let skipped = 0
    let errors = 0
    let chunks = 0

    try {
      this.setStatus(progress("Discovering document files...", 0, 0))
      const resolved = await this.resolveRoots()
      skipped += resolved.skipped
      const meta = this.meta(resolved.roots)
      await this.cache.initialize(meta)
      if (this.disposed) return
      this.emit({ type: "started", source: "scan", trigger })
      const discovery = await this.discover(resolved.roots)
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
      if (force && !created && this.store.abortCandidate) {
        await this.store.clearCollection()
        if (this.disposed) return
      }
      if (created || force) {
        await this.cache.clear()
        if (this.disposed) return
      }
      await this.store.markIndexingIncomplete()
      if (this.disposed) return

      const files = discovery.files
      skipped += discovery.skipped
      const status = progress("Starting Document RAG indexing...", 0, files.length)
      status.recentErrors = this.status.recentErrors
      this.setStatus(status)
      const seen = new Set(files.map((file) => file.key))
      let checkpoint = Date.now()

      for (const [index, file] of files.entries()) {
        if (this.disposed) return
        const key = file.key
        const item = await (async () => {
          try {
            const info = await stat(file.path)
            if (info.size > cfg.maxFileBytes) return { kind: "large" as const }
            const hash = await fileHash(file.path)
            if (this.cache.get(key) === hash) return { kind: "unchanged" as const, hash }
            const sections = await extractDocument(file.path, cfg.maxExtractedBytesPerFile)
            const items = sections.flatMap((section) =>
              chunkDocument(section, this.workspace, cfg.chunkChars, cfg.chunkOverlapChars, file.source),
            )
            return { kind: "changed" as const, hash, items }
          } catch (err) {
            errors += 1
            this.record("documents:extract", err, file.source)
            this.report(
              index + 1,
              files.length,
              `Document extraction issue: ${path.basename(file.path)}`,
              skipped,
              errors,
            )
            return undefined
          }
        })()
        if (this.disposed) return
        if (!item) continue
        if (item.kind === "large") {
          skipped += 1
          this.cache.delete(key)
          await this.store.deletePointsByFilePath(key)
          if (this.disposed) return
          this.report(index + 1, files.length, `Skipped large document: ${path.basename(file.path)}`, skipped, errors)
          continue
        }
        if (item.kind === "unchanged") {
          indexed += 1
          this.report(index + 1, files.length, `Document unchanged: ${path.basename(file.path)}`, skipped, errors)
          continue
        }
        const written = await this.upsert(file, item.hash, item.items, meta)
        if (this.disposed) return
        this.cache.set(key, item.hash)
        if ((index + 1) % 8 === 0 || Date.now() - checkpoint >= 2_000) {
          await this.cache.flush()
          if (this.disposed) return
          checkpoint = Date.now()
        }
        indexed += 1
        chunks += written
        this.report(index + 1, files.length, `Indexed document: ${path.basename(file.path)}`, skipped, errors)
      }

      for (const file of Object.keys(this.cache.all())) {
        if (this.disposed) return
        if (seen.has(file)) continue
        await this.store.deletePointsByFilePath(file)
        if (this.disposed) return
        this.cache.delete(file)
      }

      await this.cache.flush()
      if (this.disposed) return
      if (errors > 0 && this.store.abortCandidate) {
        await this.store.abortCandidate()
        await this.cache.clear()
        throw new Error(`Document candidate indexing failed with ${errors} file error(s).`)
      }
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
      const candidate = this.store?.getLastCompatibilityDecision?.()?.action === "rebuild"
      await this.store?.abortCandidate?.()
      const restored = candidate && Boolean(await this.store?.hasIndexedData().catch(() => false))
      this.record("documents:run", err)
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus(
        restored
          ? {
              ...this.status,
              state: "Complete",
              message: "Document Embedding 候选索引未应用，正在使用上一版有效索引。",
              detail: message,
              recentErrors: this.status.recentErrors,
            }
          : error(message, this.status.recentErrors),
      )
      this.emit({
        type: "error",
        source: "scan",
        location: "documents:run",
        error: message,
        trigger,
        pipeline: "documents",
      })
    }
  }

  private async discover(roots: Root[]): Promise<{ files: File[]; skipped: number; limited: boolean }> {
    const cfg = this.config.currentDocuments
    const out = new Map<string, File>()
    const seen = new Set<string>()
    let skipped = 0

    const add = async (root: Root, file: string) => {
      const name = path.basename(file)
      if (name.startsWith("~$") && office.has(path.extname(name).toLowerCase())) return false
      const canonical = await realpath(file).catch(() => undefined)
      if (!canonical) {
        skipped += 1
        this.record("documents:discover", new Error("Document path is not accessible."), file)
        return false
      }
      if (!within(root.path, canonical)) {
        skipped += 1
        this.record("documents:discover", new Error("Document symlink escapes the configured root."), file)
        return false
      }
      if (seen.has(canonical)) return false
      const relative = root.external
        ? root.directory
          ? path.normalize(path.relative(root.path, canonical))
          : path.basename(canonical)
        : path.normalize(path.relative(await this.workspacePath(), canonical))
      if (!relative || relative === ".") return false
      const match = relative.replaceAll("\\", "/")
      if (FileIgnore.match(match)) return false
      if (root.ignore.ignores(match)) return false
      if (!included(match, cfg.include)) return false
      if (excluded(match, cfg.exclude)) return false
      const ext = path.extname(canonical).toLowerCase()
      const doc = DOCUMENT_EXTENSIONS.includes(ext as never)
      const unsupported = UNSUPPORTED_DOCUMENT_EXTENSIONS.includes(ext as never)
      if (!doc && !unsupported) return false
      if (unsupported) {
        skipped += 1
        return false
      }
      const key = root.external
        ? root.directory
          ? externalKey(root.path, canonical)
          : `${externalKey(root.path, canonical)}${path.basename(canonical)}`
        : relative
      seen.add(canonical)
      out.set(key, {
        path: canonical,
        key,
        source: root.external ? canonical : relative,
      })
      return out.size > cfg.maxFiles
    }

    for (const root of roots) {
      if (this.disposed) return { files: sorted(out), skipped, limited: false }
      if (!root.directory) {
        if (await add(root, root.path)) return { files: sorted(out), skipped, limited: true }
        continue
      }
      for await (const file of globIterate(patterns, {
        cwd: root.path,
        absolute: true,
        nodir: true,
        dot: false,
        nocase: true,
        ignore: FileIgnore.PATTERNS,
      })) {
        if (this.disposed) return { files: sorted(out), skipped, limited: false }
        if (await add(root, file)) return { files: sorted(out), skipped, limited: true }
      }
    }
    return { files: sorted(out), skipped, limited: false }
  }

  private async upsert(file: File, hash: string, chunks: DocumentChunk[], meta: string): Promise<number> {
    if (this.disposed || !this.embedder || !this.store) return 0
    const generation = digest(`${meta}\0${file.key}\0${hash}\0${randomUUID()}`)
    if (chunks.length === 0) {
      await this.store.deletePointsByFilePath(file.key)
      return 0
    }
    const batch = Math.max(
      1,
      Math.min(this.config.currentEmbeddingBatchSize ?? 60, constrained(this.pressure) ? 16 : 60),
    )
    const recovery = { remaining: embeddingRecoverySplits }
    let written = 0
    for (let index = 0; index < chunks.length; index += batch) {
      if (this.disposed) return written
      const embedded = await this.embed(chunks.slice(index, index + batch), 0, recovery)
      if (this.disposed) return written
      const points = embedded.map<PointStruct>((item, offset) =>
        point(item.chunk, item.vector, this.workspace, file.key, meta, generation, written + offset),
      )
      await this.store.upsertPoints(points)
      if (this.disposed) return written
      written += points.length
    }
    if (this.disposed) return written
    await this.store.activateFileGeneration?.(file.key, generation, "documents")
    if (this.disposed) return written
    await this.store.deleteInactiveFilePoints?.(file.key, generation)
    return written
  }

  private async embed(
    chunks: DocumentChunk[],
    splitDepth = 0,
    recovery: EmbeddingRecoveryBudget = { remaining: embeddingRecoverySplits },
  ): Promise<EmbeddedChunk[]> {
    if (this.disposed || !this.embedder || chunks.length === 0) return []
    try {
      const { embeddings } = await this.embedder.createEmbeddings(
        chunks.map((item) => item.content),
        undefined,
        "document",
      )
      if (embeddings.length !== chunks.length) {
        throw new EmbeddingCountError(
          `Document embedding count mismatch: expected ${chunks.length}, received ${embeddings.length}.`,
        )
      }
      return chunks.map((chunk, index) => ({ chunk, vector: embeddings[index]! }))
    } catch (err) {
      if (this.disposed) return []
      const recoverable = err instanceof EmbeddingCountError || embeddingInputLimit(err)
      if (!recoverable || splitDepth >= 8) throw err
      if (recovery.remaining <= 0) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(
          `Document embedding input recovery exhausted after ${embeddingRecoverySplits} adaptive splits: ${message}`,
          { cause: err },
        )
      }
      recovery.remaining -= 1
      if (chunks.length > 1) {
        const middle = Math.ceil(chunks.length / 2)
        const left = await this.embed(chunks.slice(0, middle), splitDepth, recovery)
        const right = await this.embed(chunks.slice(middle), splitDepth, recovery)
        return [...left, ...right]
      }

      const current = chunks[0]!
      const size = Math.floor(current.content.length / 2)
      if (size < 64) throw err
      const overlap = Math.min(this.config.currentDocuments.chunkOverlapChars, Math.floor(size * 0.2))
      const parts = splitDocumentChunk(current, size, overlap)
      if (parts.length < 2 || parts.some((part) => part.content === current.content)) throw err
      log.warn("retrying oversized document embedding with smaller semantic chunks", {
        sourceRef: current.sourceRef,
        chars: current.content.length,
        chunks: parts.length,
      })
      return this.embed(parts, splitDepth + 1, recovery)
    }
  }

  private async workspacePath(): Promise<string> {
    if (this.root) return this.root
    this.root = await realpath(this.workspace).catch(() => path.resolve(this.workspace))
    return this.root
  }

  private async resolveRoots(): Promise<{ roots: Root[]; skipped: number }> {
    const workspace = await this.workspacePath()
    const cfg = this.config.currentDocuments
    const approvals = await Promise.all(
      cfg.approvedExternalRoots.map(async (item) => {
        if (!path.isAbsolute(item.path)) return
        if (item.workspace && !path.isAbsolute(item.workspace)) return
        const scope = item.workspace
          ? await realpath(item.workspace).catch(() => path.resolve(item.workspace!))
          : undefined
        if (scope && !same(scope, workspace)) return
        const alias = path.resolve(item.path)
        const root = await realpath(item.path).catch(() => alias)
        return { root, alias }
      }),
    )
    const allowed = approvals.filter((item): item is { root: string; alias: string } => Boolean(item))
    const roots: Root[] = []
    let skipped = 0

    for (const item of cfg.paths) {
      const absolute = path.isAbsolute(item)
      const requested = absolute ? item : path.resolve(workspace, item)
      const target = path.resolve(requested)
      const internal = within(workspace, target) || within(path.resolve(this.workspace), target)
      if (!absolute && !internal) {
        throw new Error(`relative document path must stay within the current workspace: ${item}`)
      }
      const approved = allowed.some((approval) => within(approval.root, target) || within(approval.alias, target))
      if (!internal && !approved) {
        throw new Error(`external document path is not approved for this workspace: ${item}`)
      }
      const root = await realpath(requested).catch(() => undefined)
      if (!root) {
        skipped += 1
        this.record("documents:root", new Error("Configured document root is not accessible."), requested)
        continue
      }
      const external = !within(workspace, root)
      if (external && !allowed.some((approval) => within(approval.root, root))) {
        throw new Error(`external document path is not approved for this workspace: ${item}`)
      }
      if (roots.some((entry) => same(entry.path, root))) continue
      const entry = await (async () => {
        const info = await stat(root)
        const loaded = external
          ? await loadIgnoreWithFingerprint(info.isDirectory() ? root : path.dirname(root))
          : { ignore: this.ignore, fingerprint: "workspace" }
        return {
          path: root,
          external,
          directory: info.isDirectory(),
          ignore: loaded.ignore,
          fingerprint: loaded.fingerprint,
        }
      })().catch((err) => {
        skipped += 1
        this.record("documents:root", err, requested)
        return undefined
      })
      if (entry) roots.push(entry)
    }
    return { roots, skipped }
  }

  private async searchPrefix(input: string | undefined, roots: Root[]): Promise<string | undefined> {
    if (!input) return
    if (isExternalKey(input)) return input.replaceAll("\\", "/")
    if (!path.isAbsolute(input)) {
      const rel = path.normalize(input)
      if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        throw new Error(`document search path must stay within an indexed root: ${input}`)
      }
      return rel
    }

    const workspace = await this.workspacePath()
    const raw = path.resolve(input)
    const internal = within(workspace, raw) || within(path.resolve(this.workspace), raw)
    const approved = roots.some((entry) => entry.external && within(entry.path, raw))
    if (!internal && !approved) throw new Error(`document search path is not an approved indexed root: ${input}`)
    const target = await realpath(input).catch(() => raw)
    if (within(workspace, target)) {
      const rel = path.normalize(path.relative(workspace, target))
      return !rel || rel === "." ? undefined : rel
    }
    const root = roots.find((entry) => entry.external && within(entry.path, target))
    if (!root) throw new Error(`document search path is not an approved indexed root: ${input}`)
    return externalKey(root.path, target)
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

  private meta(roots: Root[]): string {
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
      ignoreFingerprint: digest(
        JSON.stringify({
          cfg,
          roots: roots.map((root) => ({
            path: root.path,
            external: root.external,
            fingerprint: root.fingerprint,
          })),
        }),
      ),
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
  key: string,
  meta: string,
  generation: string,
  chunkIndex: number,
): PointStruct {
  const range = `${chunk.startLine}:${chunk.endLine}`
  const id = uuidv5(
    [workspaceId(workspace), key, chunk.chunkHash, range, chunkIndex, generation].join("\0"),
    DOCUMENT_CHUNK_NAMESPACE,
  )
  return {
    id,
    vector,
    payload: {
      workspaceId: workspaceId(workspace),
      normalizedRoot: normalizedRoot(workspace),
      filePath: key,
      fileHash: digest(`${key}\0${generation}`),
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

function convert(item: VectorStoreSearchResult, roots: Root[]): DocumentSearchResult[] {
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
  const source = sourcePath(payload.filePath, roots)
  if (!source) return []
  const ext = path.extname(source).toLowerCase()
  const sourceRef =
    typeof payload.sourceRef === "string" && !isExternalKey(payload.filePath)
      ? payload.sourceRef
      : ext === ".pdf"
        ? `${source}#page=${typeof payload.page === "number" ? payload.page : payload.startLine}`
        : ext === ".xlsx" || ext === ".ods"
          ? typeof payload.sheet === "string"
            ? `${source}#sheet=${encodeURIComponent(payload.sheet)} rows=${payload.startLine}-${payload.endLine}`
            : `${source}#rows=${payload.startLine}-${payload.endLine}`
          : `${source}:${payload.startLine}-${payload.endLine}`
  return [
    {
      filePath: source.replaceAll("\\", "/"),
      sourceRef: sourceRef.replaceAll("\\", "/"),
      score: item.score,
      content: payload.codeChunk,
      startLine: payload.startLine,
      endLine: payload.endLine,
    },
  ]
}

function sourcePath(key: string, roots: Root[]): string | undefined {
  if (!isExternalKey(key)) return key
  const hash = id(key)
  const rel = externalRelative(key)
  const root = roots.find((item) => item.external && token(item.path) === hash)
  if (!root || rel === undefined) return
  if (!root.directory) return root.path
  return path.join(root.path, ...rel.split("/"))
}

function sorted(files: Map<string, File>): File[] {
  return [...files.values()].sort((left, right) => left.key.localeCompare(right.key))
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

function embeddingInputLimit(err: unknown): boolean {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return [
    /maximum\s+(?:context|sequence|input)?\s*length.{0,80}(?:token|8192)/i,
    /input.{0,80}(?:too long|exceed).{0,80}(?:token|length|limit)/i,
    /(?:token|sequence).{0,80}(?:exceed|longer than).{0,80}(?:limit|maximum|max)/i,
    /maximum.{0,80}(?:8192|tokens?).{0,80}(?:input|context|sequence|length)?/i,
    /tokens?.{0,80}(?:maximum|max|limit).{0,40}8192/i,
    /(?:context|sequence)[_-]?length[_-]?exceeded/i,
  ].some((pattern) => pattern.test(message))
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function included(file: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true
  return patterns.some((pattern) => minimatch(file, pattern, { nocase: true }))
}

function excluded(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(file, pattern, { nocase: true }))
}
