import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"

type CacheFile = {
  meta: string
  hashes: Record<string, string>
}

export class DocumentIndexCache {
  private hashes: Record<string, string> = {}
  private meta = ""
  private readonly file: string

  constructor(
    cacheDirectory: string,
    private readonly workspace: string,
  ) {
    const hash = createHash("sha256").update(workspace).digest("hex")
    this.file = path.join(cacheDirectory, `document-index-cache-${hash}.json`)
  }

  async initialize(meta: string): Promise<void> {
    this.meta = meta
    try {
      const raw = await fs.readFile(this.file, "utf8")
      const data = JSON.parse(raw) as unknown
      if (!valid(data) || data.meta !== meta) {
        this.hashes = {}
        return
      }
      this.hashes = data.hashes
    } catch {
      this.hashes = {}
    }
  }

  get(filePath: string): string | undefined {
    return this.hashes[this.relative(filePath)]
  }

  set(filePath: string, hash: string): void {
    this.hashes[this.relative(filePath)] = hash
  }

  delete(filePath: string): void {
    delete this.hashes[this.relative(filePath)]
  }

  all(): Record<string, string> {
    return { ...this.hashes }
  }

  async clear(): Promise<void> {
    this.hashes = {}
    await this.flush()
  }

  async flush(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ meta: this.meta, hashes: this.hashes }), "utf8")
    await fs.rename(tmp, this.file)
  }

  private relative(filePath: string): string {
    if (filePath === "@external" || filePath.startsWith("@external/") || filePath.startsWith("@external\\")) {
      return filePath.replaceAll("\\", "/")
    }
    return path.normalize(path.isAbsolute(filePath) ? path.relative(this.workspace, filePath) : filePath)
  }
}

function valid(input: unknown): input is CacheFile {
  if (!input || typeof input !== "object") return false
  const data = input as CacheFile
  if (typeof data.meta !== "string") return false
  if (!data.hashes || typeof data.hashes !== "object") return false
  return Object.values(data.hashes).every((item) => typeof item === "string")
}
