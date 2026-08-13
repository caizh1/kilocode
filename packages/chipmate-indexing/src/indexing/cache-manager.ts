import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import type { ICacheManager } from "./interfaces/cache"
import { Log } from "../util/log"
import type { RagCheckpointMeta } from "./rag-checkpoint"
import {
  checkpointCacheCompatible,
  checkpointMetaChangedFields,
  checkpointMetaHash,
  checkpointMetaMatches,
} from "./rag-checkpoint"

const log = Log.create({ service: "indexing-cache" })

/**
 * Manages the file-hash cache for code indexing.
 *
 * RATIONALE: Replaced vscode.ExtensionContext storage and vscode.workspace.fs
 * with plain filesystem access so the cache manager works outside VS Code.
 */
export class CacheManager implements ICacheManager {
  private readonly cachePath: string
  private readonly journalPath: string
  private fileHashes: Record<string, string> = {}
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private meta: RagCheckpointMeta | undefined
  private saveTask: Promise<void> = Promise.resolve()
  private pending = new Map<string, string | null>()
  private metaDirty = false
  private checkpointAt = 0

  constructor(
    private readonly cacheDirectory: string,
    private readonly workspacePath: string,
  ) {
    const hash = createHash("sha256").update(workspacePath).digest("hex")
    this.cachePath = path.join(cacheDirectory, `roo-index-cache-${hash}.json`)
    this.journalPath = `${this.cachePath}.journal`
  }

  async initialize(): Promise<void> {
    try {
      const raw = await fs.readFile(this.cachePath, "utf-8")
      const parsed = JSON.parse(raw) as unknown
      if (isCacheFile(parsed)) {
        this.fileHashes = parsed.hashes
        this.meta = parsed.meta
      } else if (isHashMap(parsed)) {
        this.fileHashes = parsed
        this.meta = undefined
      } else {
        this.fileHashes = {}
      }
    } catch {
      this.fileHashes = {}
    }
    await this.replay()
    this.checkpointAt = Date.now()
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      void this.checkpoint(true)
    }, 1500)
  }

  private performSave(): Promise<void> {
    const json = JSON.stringify({ meta: this.meta, hashes: this.fileHashes })
    const save = async () => {
      try {
        await fs.mkdir(path.dirname(this.cachePath), { recursive: true })
        const tmp = `${this.cachePath}.${globalThis.crypto.randomUUID()}.tmp`
        await fs.writeFile(tmp, json, "utf-8")
        await fs.rename(tmp, this.cachePath)
        await fs.rm(this.journalPath, { force: true })
      } catch (err) {
        log.error("failed to save cache", { err })
      }
    }
    const task = this.saveTask.then(save, save)
    this.saveTask = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  async clearCacheFile(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    this.fileHashes = {}
    this.pending.clear()
    this.metaDirty = false
    await this.performSave()
  }

  setCheckpointMeta(meta: RagCheckpointMeta): void {
    if (checkpointMetaMatches(this.meta, meta)) {
      this.meta = meta
      return
    }

    const previous = this.meta
    const changedFields = checkpointMetaChangedFields(previous, meta)
    if (checkpointCacheCompatible(previous, meta)) {
      log.info("indexing cache metadata changed", {
        action: "preserve-file-hashes",
        changedFields,
        previousMetaDigest: previous ? checkpointMetaHash(previous) : undefined,
        nextMetaDigest: checkpointMetaHash(meta),
      })
      this.meta = meta
      this.metaDirty = true
      this.scheduleSave()
      return
    }

    log.info("indexing cache metadata changed", {
      action: "clear-file-hashes",
      changedFields,
      previousMetaDigest: previous ? checkpointMetaHash(previous) : undefined,
      nextMetaDigest: checkpointMetaHash(meta),
    })
    this.meta = meta
    this.fileHashes = {}
    this.pending.clear()
    this.metaDirty = true
    this.scheduleSave()
  }

  async checkpoint(force = false): Promise<void> {
    const now = Date.now()
    if (!this.metaDirty && this.pending.size === 0) return this.saveTask
    if (!force && this.pending.size < 64 && now - this.checkpointAt < 2_000) return this.saveTask
    const value = JSON.stringify({ meta: this.meta, updates: [...this.pending] }) + "\n"
    this.pending.clear()
    this.metaDirty = false
    this.checkpointAt = now
    const append = async () => {
      try {
        await fs.mkdir(path.dirname(this.journalPath), { recursive: true })
        await fs.appendFile(this.journalPath, value, "utf-8")
      } catch (err) {
        log.error("failed to checkpoint indexing cache", { err })
      }
    }
    const task = this.saveTask.then(append, append)
    this.saveTask = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    await this.checkpoint(true)
    await this.performSave()
  }

  seedHashes(hashes: Readonly<Record<string, string>>): void {
    this.fileHashes = { ...hashes }
    this.pending = new Map(Object.entries(this.fileHashes))
    this.scheduleSave()
  }

  getHash(filePath: string): string | undefined {
    return this.fileHashes[filePath]
  }

  updateHash(filePath: string, hash: string): void {
    this.fileHashes[filePath] = hash
    this.pending.set(filePath, hash)
    this.scheduleSave()
  }

  deleteHash(filePath: string): void {
    delete this.fileHashes[filePath]
    this.pending.set(filePath, null)
    this.scheduleSave()
  }

  getAllHashes(): Record<string, string> {
    return { ...this.fileHashes }
  }

  private async replay(): Promise<void> {
    const raw = await fs.readFile(this.journalPath, "utf-8").catch(() => "")
    for (const line of raw.split("\n")) {
      if (!line) continue
      try {
        const value = JSON.parse(line) as unknown
        if (!isJournal(value)) continue
        this.meta = value.meta
        for (const [file, hash] of value.updates) {
          if (hash === null) delete this.fileHashes[file]
          else this.fileHashes[file] = hash
        }
      } catch (err) {
        log.warn("ignored incomplete indexing cache checkpoint", { err })
      }
    }
  }

  signature(): string {
    const entries = Object.entries(this.fileHashes).sort(([left], [right]) => left.localeCompare(right))
    return createHash("sha256").update(JSON.stringify(entries)).digest("hex")
  }

  async stamp(): Promise<string | undefined> {
    return fs
      .stat(this.cachePath)
      .then((value) => `${value.mtimeMs}:${value.ctimeMs}:${value.size}`)
      .catch(() => undefined)
  }
}

function isHashMap(input: unknown): input is Record<string, string> {
  if (!input || typeof input !== "object") return false
  return Object.values(input).every((value) => typeof value === "string")
}

function isCacheFile(input: unknown): input is { meta?: RagCheckpointMeta; hashes: Record<string, string> } {
  if (!input || typeof input !== "object") return false
  if (!("hashes" in input)) return false
  const hashes = (input as { hashes?: unknown }).hashes
  return isHashMap(hashes)
}

function isJournal(input: unknown): input is { meta?: RagCheckpointMeta; updates: Array<[string, string | null]> } {
  if (!input || typeof input !== "object" || !("updates" in input)) return false
  const updates = (input as { updates?: unknown }).updates
  return (
    Array.isArray(updates) &&
    updates.every(
      (item) =>
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === "string" &&
        (typeof item[1] === "string" || item[1] === null),
    )
  )
}
