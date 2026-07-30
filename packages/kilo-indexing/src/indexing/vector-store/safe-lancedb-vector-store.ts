import { createHash } from "crypto"
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises"
import path from "path"
import type { EmbeddingRuntimeProfile } from "../interfaces/embedder"
import type {
  IVectorStore,
  PointStruct,
  VectorStoreCompatibilityDecision,
  VectorStoreSearchResult,
} from "../interfaces/vector-store"
import type { VectorStoreCleanupStats } from "../interfaces/cleanup"
import { validateEmbeddingBatch } from "../embedding-quality"
import { EmbeddingRuntimeStore } from "../embedding-runtime-store"
import { Log } from "../../util/log"
import { LanceDBVectorStore } from "./lancedb-vector-store"

const log = Log.create({ service: "safe-lancedb-store" })

type Manifest = {
  schema: 1
  generation: string
  promotedAt: string
  profile: EmbeddingRuntimeProfile
}

export async function loadActiveEmbeddingProfile(
  workspace: string,
  base: string,
): Promise<EmbeddingRuntimeProfile | undefined> {
  return (await readManifest(workspace, base))?.profile
}

export class SafeLanceDBVectorStore implements IVectorStore {
  private readonly root: string
  private readonly pointer: string
  private active?: IVectorStore
  private activeGeneration?: string
  private writer?: IVectorStore
  private generation?: string
  private candidate = false
  private promoted = false
  private readonly samples = new Map<string, PointStruct>()
  private decision?: VectorStoreCompatibilityDecision

  constructor(
    private readonly workspace: string,
    private readonly base: string,
    private readonly profile: EmbeddingRuntimeProfile,
    private readonly runtime: EmbeddingRuntimeStore,
    private readonly make?: (generation: string) => IVectorStore,
  ) {
    this.root = generationRoot(workspace, base)
    this.pointer = path.join(this.root, "active.json")
  }

  async openExisting(): Promise<void> {
    const manifest = await this.manifest()
    if (!manifest || !sameSpace(manifest.profile, this.profile)) {
      throw new Error("Active LanceDB generation does not match the validated embedding space.")
    }
    const store = this.store(manifest.generation, manifest.profile)
    if (!store.openExisting) throw new Error("The active vector generation cannot be opened read-only.")
    await store.openExisting()
    this.active = store
    this.activeGeneration = manifest.generation
    this.writer = store
    this.generation = manifest.generation
    this.promoted = true
  }

  async initialize(): Promise<boolean> {
    if (this.writer) return this.candidate
    const manifest = await this.manifest()
    if (manifest && compatible(manifest.profile, this.profile)) {
      const store = this.store(manifest.generation, manifest.profile)
      if (!store.openExisting) throw new Error("The active vector generation cannot be opened read-only.")
      await store.openExisting()
      this.active = store
      this.activeGeneration = manifest.generation
      this.writer = store
      this.generation = manifest.generation
      this.promoted = true
      this.decision = { action: "reuse", reason: "validated active generation", created: false }
      return false
    }

    if (manifest && sameSpace(manifest.profile, this.profile)) {
      const active = this.store(manifest.generation, manifest.profile)
      if (!active.openExisting) throw new Error("The fallback vector generation cannot be opened read-only.")
      await active.openExisting()
      this.active = active
      this.activeGeneration = manifest.generation
    }

    const generation = `${Date.now()}-${globalThis.crypto.randomUUID()}`
    const store = this.store(generation)
    await store.initialize()
    this.writer = store
    this.generation = generation
    this.candidate = true
    this.promoted = false
    this.decision = {
      action: "rebuild",
      reason: manifest ? "embedding runtime profile changed" : "missing active generation",
      created: true,
    }
    return true
  }

  getLastCompatibilityDecision(): VectorStoreCompatibilityDecision | undefined {
    return this.decision
  }

  async upsertPoints(points: PointStruct[]): Promise<void> {
    if (points.length === 0) return
    validateEmbeddingBatch(
      points.map((point) => point.vector),
      {
        expectedCount: points.length,
        expectedDimension: this.profile.dimension,
        dense: true,
      },
    )
    for (const point of points) {
      const file = String(point.payload.filePath ?? "")
      if (file) this.samples.set(file, point)
      if (this.samples.size > 16) this.samples.delete(this.samples.keys().next().value!)
    }
    await this.target().upsertPoints(points)
  }

  async search(
    queryVector: number[],
    directoryPrefix?: string,
    minScore?: number,
    maxResults?: number,
  ): Promise<VectorStoreSearchResult[]> {
    validateEmbeddingBatch([queryVector], {
      expectedCount: 1,
      expectedDimension: this.profile.dimension,
      dense: true,
    })
    const store = this.active
    if (!store) throw new Error("No validated active embedding index is available.")
    return store.search(queryVector, directoryPrefix, minScore, maxResults)
  }

  deletePointsByFilePath(file: string): Promise<void> {
    this.samples.delete(file)
    return this.target().deletePointsByFilePath(file)
  }

  deletePointsByMultipleFilePaths(files: string[]): Promise<void> {
    for (const file of files) this.samples.delete(file)
    return this.target().deletePointsByMultipleFilePaths(files)
  }

  activateFileGeneration(file: string, generation: string, run: string): Promise<void> {
    return this.target().activateFileGeneration?.(file, generation, run) ?? Promise.resolve()
  }

  deleteInactiveFilePoints(file: string, generation: string): Promise<void> {
    return this.target().deleteInactiveFilePoints?.(file, generation) ?? Promise.resolve()
  }

  cleanupInactivePoints(): Promise<VectorStoreCleanupStats> {
    return this.target().cleanupInactivePoints?.() ?? Promise.resolve({ skipped: [] })
  }

  getCollectionName(): string {
    return path.join(this.root, this.profile.fingerprintDigest, "vector")
  }

  async clearCollection(): Promise<void> {
    if (this.candidate && !this.promoted) {
      this.samples.clear()
      await this.target().clearCollection()
      return
    }
    if (!this.active) {
      if (!this.writer) await this.initialize()
      this.samples.clear()
      await this.target().clearCollection()
      return
    }

    const generation = `${Date.now()}-${globalThis.crypto.randomUUID()}`
    const store = this.store(generation)
    await store.initialize()
    this.writer = store
    this.generation = generation
    this.candidate = true
    this.promoted = false
    this.samples.clear()
    this.decision = {
      action: "rebuild",
      reason: "isolated candidate reset",
      created: true,
    }
  }

  async deleteCollection(): Promise<void> {
    await this.closeStores()
    await rm(this.root, { recursive: true, force: true })
    this.active = undefined
    this.activeGeneration = undefined
    this.writer = undefined
    this.generation = undefined
    this.candidate = false
    this.promoted = false
  }

  async collectionExists(): Promise<boolean> {
    if (this.writer) return this.writer.collectionExists()
    const manifest = await this.manifest()
    return Boolean(manifest && compatible(manifest.profile, this.profile))
  }

  async hasIndexedData(): Promise<boolean> {
    if (this.candidate && !this.promoted) return false
    const store = this.active ?? this.writer
    return store ? store.hasIndexedData() : false
  }

  async markIndexingComplete(): Promise<void> {
    const store = this.target()
    await store.markIndexingComplete()
    if (!this.candidate) return
    if (this.samples.size === 0) throw new Error("Candidate embedding index contains no validated source vectors.")
    const checks = await Promise.all(
      [...this.samples.values()].map(async (sample) => {
        const found = await store.search(sample.vector, sample.payload.filePath, 0, 5)
        return found.some((item) => item.id === sample.id)
      }),
    )
    if (!checks.every(Boolean)) {
      throw new Error("Candidate embedding index failed its source-backed readback check.")
    }
    const generation = this.generation
    if (!generation) throw new Error("Candidate embedding generation identity is missing.")
    const manifest: Manifest = {
      schema: 1,
      generation,
      promotedAt: new Date().toISOString(),
      profile: this.profile,
    }
    await this.runtime.save(this.profile)
    await mkdir(this.root, { recursive: true })
    const temp = `${this.pointer}.${globalThis.crypto.randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(manifest), "utf8")
    await rename(temp, this.pointer)
    const previous = this.active
    this.active = store
    this.activeGeneration = generation
    this.writer = store
    this.candidate = false
    this.promoted = true
    await previous?.close?.()
    void this.cleanup(generation).catch((err) => {
      log.warn("failed to clean old LanceDB generations", {
        workspace: this.workspace,
        err,
      })
    })
  }

  markIndexingIncomplete(): Promise<void> {
    return this.target().markIndexingIncomplete()
  }

  async abortCandidate(): Promise<void> {
    if (!this.candidate || this.promoted || !this.generation) return
    const generation = this.generation
    await this.writer?.close?.()
    await rm(path.join(this.root, generation), { recursive: true, force: true })
    this.writer = this.active
    this.generation = this.activeGeneration
    this.candidate = false
    this.promoted = Boolean(this.active)
    this.samples.clear()
  }

  async close(): Promise<void> {
    await this.abortCandidate()
    await this.closeStores()
  }

  private target(): IVectorStore {
    if (!this.writer) throw new Error("LanceDB generation is not initialized.")
    return this.writer
  }

  private store(generation: string, profile = this.profile): IVectorStore {
    if (this.make) return this.make(generation)
    return new LanceDBVectorStore(this.workspace, profile.dimension, path.join(this.root, generation), {
      provider: profile.provider,
      modelId: profile.modelId,
      dimension: profile.dimension,
      dimensionMode: profile.dimensionMode,
      requestedDimension: profile.requestedDimension,
      endpointDigest: profile.endpointDigest,
      fingerprintDigest: profile.fingerprintDigest,
      qualityVersion: profile.qualityVersion,
      instructionVersion: profile.instructionVersion,
    })
  }

  private async manifest(): Promise<Manifest | undefined> {
    return readManifest(this.workspace, this.base)
  }

  private async closeStores(): Promise<void> {
    const stores = [...new Set([this.active, this.writer].filter((store): store is IVectorStore => !!store))]
    await Promise.all(stores.map((store) => store.close?.()))
  }

  private async cleanup(active: string): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => [])
    const dirs = entries.filter((entry) => entry.isDirectory() && entry.name !== active)
    const dated = await Promise.all(
      dirs.map(async (entry) => ({
        name: entry.name,
        time: await stat(path.join(this.root, entry.name)).then((item) => item.mtimeMs).catch(() => 0),
      })),
    )
    const remove = dated.sort((left, right) => right.time - left.time).slice(1)
    await Promise.all(remove.map((entry) => rm(path.join(this.root, entry.name), { recursive: true, force: true })))
  }
}

function compatible(left: EmbeddingRuntimeProfile, right: EmbeddingRuntimeProfile): boolean {
  return (
    left.provider === right.provider &&
    left.modelId === right.modelId &&
    left.dimensionMode === right.dimensionMode &&
    left.requestedDimension === right.requestedDimension &&
    left.dimension === right.dimension &&
    left.endpointDigest === right.endpointDigest &&
    left.fingerprintDigest === right.fingerprintDigest &&
    left.qualityVersion === right.qualityVersion &&
    left.instructionVersion === right.instructionVersion
  )
}

function sameSpace(left: EmbeddingRuntimeProfile, right: EmbeddingRuntimeProfile): boolean {
  return (
    left.provider === right.provider &&
    left.modelId === right.modelId &&
    left.dimension === right.dimension &&
    left.endpointDigest === right.endpointDigest &&
    left.fingerprintDigest === right.fingerprintDigest &&
    left.qualityVersion === right.qualityVersion &&
    left.instructionVersion === right.instructionVersion
  )
}

function valid(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<Manifest>
  return (
    item.schema === 1 &&
    typeof item.generation === "string" &&
    typeof item.promotedAt === "string" &&
    validProfile(item.profile)
  )
}

function validProfile(value: unknown): value is EmbeddingRuntimeProfile {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<EmbeddingRuntimeProfile>
  return (
    item.provider === "openai-compatible" &&
    typeof item.modelId === "string" &&
    (item.dimensionMode === "auto" || item.dimensionMode === "fixed") &&
    Number.isInteger(item.dimension) &&
    item.dimension! > 0 &&
    typeof item.endpointDigest === "string" &&
    Array.isArray(item.fingerprint) &&
    item.fingerprint.length > 0 &&
    item.fingerprint.every(
      (vector) => Array.isArray(vector) && vector.length === item.dimension && vector.every(Number.isFinite),
    ) &&
    typeof item.fingerprintDigest === "string" &&
    typeof item.qualityVersion === "string"
  )
}

function generationRoot(workspace: string, base: string): string {
  const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 24)
  return path.join(base, "safe-generations", hash)
}

async function readManifest(workspace: string, base: string): Promise<Manifest | undefined> {
  const pointer = path.join(generationRoot(workspace, base), "active.json")
  const raw = await readFile(pointer, "utf8").catch(() => undefined)
  if (!raw) return
  return Promise.resolve()
    .then(() => JSON.parse(raw) as unknown)
    .then((value) => (valid(value) ? value : undefined))
    .catch(() => undefined)
}
