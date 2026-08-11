import { createHash } from "crypto"
import { mkdir, readFile, rename, writeFile } from "fs/promises"
import path from "path"
import type { EmbeddingRuntimeProfile } from "./interfaces/embedder"

export class EmbeddingRuntimeStore {
  private readonly file: string

  constructor(cache: string, workspace: string) {
    const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 24)
    this.file = path.join(cache, "embedding-runtime", `${hash}.json`)
  }

  async load(): Promise<EmbeddingRuntimeProfile | undefined> {
    const raw = await readFile(this.file, "utf8").catch(() => undefined)
    if (!raw) return
    return Promise.resolve()
      .then(() => JSON.parse(raw) as unknown)
      .then((value) => (valid(value) ? value : undefined))
      .catch(() => undefined)
  }

  async save(profile: EmbeddingRuntimeProfile): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${globalThis.crypto.randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(profile), "utf8")
    await rename(temp, this.file)
  }
}

function valid(value: unknown): value is EmbeddingRuntimeProfile {
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
