import { existsSync, readFileSync } from "fs"
import { mkdir, readFile, rename, rm, unlink, writeFile } from "fs/promises"
import path from "path"
import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  CODE_GRAPH_STORAGE_DIR,
  CODE_GRAPH_STORAGE_VERSION_DIR,
} from "../constants"
import type {
  CodeGraphFileGraph,
  CodeGraphFileRecord,
  CodeGraphFileRecordStatus,
  CodeGraphManifest,
  CodeGraphStorageStatus,
  CodeGraphStatusInput,
  ICodeGraphStorage,
} from "../types"

export class CodeGraphJsonStorage implements ICodeGraphStorage {
  private manifest?: CodeGraphManifest
  private stage?: CodeGraphManifest
  private old?: CodeGraphManifest
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
    const record = this.record(rel, "ok", fileHash, manifest.dataGeneration)
    const existing = manifest.records[rel]
    const file = this.filePath(record.graphFile)
    if (existing?.status === "ok" && existing.fileHash === fileHash && existsSync(file)) return

    const data: CodeGraphFileGraph = {
      ...graph,
      workspacePath: this.opts.workspacePath,
      filePath: rel,
      fileHash,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      updatedAt: record.updatedAt,
    }
    await this.atomicJson(file, data)
    manifest.records[rel] = record
    await this.writeActiveManifest()
  }

  public async removeFileGraph(filePath: string): Promise<void> {
    await this.markFileGraphStatus(filePath, "stale")
  }

  public async getFileGraph(filePath: string): Promise<CodeGraphFileGraph | undefined> {
    const rel = this.relative(filePath)
    const staged = this.stage && this.readGraph(this.stage, rel)
    if (staged) return staged
    return this.readGraph(this.load(), rel)
  }

  private readGraph(manifest: CodeGraphManifest, rel: string): CodeGraphFileGraph | undefined {
    const record = manifest.records[rel]
    if (!record || record.status !== "ok") return undefined
    const file = this.filePath(record.graphFile)
    if (!existsSync(file)) return undefined
    const graph = JSON.parse(readFileSync(file, "utf-8")) as CodeGraphFileGraph
    if (graph.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION) return undefined
    if (graph.parserVersion !== CODE_GRAPH_PARSER_VERSION) return undefined
    if (graph.fileHash !== record.fileHash) return undefined
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
    this.schemaMismatch = false
    this.parserMismatch = false
    this.rebuilding = false
    await this.writeManifest()
  }

  public status(): CodeGraphStorageStatus {
    this.load()
    const rebuild = this.needsRebuild()
    const manifest = rebuild ? this.old ?? this.empty() : this.manifest!
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
    const existing = manifest.records[rel]
    const graphFile = existing?.graphFile ?? this.graphName(rel, manifest.dataGeneration)
    await this.deleteGraphFile(graphFile)
    const record: CodeGraphFileRecord = {
      filePath: rel,
      graphFile,
      status,
      updatedAt: this.now(),
    }
    const hash = input.fileHash ?? existing?.fileHash
    if (hash) record.fileHash = hash
    if (input.error) record.error = input.error.slice(0, 500)
    manifest.records[rel] = record
    await this.writeActiveManifest()
  }

  public async beginFullScan(): Promise<void> {
    this.load()
    this.stage = this.loadStage() ?? this.empty(globalThis.crypto.randomUUID())
    this.schemaMismatch = false
    this.parserMismatch = false
    this.rebuilding = true
    await this.writeStageManifest()
  }

  public async markFullScanComplete(): Promise<void> {
    if (!this.canWrite()) return
    const manifest = this.active()
    manifest.lastFullScanAt = this.now()
    await this.writeStageManifest()
    await rename(this.stageManifestPath, this.manifestPath)
    this.manifest = manifest
    this.stage = undefined
    this.rebuilding = false
  }

  private get root() {
    return path.join(this.opts.cacheDirectory, CODE_GRAPH_STORAGE_DIR, CODE_GRAPH_STORAGE_VERSION_DIR)
  }

  private get files() {
    return path.join(this.root, "files")
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
    return this.schemaMismatch || this.parserMismatch
  }

  private load(): CodeGraphManifest {
    if (this.manifest) return this.manifest
    if (!existsSync(this.manifestPath)) {
      this.manifest = this.empty()
      return this.manifest
    }

    const parsed = JSON.parse(readFileSync(this.manifestPath, "utf-8")) as CodeGraphManifest
    if (parsed.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION || parsed.parserVersion !== CODE_GRAPH_PARSER_VERSION) {
      this.old = parsed
      this.schemaMismatch = parsed.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION
      this.parserMismatch = parsed.parserVersion !== CODE_GRAPH_PARSER_VERSION
      this.manifest = this.empty()
      return this.manifest
    }

    const current: CodeGraphManifest = {
      workspacePath: parsed.workspacePath || this.opts.workspacePath,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      ...(parsed.dataGeneration ? { dataGeneration: parsed.dataGeneration } : {}),
      records: parsed.records ?? {},
    }
    if (parsed.lastFullScanAt) current.lastFullScanAt = parsed.lastFullScanAt
    this.manifest = current
    return this.manifest
  }

  private loadStage(): CodeGraphManifest | undefined {
    if (this.stage) return this.stage
    if (!existsSync(this.stageManifestPath)) return undefined
    const parsed = JSON.parse(readFileSync(this.stageManifestPath, "utf-8")) as CodeGraphManifest
    if (parsed.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION || parsed.parserVersion !== CODE_GRAPH_PARSER_VERSION) {
      return undefined
    }
    this.stage = {
      workspacePath: parsed.workspacePath || this.opts.workspacePath,
      graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
      parserVersion: CODE_GRAPH_PARSER_VERSION,
      dataGeneration: parsed.dataGeneration ?? globalThis.crypto.randomUUID(),
      records: parsed.records ?? {},
      ...(parsed.lastFullScanAt ? { lastFullScanAt: parsed.lastFullScanAt } : {}),
    }
    return this.stage
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
      records: {},
    }
  }

  private record(
    filePath: string,
    status: CodeGraphFileRecordStatus,
    fileHash?: string,
    dataGeneration?: string,
  ): CodeGraphFileRecord {
    const record: CodeGraphFileRecord = {
      filePath,
      graphFile: this.graphName(filePath, dataGeneration),
      status,
      updatedAt: this.now(),
    }
    if (fileHash) record.fileHash = fileHash
    return record
  }

  private relative(filePath: string) {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(this.opts.workspacePath, filePath)
    const rel = path.relative(this.opts.workspacePath, abs)
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return filePath.replace(/\\/g, "/")
    return rel.split(path.sep).join("/")
  }

  private graphName(filePath: string, dataGeneration?: string) {
    const file = `${digest(filePath)}.json`
    return dataGeneration ? path.join("files", dataGeneration, file) : file
  }

  private filePath(file: string) {
    if (file.includes("/") || file.includes("\\")) return path.join(this.root, file)
    return path.join(this.files, file)
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

  private async deleteGraphFile(file: string) {
    try {
      await unlink(this.filePath(file))
    } catch (err) {
      const code = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined
      if (code !== "ENOENT") throw err
    }
  }
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
