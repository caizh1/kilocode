import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import type { ICacheManager } from "./interfaces/cache"
import { Log } from "../util/log"
import type { RagCheckpointMeta } from "./rag-checkpoint"
import { checkpointMetaMatches } from "./rag-checkpoint"

const log = Log.create({ service: "indexing-cache" })

/**
 * Manages the file-hash cache for code indexing.
 *
 * RATIONALE: Replaced vscode.ExtensionContext storage and vscode.workspace.fs
 * with plain filesystem access so the cache manager works outside VS Code.
 */
export class CacheManager implements ICacheManager {
  private readonly cachePath: string
  private fileHashes: Record<string, string> = {}
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private meta: RagCheckpointMeta | undefined

  constructor(
    private readonly cacheDirectory: string,
    private readonly workspacePath: string,
  ) {
    const hash = createHash("sha256").update(workspacePath).digest("hex")
    this.cachePath = path.join(cacheDirectory, `roo-index-cache-${hash}.json`)
  }

  async initialize(): Promise<void> {
    try {
      const raw = await fs.readFile(this.cachePath, "utf-8")
      const parsed = JSON.parse(raw) as unknown
      if (isCacheFile(parsed)) {
        this.fileHashes = parsed.hashes
        this.meta = parsed.meta
        return
      }
      if (isHashMap(parsed)) {
        this.fileHashes = parsed
        this.meta = undefined
        return
      }
      this.fileHashes = {}
    } catch {
      this.fileHashes = {}
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.performSave(), 1500)
  }

  private async performSave(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true })
      const tmp = `${this.cachePath}.tmp`
      await fs.writeFile(tmp, JSON.stringify({ meta: this.meta, hashes: this.fileHashes }), "utf-8")
      await fs.rename(tmp, this.cachePath)
    } catch (err) {
      log.error("failed to save cache", { err })
    }
  }

  async clearCacheFile(): Promise<void> {
    try {
      this.fileHashes = {}
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true })
      await fs.writeFile(this.cachePath, JSON.stringify({ meta: this.meta, hashes: {} }), "utf-8")
    } catch (err) {
      log.error("failed to clear cache file", { err })
    }
  }

  setCheckpointMeta(meta: RagCheckpointMeta): void {
    if (checkpointMetaMatches(this.meta, meta)) {
      this.meta = meta
      return
    }
    this.meta = meta
    this.fileHashes = {}
    this.scheduleSave()
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    await this.performSave()
  }

  getHash(filePath: string): string | undefined {
    return this.fileHashes[filePath]
  }

  updateHash(filePath: string, hash: string): void {
    this.fileHashes[filePath] = hash
    this.scheduleSave()
  }

  deleteHash(filePath: string): void {
    delete this.fileHashes[filePath]
    this.scheduleSave()
  }

  getAllHashes(): Record<string, string> {
    return { ...this.fileHashes }
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
