import { describe, expect, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { CacheManager } from "../../../src/indexing/cache-manager"
import type { RagCheckpointMeta } from "../../../src/indexing/rag-checkpoint"

function meta(input: Partial<RagCheckpointMeta> = {}): RagCheckpointMeta {
  return {
    root: "/workspace",
    schemaVersion: 1,
    parserVersion: 1,
    chunkerVersion: 1,
    embedderProvider: "openai",
    embedderModel: "text-embedding-3-small",
    embeddingDimension: 1536,
    vectorStoreProvider: "lancedb",
    collectionName: "collection",
    ignoreFingerprint: "ignore-a",
    ...input,
  }
}

describe("CacheManager checkpoint metadata", () => {
  test("does not reuse file hashes when embedding dimension changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cache-root-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "cache-dir-"))
    const file = join(root, "main.ts")

    const first = new CacheManager(cacheDir, root)
    await first.initialize()
    first.setCheckpointMeta(meta())
    first.updateHash(file, "hash-a")
    await first.flush()

    const same = new CacheManager(cacheDir, root)
    await same.initialize()
    same.setCheckpointMeta(meta())
    expect(same.getHash(file)).toBe("hash-a")

    const changed = new CacheManager(cacheDir, root)
    await changed.initialize()
    changed.setCheckpointMeta(meta({ embeddingDimension: 3072 }))
    expect(changed.getHash(file)).toBeUndefined()
  })
})
