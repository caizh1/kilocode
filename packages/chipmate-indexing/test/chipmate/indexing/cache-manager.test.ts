import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir } from "fs/promises"
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

  test("serializes overlapping flushes without stale temp-file races", async () => {
    const root = await mkdtemp(join(tmpdir(), "cache-root-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "cache-dir-"))
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.setCheckpointMeta(meta())
    cache.updateHash(join(root, "first.c"), "first")
    const first = cache.flush()
    cache.updateHash(join(root, "second.c"), "second")
    const second = cache.flush()
    await Promise.all([first, second])

    const loaded = new CacheManager(cacheDir, root)
    await loaded.initialize()
    expect(loaded.getHash(join(root, "first.c"))).toBe("first")
    expect(loaded.getHash(join(root, "second.c"))).toBe("second")
    expect((await readdir(cacheDir)).some((file) => file.endsWith(".tmp"))).toBe(false)
  })

  test("replays bounded journal checkpoints before cache compaction", async () => {
    const root = await mkdtemp(join(tmpdir(), "cache-root-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "cache-dir-"))
    const file = join(root, "checkpoint.c")
    const first = new CacheManager(cacheDir, root)
    await first.initialize()
    first.setCheckpointMeta(meta())
    first.updateHash(file, "checkpoint")
    await first.checkpoint(true)

    const loaded = new CacheManager(cacheDir, root)
    await loaded.initialize()
    expect(loaded.getHash(file)).toBe("checkpoint")
    loaded.setCheckpointMeta(meta())
    expect(loaded.getHash(file)).toBe("checkpoint")
  })

  test("flushes a stable signature used to detect baseline changes", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "index-cache-"))
    const root = join(cacheDir, "workspace")
    const first = new CacheManager(cacheDir, root)
    await first.initialize()
    first.seedHashes({ [join(root, "a.ts")]: "a" })
    await first.flush()

    const second = new CacheManager(cacheDir, root)
    await second.initialize()
    expect(second.signature()).toBe(first.signature())

    second.updateHash(join(root, "a.ts"), "changed")
    expect(second.signature()).not.toBe(first.signature())
  })
})
