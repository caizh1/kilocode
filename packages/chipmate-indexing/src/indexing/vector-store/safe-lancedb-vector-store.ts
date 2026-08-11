import { randomBytes } from "crypto"
import { existsSync } from "fs"
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises"
import path from "path"
import pLimit from "p-limit"
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
import {
  compactSafeGenerationRoot,
  lanceDbPathFitsWindowsBudget,
  legacySafeGenerationRoot,
  previousCompactSafeGenerationRoot,
  resolveLanceDbPath,
} from "./lancedb-paths"

const log = Log.create({ service: "safe-lancedb-store" })
const READBACK_CONCURRENCY = 1
const READBACK_SAMPLE_LIMIT = 4
const READBACK_TIMEOUT_MS = 60_000

type Manifest = {
  schema: 1
  generation: string
  promotedAt: string
  profile: EmbeddingRuntimeProfile
}

type CandidateManifest = {
  schema: 1
  generation: string
  createdAt: string
  profile: EmbeddingRuntimeProfile
  samples?: PointStruct[]
}

export async function loadActiveEmbeddingProfile(
  workspace: string,
  base: string,
  legacyBases: readonly string[] = [],
): Promise<EmbeddingRuntimeProfile | undefined> {
  const roots = [
    compactSafeGenerationRoot(workspace, base),
    previousCompactSafeGenerationRoot(workspace, base),
    legacySafeGenerationRoot(workspace, base),
    ...legacyBases.flatMap((legacy) => [
      compactSafeGenerationRoot(workspace, legacy),
      previousCompactSafeGenerationRoot(workspace, legacy),
      legacySafeGenerationRoot(workspace, legacy),
    ]),
  ].filter((value, index, values) => values.indexOf(value) === index)
  for (const root of roots) {
    const manifest = await readManifestAt(root)
    if (manifest) return manifest.profile
  }
  return undefined
}

export class SafeLanceDBVectorStore implements IVectorStore {
  private readonly root: string
  private readonly legacyRoots: string[]
  private readonly pointer: string
  private readonly candidatePointer: string
  private active?: IVectorStore
  private activeGeneration?: string
  private writer?: IVectorStore
  private generation?: string
  private candidate = false
  private promoted = false
  private candidateCreatedAt?: string
  private readonly samples = new Map<string, PointStruct>()
  private decision?: VectorStoreCompatibilityDecision
  private readonly legacyCleanupRoots = new Set<string>()

  constructor(
    private readonly workspace: string,
    private readonly base: string,
    private readonly profile: EmbeddingRuntimeProfile,
    private readonly runtime: EmbeddingRuntimeStore,
    private readonly make?: (generation: string) => IVectorStore,
    legacyBases: readonly string[] = [],
  ) {
    this.root = compactSafeGenerationRoot(workspace, base)
    this.legacyRoots = [
      legacySafeGenerationRoot(workspace, base),
      previousCompactSafeGenerationRoot(workspace, base),
      ...legacyBases.flatMap((legacy) => [
        compactSafeGenerationRoot(workspace, legacy),
        previousCompactSafeGenerationRoot(workspace, legacy),
        legacySafeGenerationRoot(workspace, legacy),
      ]),
    ].filter((value, index, values) => value !== this.root && values.indexOf(value) === index)
    this.pointer = path.join(this.root, "active.json")
    this.candidatePointer = path.join(this.root, "candidate.json")
  }

  async openExisting(): Promise<void> {
    const located = await this.locateManifest()
    if (!located || !sameSpace(located.manifest.profile, this.profile)) {
      throw new Error("Active LanceDB generation does not match the validated embedding space.")
    }
    const manifest = located.manifest
    const store = this.store(
      manifest.generation,
      manifest.profile,
      located.root,
      !generationPathFitsBudget(this.workspace, located.root, manifest.generation),
    )
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
    const located = await this.locateManifest()
    const manifest = located?.manifest
    const manifestRoot = located?.root ?? this.root
    if (manifest && sameSpace(manifest.profile, this.profile)) {
      const writable = generationPathFitsBudget(this.workspace, manifestRoot, manifest.generation)
      if (!writable) {
        log.warn("legacy active LanceDB generation exceeds the Windows write-path budget", {
          workspace: this.workspace,
          generation: manifest.generation,
          root: manifestRoot,
        })
      }
      {
        const store = this.store(manifest.generation, manifest.profile, manifestRoot, !writable)
        if (!store.openExisting) throw new Error("The active vector generation cannot be opened read-only.")
        try {
          await store.openExisting()
          this.active = store
          this.activeGeneration = manifest.generation
        } catch (error) {
          if (writable && isCurrentGenerationId(manifest.generation)) throw error
          await store.close?.().catch((closeError) => {
            log.warn("failed to close unreadable legacy active LanceDB generation", {
              workspace: this.workspace,
              generation: manifest.generation,
              error: closeError,
            })
          })
          log.warn("legacy active LanceDB generation could not be opened; rebuilding on a compact path", {
            workspace: this.workspace,
            generation: manifest.generation,
            error,
          })
        }
      }
    }

    let candidate = await this.candidateManifest()
    if (candidate && candidate.generation !== manifest?.generation && !isCurrentGenerationId(candidate.generation)) {
      await rm(this.candidatePointer, { force: true })
      await rm(path.join(this.root, candidate.generation), { recursive: true, force: true })
      log.warn("discarded legacy incomplete LanceDB candidate before compact-path rebuild", {
        workspace: this.workspace,
        generation: candidate.generation,
      })
      candidate = undefined
    }
    if (candidate && candidate.generation !== manifest?.generation && compatible(candidate.profile, this.profile)) {
      if (this.legacyRoots.includes(manifestRoot)) this.legacyCleanupRoots.add(manifestRoot)
      const store = this.store(candidate.generation)
      const created = await store.initialize()
      this.writer = store
      this.generation = candidate.generation
      this.candidate = true
      this.promoted = false
      this.candidateCreatedAt = candidate.createdAt
      for (const sample of candidate.samples ?? []) {
        this.samples.set(String(sample.payload.filePath), sample)
      }
      this.decision = {
        action: "rebuild",
        reason: created ? "incomplete candidate required rebuild" : "resumed incomplete candidate",
        created,
      }
      log.info("resumed incomplete LanceDB candidate", {
        workspace: this.workspace,
        generation: candidate.generation,
        created,
      })
      return created
    }

    if (
      manifest &&
      compatible(manifest.profile, this.profile) &&
      (!this.active || !generationPathFitsBudget(this.workspace, manifestRoot, manifest.generation))
    ) {
      log.warn("rebuilding legacy active LanceDB generation on a compact path", {
        workspace: this.workspace,
        generation: manifest.generation,
      })
      if (this.legacyRoots.includes(manifestRoot)) this.legacyCleanupRoots.add(manifestRoot)
      return this.createCandidate("legacy active generation requires compact-path migration")
    }

    if (manifest && compatible(manifest.profile, this.profile) && this.active) {
      this.writer = this.active
      this.generation = manifest.generation
      this.promoted = true
      this.decision = { action: "reuse", reason: "validated active generation", created: false }
      return false
    }

    for (const root of this.legacyRoots) {
      if (existsSync(root)) this.legacyCleanupRoots.add(root)
    }
    if (this.legacyRoots.includes(manifestRoot) && manifest) this.legacyCleanupRoots.add(manifestRoot)
    return this.createCandidate(manifest ? "embedding runtime profile changed" : "missing active generation")
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
        collapse: false,
      },
    )
    for (const point of points) {
      const file = String(point.payload.filePath ?? "")
      if (file) this.samples.set(file, point)
      if (this.samples.size > READBACK_SAMPLE_LIMIT) this.samples.delete(this.samples.keys().next().value!)
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

  async finalizeFileGenerations(
    files: readonly { filePath: string; generation: string; runId: string }[],
  ): Promise<void> {
    const target = this.target() as IVectorStore & {
      finalizeFileGenerations?: (
        input: readonly { filePath: string; generation: string; runId: string }[],
      ) => Promise<void>
    }
    if (target.finalizeFileGenerations) {
      await target.finalizeFileGenerations(files)
      await this.persistCandidate()
      return
    }
    for (const file of files) {
      await target.activateFileGeneration?.(file.filePath, file.generation, file.runId)
      await target.deleteInactiveFilePoints?.(file.filePath, file.generation)
    }
    await this.persistCandidate()
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

    this.samples.clear()
    await this.createCandidate("isolated candidate reset")
  }

  async deleteCollection(): Promise<void> {
    await this.closeStores()
    await rm(this.root, { recursive: true, force: true })
    await Promise.all(this.legacyRoots.map((root) => rm(root, { recursive: true, force: true })))
    this.active = undefined
    this.activeGeneration = undefined
    this.writer = undefined
    this.generation = undefined
    this.candidate = false
    this.promoted = false
    this.candidateCreatedAt = undefined
  }

  async collectionExists(): Promise<boolean> {
    if (this.writer) return this.writer.collectionExists()
    const located = await this.locateManifest()
    return Boolean(located && compatible(located.manifest.profile, this.profile))
  }

  async hasIndexedData(): Promise<boolean> {
    if (this.candidate && !this.promoted) return false
    const store = this.active ?? this.writer
    return store ? store.hasIndexedData() : false
  }

  async markIndexingComplete(options?: { allowEmpty?: boolean }): Promise<void> {
    const store = this.target()
    if (!this.candidate) {
      await store.markIndexingComplete(options)
      return
    }
    if (this.samples.size === 0 && !options?.allowEmpty) {
      throw new Error("Candidate embedding index contains no validated source vectors.")
    }
    const started = Date.now()
    const samples = [...this.samples.values()]
    log.info("starting candidate embedding index readback", {
      workspace: this.workspace,
      samples: samples.length,
      concurrency: READBACK_CONCURRENCY,
      timeoutMs: READBACK_TIMEOUT_MS,
    })
    const limit = pLimit(READBACK_CONCURRENCY)
    const checks = await deadline(
      Promise.all(
        samples.map((sample) =>
          limit(async () => {
            const found = await store.search(sample.vector, sample.payload.filePath, 0, 5)
            return found.some((item) => item.id === sample.id)
          }),
        ),
      ),
      READBACK_TIMEOUT_MS,
      "Candidate embedding index readback timed out.",
    )
    if (!checks.every(Boolean)) {
      throw new Error("Candidate embedding index failed its source-backed readback check.")
    }
    log.info("candidate embedding index readback complete", {
      workspace: this.workspace,
      samples: samples.length,
      elapsedMs: Date.now() - started,
    })
    await store.markIndexingComplete(options)
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
    await rm(this.candidatePointer, { force: true })
    const previous = this.active
    this.active = store
    this.activeGeneration = generation
    this.writer = store
    this.candidate = false
    this.promoted = true
    this.candidateCreatedAt = undefined
    await previous?.close?.()
    await this.cleanupLegacyLayout()
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
    await rm(this.candidatePointer, { force: true })
    await rm(path.join(this.root, generation), { recursive: true, force: true })
    this.writer = this.active
    this.generation = this.activeGeneration
    this.candidate = false
    this.promoted = Boolean(this.active)
    this.candidateCreatedAt = undefined
    this.samples.clear()
  }

  async close(): Promise<void> {
    // A normal worker shutdown is a resumable lifecycle boundary, not a failed
    // indexing transaction. Close every native writer before another worker
    // can resume the candidate, but preserve its manifest and generation.
    await this.closeStores()
  }

  private target(): IVectorStore {
    if (!this.writer) throw new Error("LanceDB generation is not initialized.")
    return this.writer
  }

  private store(
    generation: string,
    profile = this.profile,
    root = this.root,
    allowUnsafeExistingReadOnly = false,
  ): IVectorStore {
    if (this.make) return this.make(generation)
    const base = path.join(root, generation)
    const databaseName = generationDatabaseName(this.workspace, base)
    return new LanceDBVectorStore(
      this.workspace,
      profile.dimension,
      base,
      {
        provider: profile.provider,
        modelId: profile.modelId,
        dimension: profile.dimension,
        dimensionMode: profile.dimensionMode,
        requestedDimension: profile.requestedDimension,
        endpointDigest: profile.endpointDigest,
        fingerprintDigest: profile.fingerprintDigest,
        qualityVersion: profile.qualityVersion,
        instructionVersion: profile.instructionVersion,
      },
      databaseName,
      [],
      allowUnsafeExistingReadOnly,
    )
  }

  private async locateManifest(): Promise<{ manifest: Manifest; root: string } | undefined> {
    const current = await readManifestAt(this.root)
    if (current) return { manifest: current, root: this.root }
    for (const root of this.legacyRoots) {
      const legacy = await readManifestAt(root)
      if (legacy) return { manifest: legacy, root }
    }
    return undefined
  }

  private async candidateManifest(): Promise<CandidateManifest | undefined> {
    const raw = await readFile(this.candidatePointer, "utf8").catch(() => undefined)
    if (!raw) return undefined
    return Promise.resolve()
      .then(() => JSON.parse(raw) as unknown)
      .then((value) => (validCandidate(value) ? value : undefined))
      .catch(() => undefined)
  }

  private async saveCandidate(generation: string): Promise<void> {
    const manifest: CandidateManifest = {
      schema: 1,
      generation,
      createdAt: this.candidateCreatedAt ?? new Date().toISOString(),
      profile: this.profile,
      samples: [...this.samples.values()],
    }
    await mkdir(this.root, { recursive: true })
    const temp = `${this.candidatePointer}.${globalThis.crypto.randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(manifest), "utf8")
    await rename(temp, this.candidatePointer)
  }

  private async createCandidate(reason: string): Promise<true> {
    const generation = createGenerationId()
    const store = this.store(generation)
    await store.initialize()
    this.candidateCreatedAt = new Date().toISOString()
    await this.saveCandidate(generation)
    this.writer = store
    this.generation = generation
    this.candidate = true
    this.promoted = false
    this.decision = { action: "rebuild", reason, created: true }
    return true
  }

  private async persistCandidate(): Promise<void> {
    if (!this.candidate || this.promoted || !this.generation) return
    await this.saveCandidate(this.generation)
  }

  private async closeStores(): Promise<void> {
    const stores = [...new Set([this.active, this.writer].filter((store): store is IVectorStore => !!store))]
    await Promise.all(stores.map((store) => store.close?.()))
  }

  private async cleanupLegacyLayout(): Promise<void> {
    for (const legacy of this.legacyCleanupRoots) {
      if (legacy === this.root) continue
      try {
        await rm(legacy, { recursive: true, force: true })
        this.legacyCleanupRoots.delete(legacy)
        log.info("removed legacy Safe LanceDB layout after compact generation promotion", {
          workspace: this.workspace,
          legacyRoot: legacy,
          root: this.root,
        })
      } catch (error) {
        log.warn("failed to remove legacy Safe LanceDB layout after compact generation promotion", {
          workspace: this.workspace,
          legacyRoot: legacy,
          error,
        })
      }
    }
  }

  private async cleanup(active: string): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => [])
    const dirs = entries.filter((entry) => entry.isDirectory() && entry.name !== active)
    const dated = await Promise.all(
      dirs.map(async (entry) => ({
        name: entry.name,
        time: await stat(path.join(this.root, entry.name))
          .then((item) => item.mtimeMs)
          .catch(() => 0),
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

function validCandidate(value: unknown): value is CandidateManifest {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<CandidateManifest>
  return (
    item.schema === 1 &&
    typeof item.generation === "string" &&
    typeof item.createdAt === "string" &&
    validProfile(item.profile) &&
    (item.samples === undefined ||
      (Array.isArray(item.samples) &&
        item.samples.length <= READBACK_SAMPLE_LIMIT &&
        item.samples.every((sample) => validSample(sample, item.profile!.dimension))))
  )
}

function validSample(value: unknown, dimension: number): value is PointStruct {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<PointStruct>
  if (typeof item.id !== "string" || !Array.isArray(item.vector) || item.vector.length !== dimension) return false
  if (!item.vector.every(Number.isFinite) || !item.payload || typeof item.payload !== "object") return false
  return typeof item.payload.filePath === "string" && item.payload.filePath.length > 0
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

function createGenerationId(): string {
  return randomBytes(6).toString("base64url")
}

function isCurrentGenerationId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8}$/.test(value)
}

function generationPathFitsBudget(workspace: string, root: string, generation: string): boolean {
  const base = path.join(root, generation)
  const databaseName = generationDatabaseName(workspace, base)
  const resolved = resolveLanceDbPath(workspace, base, databaseName)
  const database =
    existsSync(resolved.database) || !resolved.legacy || !existsSync(resolved.legacy)
      ? resolved.database
      : resolved.legacy
  return lanceDbPathFitsWindowsBudget(database)
}

function generationDatabaseName(workspace: string, base: string): string {
  const previous = resolveLanceDbPath(workspace, base, "v")
  return existsSync(previous.database) || Boolean(previous.legacy && existsSync(previous.legacy)) ? "v" : ""
}

async function readManifestAt(root: string): Promise<Manifest | undefined> {
  const pointer = path.join(root, "active.json")
  const raw = await readFile(pointer, "utf8").catch(() => undefined)
  if (!raw) return
  return Promise.resolve()
    .then(() => JSON.parse(raw) as unknown)
    .then((value) => (valid(value) ? value : undefined))
    .catch(() => undefined)
}

async function deadline<T>(task: Promise<T>, timeout: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
