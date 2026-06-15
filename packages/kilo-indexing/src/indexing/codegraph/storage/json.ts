import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { encodeBoundedJson } from "../bounded-json"
import { cleanupRoot, emptyCleanupStats, list, rel as relpath, removeSafe } from "../../cleanup"
import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  CODE_GRAPH_STORAGE_DIR,
  CODE_GRAPH_STORAGE_VERSION_DIR,
} from "../constants"
import {
  groupGraphsByShard,
  mergeCodeGraphFileStorageParts,
  shardFileName,
  shardKeyForPath,
  splitCodeGraphFilesForStorage,
} from "../file-storage"
import { buildCodeGraphDerivedIndex } from "../derived-index"
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

const log = Log.create({ service: "codegraph-storage" })
const writeConcurrency = 4

export class CodeGraphJsonStorage implements ICodeGraphStorage {
  private manifest?: CodeGraphManifest
  private stage?: CodeGraphManifest
  private old?: CodeGraphManifest
  private seen?: Set<string>
  private pending = new Map<string, CodeGraphFileGraph>()
  private cache?: { generation?: string; graphs: Record<string, CodeGraphFileGraph> }
  private schemaMismatch = false
  private parserMismatch = false
  private rebuilding = false

  constructor(
    private readonly opts: {
      workspacePath: string
      cacheDirectory: string
      clock?: () => Date
    },
  ) {}

  public async upsertFileGraph(filePath: string, fileHash: string, graph: CodeGraphFileGraph): Promise<void> {
    if (!this.canWrite()) return

    const rel = this.relative(filePath)
    const manifest = this.active()
    const existing = own(manifest.records, rel)
    if (existing?.status === "ok" && existing.fileHash === fileHash) {
      this.markSeen(rel)
      return
    }

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
    manifest.records[rel] = record
    this.pending.set(rel, data)
    this.markSeen(rel)

    if (!this.rebuilding) await this.commitActive(manifest)
  }

  public async removeFileGraph(filePath: string): Promise<void> {
    await this.markFileGraphStatus(filePath, "stale")
  }

  public async getFileGraph(filePath: string): Promise<CodeGraphFileGraph | undefined> {
    const rel = this.relative(filePath)
    const staged = this.rebuilding ? this.stage : undefined
    const record = staged ? own(staged.records, rel) : undefined
    if (record && record.status !== "ok") return undefined
    const pending = this.pending.get(rel)
    if (pending) return pending
    if (staged && record?.status === "ok") return (await this.graphs(staged))[rel]
    const manifest = this.load()
    const current = own(manifest.records, rel)
    if (!current || current.status !== "ok") return undefined
    const graph = (await this.graphs(manifest))[rel]
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
    await rm(this.root, { recursive: true, force: true })
    this.manifest = this.empty()
    this.stage = undefined
    this.old = undefined
    this.seen = undefined
    this.pending.clear()
    this.cache = undefined
    this.schemaMismatch = false
    this.parserMismatch = false
    this.rebuilding = false
    await this.writeManifest()
  }

  public async ensureCompatible(): Promise<IndexingCompatibilityDecision> {
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
    const rebuild = this.needsRebuild()
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
    if (!rebuild && manifest.lastFullScanAt) status.lastFullScanAt = manifest.lastFullScanAt
    return status
  }

  public async markFileGraphStatus(
    filePath: string,
    status: Exclude<CodeGraphFileRecordStatus, "ok">,
    input: CodeGraphStatusInput = {},
  ): Promise<void> {
    if (!this.canWrite()) return

    const rel = this.relative(filePath)
    const manifest = this.active()
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
    this.pending.delete(rel)
    if (status !== "stale") this.markSeen(rel)
    if (!this.rebuilding) await this.commitActive(manifest)
  }

  public async beginFullScan(): Promise<void> {
    const current = this.load()
    this.stage = this.needsRebuild() ? this.empty(globalThis.crypto.randomUUID()) : this.scanBase(current)
    this.seen = new Set()
    this.pending.clear()
    this.schemaMismatch = false
    this.parserMismatch = false
    this.rebuilding = true
    await this.writeStageManifest()
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
    this.pending.clear()
    this.rebuilding = false
    await this.cleanupOldShardGenerations()
  }

  public async cleanupAbandonedArtifacts(): Promise<IndexingCleanupStats> {
    const stats = emptyCleanupStats()
    const root = await cleanupRoot(this.root, stats, "codegraph")
    if (!root) return stats

    const manifest = this.readManifestFile(this.manifestPath)
    if (manifest?.workspacePath && manifest.workspacePath !== this.opts.workspacePath) {
      stats.skipped.push("codegraph: active manifest workspace mismatch")
      return stats
    }

    await removeSafe(this.stageManifestPath, root, stats, "codegraph: rebuild manifest")
    this.stage = undefined
    if (!manifest) return stats

    const keep = new Set((manifest.shards ?? []).flatMap((shard) => shard.parts.map((part) => normalize(part.path))))
    for (const part of this.derivedParts(manifest)) keep.add(normalize(part.path))
    await this.cleanupShards(root, keep, manifest.dataGeneration, stats)
    await this.cleanupDerived(root, keep, manifest.dataGeneration, stats)
    return stats
  }

  private get root() {
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
    return this.schemaMismatch || this.parserMismatch
  }

  private markSeen(rel: string): void {
    if (this.rebuilding) this.seen?.add(rel)
  }

  private pruneUnseen(manifest: CodeGraphManifest): void {
    if (!this.rebuilding || !this.seen) return
    for (const rel of Object.keys(manifest.records)) {
      if (this.seen.has(rel)) continue
      delete manifest.records[rel]
      this.pending.delete(rel)
    }
  }

  private async graphs(manifest: CodeGraphManifest): Promise<Record<string, CodeGraphFileGraph>> {
    if (!manifest.shards?.length) return dict()
    const cached = this.cache
    if (cached && cached.generation === manifest.dataGeneration) return cached.graphs
    const parts: CodeGraphShardData[] = []
    for (const shard of manifest.shards) {
      for (const part of shard.parts) {
        const payload = await this.readJson<CodeGraphShardData>(part.path)
        if (payload.key !== shard.key || payload.part !== part.key) {
          throw new Error(`Code graph shard ${shard.key} part ${part.key} does not match the manifest.`)
        }
        parts.push(payload)
      }
    }
    const graphs = mergeCodeGraphFileStorageParts(parts)
    this.cache = { generation: manifest.dataGeneration, graphs }
    return graphs
  }

  private async commitActive(manifest: CodeGraphManifest): Promise<void> {
    await this.commit(manifest, this.manifestPath)
    this.manifest = manifest
    this.pending.clear()
    await this.cleanupOldShardGenerations()
  }

  private async commit(manifest: CodeGraphManifest, file: string): Promise<void> {
    const baseGraphs = await this.graphs(manifest)
    const generation = globalThis.crypto.randomUUID()
    manifest.dataGeneration = generation
    const graphs = Object.create(null) as Record<string, CodeGraphFileGraph>
    for (const [rel, record] of Object.entries(manifest.records)) {
      if (record.status !== "ok") continue
      const graph = this.pending.get(rel) ?? baseGraphs[rel]
      if (!graph) continue
      graphs[rel] = graph
      record.graphFile = this.graphName(rel, generation)
      record.fileHash = graph.fileHash
    }
    const groups = groupGraphsByShard(graphs)
    const shards: CodeGraphShardInfo[] = []
    for (const [key, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const parts = splitCodeGraphFilesForStorage(group, {
        shardKey: key,
        label: `file shard ${key}`,
        basePath: `shards/${generation}/${this.shardDirectoryName(key)}`,
      })
      shards.push({
        key,
        files: Object.keys(group).length,
        functions: Object.values(group).reduce((sum, graph) => sum + graph.functions.length, 0),
        macros: Object.values(group).reduce((sum, graph) => sum + graph.macros.length, 0),
        bytes: 0,
        parts: parts.map((part) => ({
          key: part.key,
          path: part.path,
          entries: part.entries,
          estimatedBytes: part.estimatedBytes,
        })),
      })
      await writeParts(parts, async (part) => {
        await this.atomicJson(path.join(this.root, part.path), part.payload)
      })
    }
    manifest.shards = shards
    const sidecar = splitCodeGraphDerivedIndex(buildCodeGraphDerivedIndex(graphs), {
      basePath: `derived/${generation}`,
    })
    await writeParts(sidecar.parts, async (part) => {
      await this.atomicJson(path.join(this.root, part.path), part.payload)
    })
    manifest.derived = sidecar.manifest
    await this.atomicJson(file, manifest)
    this.cache = { generation, graphs }
  }

  private load(): CodeGraphManifest {
    if (this.manifest) return this.manifest
    if (!existsSync(this.manifestPath)) {
      this.manifest = this.empty()
      return this.manifest
    }

    const parsed = JSON.parse(readFileSync(this.manifestPath, "utf-8")) as CodeGraphManifest
    if (parsed.workspacePath && parsed.workspacePath !== this.opts.workspacePath) {
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
    const parsed = JSON.parse(readFileSync(this.stageManifestPath, "utf-8")) as CodeGraphManifest
    if (parsed.workspacePath && parsed.workspacePath !== this.opts.workspacePath) return undefined
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

  private compatibility(manifest: CodeGraphManifest | undefined): IndexingCompatibilityDecision {
    if (!manifest) return { action: "rebuild", reason: "missing compatibility metadata" }
    if (manifest.workspacePath !== this.opts.workspacePath) return { action: "rebuild", reason: "workspace mismatch" }
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
        if (!existsSync(path.join(this.root, part.path))) return { action: "rebuild", reason: "missing graph shard" }
      }
    }
    for (const field of CODEGRAPH_DERIVED_SIDECAR_FIELDS) {
      const parts = manifest.derived.fields[field]
      if (!Array.isArray(parts)) return { action: "rebuild", reason: "storage layout changed" }
      for (const part of parts) {
        if (!existsSync(path.join(this.root, part.path)))
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
    if (!manifest.dataGeneration && Object.keys(manifest.records ?? {}).length === 0) {
      return this.empty(globalThis.crypto.randomUUID())
    }
    return this.clone(manifest)
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
    return `shards/${generation}/${this.shardDirectoryName(shardKeyForPath(filePath))}`
  }

  private shardDirectoryName(key: string): string {
    return shardFileName(key).replace(/\.json$/i, "") || "root"
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

  private async cleanupShards(
    root: string,
    keep: Set<string>,
    generation: string | undefined,
    stats: IndexingCleanupStats,
  ): Promise<void> {
    for (const item of await list(this.shards)) {
      if (!item.directory) continue
      if (generation && item.name === generation) {
        await this.cleanupTree(item.path, root, keep, stats)
        continue
      }
      await removeSafe(item.path, root, stats, `codegraph: orphan shard generation ${item.name}`)
    }
  }

  private async cleanupDerived(
    root: string,
    keep: Set<string>,
    generation: string | undefined,
    stats: IndexingCleanupStats,
  ): Promise<void> {
    for (const item of await list(this.derived)) {
      if (!item.directory) continue
      if (generation && item.name === generation) {
        await this.cleanupTree(item.path, root, keep, stats)
        continue
      }
      await removeSafe(item.path, root, stats, `codegraph: orphan derived generation ${item.name}`)
    }
  }

  private async cleanupTree(dir: string, root: string, keep: Set<string>, stats: IndexingCleanupStats): Promise<void> {
    for (const item of await list(dir)) {
      if (item.directory) {
        await this.cleanupTree(item.path, root, keep, stats)
        continue
      }
      if (!item.file) continue
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
    await this.cleanupShards(root, keep, manifest.dataGeneration, stats)
    await this.cleanupDerived(root, keep, manifest.dataGeneration, stats)
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
