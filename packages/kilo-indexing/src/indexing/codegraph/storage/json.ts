import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import { encodeBoundedJson } from "../bounded-json"
import { cleanupRoot, emptyCleanupStats, list, rel as relpath, removeSafe } from "../../cleanup"
import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  CODE_GRAPH_STORAGE_DIR,
  CODE_GRAPH_STORAGE_VERSION_DIR,
} from "../constants"
import { mergeCodeGraphFileStorageParts, splitCodeGraphFilesForStorage } from "../file-storage"
import { CodeGraphDerivedIndexBuilder } from "../derived-index"
import { CODEGRAPH_DERIVED_SIDECAR_FIELDS, splitCodeGraphDerivedIndex } from "../derived-storage"
import type { IndexingCleanupStats, IndexingCompatibilityDecision } from "../../interfaces/cleanup"
import { Log } from "../../../util/log"
import type {
  CodeGraphDerivedSidecarManifest,
  CodeGraphFileGraph,
  CodeGraphFileRecord,
  CodeGraphFileRecordStatus,
  CodeGraphManifest,
  CodeGraphShardData,
  CodeGraphShardInfo,
  CodeGraphStorageStatus,
  CodeGraphStatusInput,
  ICodeGraphStorage,
} from "../types"
import { copy, dict, own } from "../dict"
import { normalizeWorkspace, workspaceKey } from "../../workspace-key"

const log = Log.create({ service: "codegraph-storage" })
const writeConcurrency = 4
const derivedWindow = 64
const cacheLimit = 64 * 1024 * 1024
type ScanState = "never" | "interrupted" | "complete" | "needs-rebuild"

export class CodeGraphJsonStorage implements ICodeGraphStorage {
  private readonly workspace: string
  private readonly key: string
  private manifest?: CodeGraphManifest
  private stage?: CodeGraphManifest
  private old?: CodeGraphManifest
  private seen?: Set<string>
  private readonly cache = new Map<string, { graph: CodeGraphFileGraph; bytes: number }>()
  private readonly loads = new Map<string, Promise<CodeGraphFileGraph | undefined>>()
  private cacheBytes = 0
  private schemaMismatch = false
  private parserMismatch = false
  private invalid = false
  private rebuilding = false
  private migrated = false
  private scan?: ScanState
  private checkpointFiles = 0
  private checkpointAt = 0

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

  public async upsertFileGraph(filePath: string, fileHash: string, graph: CodeGraphFileGraph): Promise<void> {
    if (!this.canWrite()) return

    const rel = this.relative(filePath)
    const manifest = this.active()
    const existing = own(manifest.records, rel)
    if (existing?.status === "ok" && existing.fileHash === fileHash) {
      this.markSeen(rel)
      return
    }

    if (!this.rebuilding) manifest.dataGeneration = globalThis.crypto.randomUUID()
    const record = this.record(rel, "ok", fileHash, manifest.dataGeneration)
    const data: CodeGraphFileGraph = {
      ...graph,
      workspacePath: this.opts.workspacePath,
      filePath: rel,
      fileHash,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      updatedAt: record.updatedAt,
    }
    record.graphParts = await this.writeGraph(rel, data, manifest.dataGeneration!)
    manifest.records[rel] = record
    manifest.shards = this.graphShards(manifest)
    this.remember(record, data)
    this.markSeen(rel)

    if (this.rebuilding) await this.checkpoint(manifest)
    else await this.commitActive(manifest)
  }

  public async removeFileGraph(filePath: string): Promise<void> {
    await this.markFileGraphStatus(filePath, "stale")
  }

  public async getFileGraph(filePath: string): Promise<CodeGraphFileGraph | undefined> {
    const rel = this.relative(filePath)
    const staged = this.rebuilding ? this.stage : undefined
    const record = staged ? own(staged.records, rel) : undefined
    if (record && record.status !== "ok") return undefined
    if (staged && record?.status === "ok") return this.readGraph(record)
    const manifest = this.load()
    const current = own(manifest.records, rel)
    if (!current || current.status !== "ok") return undefined
    const graph = await this.readGraph(current)
    if (!graph || graph.fileHash !== current.fileHash) return undefined
    return graph
  }

  public async listFiles(): Promise<string[]> {
    if (this.status().needsRebuild) return []
    return Object.values(this.load().records)
      .filter((record) => record.status === "ok")
      .map((record) => record.filePath)
      .sort()
  }

  public async clear(): Promise<void> {
    this.migrated = true
    await rm(this.root, { recursive: true, force: true })
    this.manifest = this.empty()
    this.stage = undefined
    this.old = undefined
    this.seen = undefined
    this.clearCache()
    this.schemaMismatch = false
    this.parserMismatch = false
    this.invalid = false
    this.rebuilding = false
    await this.writeManifest()
    this.scan = "never"
  }

  public async ensureCompatible(): Promise<IndexingCompatibilityDecision> {
    await this.migrateLegacy()
    const manifest = this.readManifestFile(this.manifestPath)
    const decision = this.compatibility(manifest)
    log.info("Code Graph compatibility check", {
      visible: true,
      workspacePath: this.opts.workspacePath,
      action: decision.action,
      reason: decision.reason,
    })
    if (decision.action === "reuse") return decision
    await this.clear()
    return decision
  }

  public status(): CodeGraphStorageStatus {
    this.load()
    const scan = this.getScanState()
    const rebuild = this.needsRebuild() || scan === "needs-rebuild"
    const manifest = rebuild ? (this.old ?? this.empty()) : this.manifest!
    const records = Object.values(manifest.records)
    const valid = rebuild ? 0 : records.filter((record) => record.status === "ok").length
    const status: CodeGraphStorageStatus = {
      workspacePath: this.opts.workspacePath,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      recordCount: records.length,
      validFileCount: valid,
      parseErrorCount: records.filter((record) => record.status === "parse_error").length,
      unsupportedCount: records.filter((record) => record.status === "unsupported").length,
      staleCount: records.filter((record) => record.status === "stale").length,
      schemaMismatch: this.schemaMismatch,
      parserMismatch: this.parserMismatch,
      needsRebuild: rebuild,
      evidenceAvailable: false,
      graphDirectory: this.root,
    }
    if (!rebuild && scan === "complete" && manifest.lastFullScanAt) status.lastFullScanAt = manifest.lastFullScanAt
    return status
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

  public async markFileGraphStatus(
    filePath: string,
    status: Exclude<CodeGraphFileRecordStatus, "ok">,
    input: CodeGraphStatusInput = {},
  ): Promise<void> {
    if (!this.canWrite()) return

    const rel = this.relative(filePath)
    const manifest = this.active()
    if (!this.rebuilding) manifest.dataGeneration = globalThis.crypto.randomUUID()
    const existing = own(manifest.records, rel)
    const record: CodeGraphFileRecord = {
      filePath: rel,
      graphFile: existing?.graphFile ?? this.graphName(rel, manifest.dataGeneration),
      status,
      updatedAt: this.now(),
    }
    const hash = input.fileHash ?? existing?.fileHash
    if (hash) record.fileHash = hash
    if (input.error) record.error = input.error.slice(0, 500)
    manifest.records[rel] = record
    this.forget(existing)
    if (status !== "stale") this.markSeen(rel)
    if (this.rebuilding) await this.checkpoint(manifest)
    else await this.commitActive(manifest)
  }

  public async beginFullScan(): Promise<void> {
    this.scan = undefined
    await this.migrateLegacy()
    const current = this.load()
    this.stage =
      this.loadStage() ?? (this.needsRebuild() ? this.empty(globalThis.crypto.randomUUID()) : this.scanBase(current))
    this.seen = new Set()
    this.checkpointFiles = 0
    this.checkpointAt = Date.now()
    this.clearCache()
    this.schemaMismatch = false
    this.parserMismatch = false
    this.invalid = false
    this.rebuilding = true
    await this.writeStageManifest()
    this.scan = "interrupted"
  }

  public async markFullScanComplete(): Promise<void> {
    if (!this.canWrite()) return
    const manifest = this.active()
    this.pruneUnseen(manifest)
    manifest.lastFullScanAt = this.now()
    await this.commit(manifest, this.stageManifestPath)
    await rename(this.stageManifestPath, this.manifestPath)
    this.manifest = manifest
    this.stage = undefined
    this.seen = undefined
    this.clearCache()
    this.rebuilding = false
    this.scan = "complete"
    await this.cleanupOldShardGenerations()
  }

  public async cleanupAbandonedArtifacts(): Promise<IndexingCleanupStats> {
    const stats = emptyCleanupStats()
    const root = await cleanupRoot(this.root, stats, "codegraph")
    if (!root) return stats

    const manifest = this.readManifestFile(this.manifestPath)
    const stage = this.readManifestFile(this.stageManifestPath)
    if (manifest?.workspacePath && normalizeWorkspace(manifest.workspacePath) !== this.workspace) {
      stats.skipped.push("codegraph: active manifest workspace mismatch")
      return stats
    }
    if (stage?.workspacePath && normalizeWorkspace(stage.workspacePath) !== this.workspace) {
      stats.skipped.push("codegraph: rebuild manifest workspace mismatch")
      return stats
    }

    if (!manifest && !stage) return stats

    const keep = new Set(
      [manifest, stage]
        .filter((item): item is CodeGraphManifest => item !== undefined)
        .flatMap((item) => (item.shards ?? []).flatMap((shard) => shard.parts.map((part) => normalize(part.path)))),
    )
    for (const item of [manifest, stage]) {
      if (!item) continue
      for (const part of this.derivedParts(item)) keep.add(normalize(part.path))
    }
    await this.cleanupShards(root, keep, stats)
    await this.cleanupDerived(root, keep, stats)
    return stats
  }

  private get root() {
    return path.join(this.opts.cacheDirectory, CODE_GRAPH_STORAGE_DIR, this.key, CODE_GRAPH_STORAGE_VERSION_DIR)
  }

  private get legacyRoot() {
    return path.join(this.opts.cacheDirectory, CODE_GRAPH_STORAGE_DIR, CODE_GRAPH_STORAGE_VERSION_DIR)
  }

  private get shards() {
    return path.join(this.root, "shards")
  }

  private get derived() {
    return path.join(this.root, "derived")
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
    return this.invalid || this.schemaMismatch || this.parserMismatch
  }

  private markSeen(rel: string): void {
    if (this.rebuilding) this.seen?.add(rel)
  }

  private pruneUnseen(manifest: CodeGraphManifest): void {
    if (!this.rebuilding || !this.seen) return
    for (const rel of Object.keys(manifest.records)) {
      if (this.seen.has(rel)) continue
      const record = manifest.records[rel]
      delete manifest.records[rel]
      this.forget(record)
    }
  }

  private async commitActive(manifest: CodeGraphManifest): Promise<void> {
    manifest.shards = this.graphShards(manifest)
    await this.atomicJson(this.manifestPath, manifest)
    this.manifest = manifest
    await this.cleanupOldShardGenerations()
  }

  private async checkpoint(manifest: CodeGraphManifest): Promise<void> {
    this.checkpointFiles += 1
    const now = Date.now()
    if (this.checkpointFiles < 64 && now - this.checkpointAt < 2_000) return
    manifest.shards = this.graphShards(manifest)
    await this.writeStageManifest()
    this.checkpointFiles = 0
    this.checkpointAt = now
  }

  private async commit(manifest: CodeGraphManifest, file: string): Promise<void> {
    const generation = manifest.dataGeneration ?? globalThis.crypto.randomUUID()
    manifest.dataGeneration = generation
    manifest.shards = this.graphShards(manifest)
    manifest.derived = this.emptyDerived()
    const records = Object.values(manifest.records)
      .filter((record) => record.status === "ok")
      .sort((left, right) => left.filePath.localeCompare(right.filePath))

    const local = CODEGRAPH_DERIVED_SIDECAR_FIELDS.filter(
      (field) => field !== "directoryStats" && field !== "moduleStats",
    )
    for (let index = 0; index < records.length; index += derivedWindow) {
      const builder = new CodeGraphDerivedIndexBuilder(local)
      for (const record of records.slice(index, index + derivedWindow)) {
        const graph = await this.readGraph(record)
        if (graph) builder.add(graph)
      }
      await this.writeDerived(manifest, builder, `derived/${generation}/batch-${index / derivedWindow}`)
    }

    const aggregate = new CodeGraphDerivedIndexBuilder(["directoryStats", "moduleStats"])
    for (const record of records) {
      const graph = await this.readGraph(record)
      if (graph) aggregate.add(graph)
    }
    await this.writeDerived(manifest, aggregate, `derived/${generation}/aggregate`)
    await this.atomicJson(file, manifest)
  }

  private async migrateLegacy(): Promise<void> {
    if (this.migrated) return
    this.migrated = true
    if (existsSync(this.root) || !existsSync(this.legacyRoot)) return

    const manifest = this.readManifestFile(path.join(this.legacyRoot, "manifest.json"))
    const interrupted = existsSync(path.join(this.legacyRoot, "manifest.rebuild.json"))
    const decision = this.compatibility(manifest, this.legacyRoot)
    if (interrupted || decision.action !== "reuse") {
      log.warn("legacy Code Graph cache retained without migration", {
        visible: true,
        workspacePath: this.opts.workspacePath,
        reason: interrupted ? "interrupted legacy scan" : decision.reason,
      })
      return
    }

    await mkdir(path.dirname(this.root), { recursive: true })
    try {
      await rename(this.legacyRoot, this.root)
    } catch (err) {
      log.warn("legacy Code Graph cache migration skipped", {
        visible: true,
        workspacePath: this.opts.workspacePath,
        error: err instanceof Error ? err.message : String(err),
      })
      return
    }

    this.manifest = undefined
    this.stage = undefined
    this.old = undefined
    this.seen = undefined
    this.clearCache()
    this.schemaMismatch = false
    this.parserMismatch = false
    this.invalid = false
    this.rebuilding = false
    this.scan = undefined
    log.info("legacy Code Graph cache migrated", {
      visible: true,
      workspacePath: this.opts.workspacePath,
      graphDirectory: this.root,
    })
  }

  private async writeDerived(
    manifest: CodeGraphManifest,
    builder: CodeGraphDerivedIndexBuilder,
    basePath: string,
  ): Promise<void> {
    const sidecar = splitCodeGraphDerivedIndex(builder.build(), { basePath })
    await writeParts(sidecar.parts, async (part) => {
      await this.atomicJson(path.join(this.root, part.path), part.payload)
    })
    for (const field of CODEGRAPH_DERIVED_SIDECAR_FIELDS) {
      manifest.derived!.fields[field].push(...sidecar.manifest.fields[field])
    }
  }

  private async writeGraph(
    rel: string,
    graph: CodeGraphFileGraph,
    generation: string,
  ): Promise<CodeGraphFileRecord["graphParts"]> {
    const key = this.fileKey(rel)
    const parts = splitCodeGraphFilesForStorage(
      { [rel]: graph },
      {
        shardKey: key,
        label: `file ${rel}`,
        basePath: this.graphName(rel, generation),
      },
    )
    await writeParts(parts, async (part) => {
      await this.atomicJson(path.join(this.root, part.path), part.payload)
    })
    return parts.map((part) => ({
      key: part.key,
      path: part.path,
      entries: part.entries,
      estimatedBytes: part.estimatedBytes,
    }))
  }

  private readGraph(record: CodeGraphFileRecord): Promise<CodeGraphFileGraph | undefined> {
    const key = this.cacheKey(record)
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return Promise.resolve(cached.graph)
    }
    const active = this.loads.get(key)
    if (active) return active
    const load = this.loadGraph(record).finally(() => this.loads.delete(key))
    this.loads.set(key, load)
    return load
  }

  private async loadGraph(record: CodeGraphFileRecord): Promise<CodeGraphFileGraph | undefined> {
    if (!record.graphParts?.length) return undefined
    const parts: CodeGraphShardData[] = []
    const key = this.fileKey(record.filePath)
    for (const part of record.graphParts) {
      const payload = await this.readJson<CodeGraphShardData>(part.path)
      if (payload.key !== key || payload.part !== part.key) {
        throw new Error(`Code graph file ${record.filePath} part ${part.key} does not match the manifest.`)
      }
      parts.push(payload)
    }
    const graph = mergeCodeGraphFileStorageParts(parts)[record.filePath]
    if (graph) this.remember(record, graph)
    return graph
  }

  private graphShards(manifest: CodeGraphManifest): CodeGraphShardInfo[] {
    return Object.values(manifest.records)
      .sort((left, right) => left.filePath.localeCompare(right.filePath))
      .flatMap((record) => {
        const parts = record.status === "ok" ? record.graphParts : undefined
        if (!parts?.length) return []
        return [
          {
            key: this.fileKey(record.filePath),
            files: 1,
            functions: 0,
            macros: 0,
            bytes: parts.reduce((sum, part) => sum + part.estimatedBytes, 0),
            parts,
          },
        ]
      })
  }

  private remember(record: CodeGraphFileRecord, graph: CodeGraphFileGraph): void {
    const key = this.cacheKey(record)
    this.forgetPath(record.filePath)
    const bytes = record.graphParts?.reduce((sum, part) => sum + part.estimatedBytes, 0) ?? 0
    if (bytes > cacheLimit) return
    this.cache.set(key, { graph, bytes })
    this.cacheBytes += bytes
    while (this.cacheBytes > cacheLimit) {
      const oldest = this.cache.entries().next().value as
        | [string, { graph: CodeGraphFileGraph; bytes: number }]
        | undefined
      if (!oldest) break
      this.cache.delete(oldest[0])
      this.cacheBytes -= oldest[1].bytes
    }
  }

  private forget(record: CodeGraphFileRecord | undefined): void {
    if (!record) return
    const key = this.cacheKey(record)
    const cached = this.cache.get(key)
    if (!cached) return
    this.cache.delete(key)
    this.cacheBytes -= cached.bytes
  }

  private forgetPath(file: string): void {
    const prefix = `${file}\0`
    for (const [key, cached] of this.cache) {
      if (!key.startsWith(prefix)) continue
      this.cache.delete(key)
      this.cacheBytes -= cached.bytes
    }
  }

  private clearCache(): void {
    this.cache.clear()
    this.loads.clear()
    this.cacheBytes = 0
  }

  private cacheKey(record: CodeGraphFileRecord): string {
    return `${record.filePath}\0${record.fileHash ?? ""}`
  }

  private load(): CodeGraphManifest {
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
    if (parsed.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION || parsed.parserVersion !== CODE_GRAPH_PARSER_VERSION) {
      this.old = parsed
      this.schemaMismatch = parsed.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION
      this.parserMismatch = parsed.parserVersion !== CODE_GRAPH_PARSER_VERSION
      this.manifest = this.empty()
      return this.manifest
    }

    this.manifest = {
      workspacePath: parsed.workspacePath || this.opts.workspacePath,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      ...(parsed.dataGeneration ? { dataGeneration: parsed.dataGeneration } : {}),
      ...(parsed.lastFullScanAt ? { lastFullScanAt: parsed.lastFullScanAt } : {}),
      records: copy(parsed.records),
      shards: parsed.shards ?? [],
      derived: parsed.derived ?? this.emptyDerived(),
    }
    return this.manifest
  }

  private loadStage(): CodeGraphManifest | undefined {
    if (this.stage) return this.stage
    if (!existsSync(this.stageManifestPath)) return undefined
    const parsed = this.readManifestFile(this.stageManifestPath)
    if (!parsed) return undefined
    if (parsed.workspacePath && normalizeWorkspace(parsed.workspacePath) !== this.workspace) return undefined
    if (parsed.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION || parsed.parserVersion !== CODE_GRAPH_PARSER_VERSION) {
      return undefined
    }
    this.stage = {
      workspacePath: parsed.workspacePath || this.opts.workspacePath,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      dataGeneration: parsed.dataGeneration ?? globalThis.crypto.randomUUID(),
      records: copy(parsed.records),
      shards: parsed.shards ?? [],
      derived: parsed.derived ?? this.emptyDerived(),
      ...(parsed.lastFullScanAt ? { lastFullScanAt: parsed.lastFullScanAt } : {}),
    }
    return this.stage
  }

  private readManifestFile(file: string): CodeGraphManifest | undefined {
    if (!existsSync(file)) return undefined
    try {
      return JSON.parse(readFileSync(file, "utf-8")) as CodeGraphManifest
    } catch (err) {
      void err
      return undefined
    }
  }

  private compatibility(manifest: CodeGraphManifest | undefined, root = this.root): IndexingCompatibilityDecision {
    if (!manifest) return { action: "rebuild", reason: "missing compatibility metadata" }
    if (!manifest.workspacePath) return { action: "rebuild", reason: "missing compatibility metadata" }
    if (normalizeWorkspace(manifest.workspacePath) !== this.workspace)
      return { action: "rebuild", reason: "workspace mismatch" }
    if (manifest.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION)
      return { action: "rebuild", reason: "schema mismatch" }
    if (manifest.parserVersion !== CODE_GRAPH_PARSER_VERSION) return { action: "rebuild", reason: "parser mismatch" }
    if (!manifest.records || typeof manifest.records !== "object" || Array.isArray(manifest.records)) {
      return { action: "rebuild", reason: "missing compatibility metadata" }
    }
    if (!Array.isArray(manifest.shards)) return { action: "rebuild", reason: "storage layout changed" }
    if (!manifest.derived?.fields) return { action: "rebuild", reason: "storage layout changed" }
    if (
      manifest.derived.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION ||
      manifest.derived.parserVersion !== CODE_GRAPH_PARSER_VERSION
    ) {
      return { action: "rebuild", reason: "storage layout changed" }
    }
    for (const shard of manifest.shards) {
      for (const part of shard.parts) {
        if (!existsSync(path.join(root, part.path))) return { action: "rebuild", reason: "missing graph shard" }
      }
    }
    for (const record of Object.values(manifest.records)) {
      if (record.status !== "ok") continue
      if (!record.graphParts?.length) return { action: "rebuild", reason: "storage layout changed" }
      for (const part of record.graphParts) {
        if (!existsSync(path.join(root, part.path))) return { action: "rebuild", reason: "missing graph shard" }
      }
    }
    for (const field of CODEGRAPH_DERIVED_SIDECAR_FIELDS) {
      const parts = manifest.derived.fields[field]
      if (!Array.isArray(parts)) return { action: "rebuild", reason: "storage layout changed" }
      for (const part of parts) {
        if (!existsSync(path.join(root, part.path)))
          return { action: "rebuild", reason: "missing graph derived sidecar" }
      }
    }
    return { action: "reuse", reason: "compatible" }
  }

  private active(): CodeGraphManifest {
    if (!this.rebuilding) return this.load()
    const stage = this.loadStage()
    if (stage) return stage
    this.stage = this.empty(globalThis.crypto.randomUUID())
    return this.stage
  }

  private empty(dataGeneration?: string): CodeGraphManifest {
    return {
      workspacePath: this.opts.workspacePath,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      ...(dataGeneration ? { dataGeneration } : {}),
      records: dict(),
      shards: [],
      derived: this.emptyDerived(),
    }
  }

  private clone(manifest: CodeGraphManifest): CodeGraphManifest {
    return {
      workspacePath: manifest.workspacePath || this.opts.workspacePath,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      ...(manifest.dataGeneration ? { dataGeneration: manifest.dataGeneration } : {}),
      ...(manifest.lastFullScanAt ? { lastFullScanAt: manifest.lastFullScanAt } : {}),
      records: copy(structuredClone(manifest.records ?? {})),
      shards: structuredClone(manifest.shards ?? []),
      derived: structuredClone(manifest.derived ?? this.emptyDerived()),
    }
  }

  private scanBase(manifest: CodeGraphManifest): CodeGraphManifest {
    if (!manifest.dataGeneration && Object.keys(manifest.records ?? {}).length === 0)
      return this.empty(globalThis.crypto.randomUUID())
    const next = this.clone(manifest)
    next.dataGeneration = globalThis.crypto.randomUUID()
    return next
  }

  private record(
    filePath: string,
    status: CodeGraphFileRecordStatus,
    fileHash?: string,
    generation?: string,
  ): CodeGraphFileRecord {
    const record: CodeGraphFileRecord = {
      filePath,
      graphFile: this.graphName(filePath, generation),
      status,
      updatedAt: this.now(),
    }
    if (fileHash) record.fileHash = fileHash
    return record
  }

  private relative(filePath: string): string {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(this.opts.workspacePath, filePath)
    const rel = path.relative(this.opts.workspacePath, abs)
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return filePath.replace(/\\/g, "/")
    return rel.split(path.sep).join("/")
  }

  private graphName(filePath: string, generation = "active"): string {
    return `shards/${generation}/${this.fileKey(filePath)}`
  }

  private fileKey(file: string): string {
    return createHash("sha256").update(normalize(file)).digest("hex")
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
    await writeFile(tmp, encodeBoundedJson(value, { label: "code graph JSON" }))
    await rename(tmp, file)
  }

  private async cleanupShards(root: string, keep: Set<string>, stats: IndexingCleanupStats): Promise<void> {
    for (const item of await list(this.shards)) {
      if (!item.directory) continue
      await this.cleanupTree(item.path, root, keep, stats)
      if ((await list(item.path)).length === 0) {
        await removeSafe(item.path, root, stats, `codegraph: empty shard generation ${item.name}`)
      }
    }
  }

  private async cleanupDerived(root: string, keep: Set<string>, stats: IndexingCleanupStats): Promise<void> {
    for (const item of await list(this.derived)) {
      if (!item.directory) continue
      await this.cleanupTree(item.path, root, keep, stats)
      if ((await list(item.path)).length === 0) {
        await removeSafe(item.path, root, stats, `codegraph: empty derived generation ${item.name}`)
      }
    }
  }

  private async cleanupTree(dir: string, root: string, keep: Set<string>, stats: IndexingCleanupStats): Promise<void> {
    for (const item of await list(dir)) {
      if (item.directory) {
        await this.cleanupTree(item.path, root, keep, stats)
        continue
      }
      if (!item.file) {
        await removeSafe(item.path, root, stats, `codegraph: unsupported shard entry ${item.name}`)
        continue
      }
      const file = normalize(relpath(this.root, item.path))
      if (keep.has(file)) continue
      await removeSafe(item.path, root, stats, `codegraph: orphan shard part ${item.name}`)
    }
  }

  private async cleanupOldShardGenerations(): Promise<void> {
    const manifest = this.manifest
    if (!manifest?.dataGeneration) return
    const stats = emptyCleanupStats()
    const root = await cleanupRoot(this.root, stats, "codegraph")
    if (!root) return
    const keep = new Set((manifest.shards ?? []).flatMap((shard) => shard.parts.map((part) => normalize(part.path))))
    for (const part of this.derivedParts(manifest)) keep.add(normalize(part.path))
    await this.cleanupShards(root, keep, stats)
    await this.cleanupDerived(root, keep, stats)
  }

  private emptyDerived(): CodeGraphDerivedSidecarManifest {
    const fields = Object.create(null) as CodeGraphDerivedSidecarManifest["fields"]
    for (const field of CODEGRAPH_DERIVED_SIDECAR_FIELDS) fields[field] = []
    return {
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      fields,
    }
  }

  private derivedParts(manifest: CodeGraphManifest) {
    const fields = manifest.derived?.fields
    if (!fields) return []
    return CODEGRAPH_DERIVED_SIDECAR_FIELDS.flatMap((field) => fields[field] ?? [])
  }
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

function normalize(file: string): string {
  return file.replace(/\\/g, "/")
}
