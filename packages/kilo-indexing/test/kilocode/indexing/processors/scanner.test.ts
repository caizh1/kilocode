import { createHash } from "crypto"
import { mkdir, mkdtemp, rm } from "fs/promises"
import ignore from "ignore"
import { tmpdir } from "os"
import { join } from "path"
import { describe, expect, test } from "bun:test"
import { CacheManager } from "../../../../src/indexing/cache-manager"
import type {
  CodeBlock,
  ICodeParser,
  IEmbedder,
  IndexingTelemetryEvent,
  IVectorStore,
  PointStruct,
  ScanProgressEvent,
  VectorStoreSearchResult,
} from "../../../../src/indexing/interfaces"
import { loadIgnore } from "../../../../src/indexing/shared/load-ignore"
import { DirectoryScanner } from "../../../../src/indexing/processors/scanner"
import { CodeGraphJsonStorage, CodePostingsJsonStorage } from "../../../../src/indexing/codegraph/storage"

class Emb implements IEmbedder {
  public async createEmbeddings(texts: string[]): Promise<{ embeddings: number[][] }> {
    return {
      embeddings: texts.map(() => [0.1]),
    }
  }

  public async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    return { valid: true }
  }

  public get embedderInfo() {
    return { name: "openai" as const }
  }
}

class Parser implements ICodeParser {
  public async parseFile(
    filePath: string,
    options?: {
      minBlockLines?: number
      maxBlockLines?: number
      content?: string
      fileHash?: string
    },
  ): Promise<CodeBlock[]> {
    return [
      {
        file_path: filePath,
        identifier: null,
        type: "definition.function",
        start_line: 1,
        end_line: 1,
        content: "export const x = 1",
        fileHash: options?.fileHash ?? "",
        segmentHash: `${filePath}:1:1`,
      },
    ]
  }
}

class ManyParser implements ICodeParser {
  public async parseFile(
    filePath: string,
    options?: {
      minBlockLines?: number
      maxBlockLines?: number
      content?: string
      fileHash?: string
    },
  ): Promise<CodeBlock[]> {
    return [
      {
        file_path: filePath,
        identifier: null,
        type: "definition.function",
        start_line: 1,
        end_line: 1,
        content: "export const a = 1",
        fileHash: options?.fileHash ?? "",
        segmentHash: `${filePath}:1:1`,
      },
      {
        file_path: filePath,
        identifier: null,
        type: "definition.function",
        start_line: 2,
        end_line: 2,
        content: "export const b = 2",
        fileHash: options?.fileHash ?? "",
        segmentHash: `${filePath}:2:2`,
      },
      {
        file_path: filePath,
        identifier: null,
        type: "definition.function",
        start_line: 3,
        end_line: 3,
        content: "export const c = 3",
        fileHash: options?.fileHash ?? "",
        segmentHash: `${filePath}:3:3`,
      },
    ]
  }
}

class CountParser implements ICodeParser {
  constructor(private readonly count: number) {}

  public async parseFile(
    filePath: string,
    options?: {
      minBlockLines?: number
      maxBlockLines?: number
      content?: string
      fileHash?: string
    },
  ): Promise<CodeBlock[]> {
    return Array.from({ length: this.count }, (_, index) => ({
      file_path: filePath,
      identifier: null,
      type: "definition.function",
      start_line: index + 1,
      end_line: index + 1,
      content: `export const value${index} = ${index}`,
      fileHash: options?.fileHash ?? "",
      segmentHash: `${filePath}:${options?.fileHash ?? ""}:${index}`,
    }))
  }
}

class Store implements IVectorStore {
  public multi: string[][] = []
  public points = 0
  public records: PointStruct[] = []

  public async initialize(): Promise<boolean> {
    return false
  }

  public async upsertPoints(points: PointStruct[]): Promise<void> {
    this.points += points.length
    this.records.push(...points)
  }

  public async search(
    _queryVector: number[],
    _directoryPrefix?: string,
    _minScore?: number,
    _maxResults?: number,
  ): Promise<VectorStoreSearchResult[]> {
    return this.records
      .filter((point) => point.payload.active === true)
      .map((point) => ({
        id: point.id,
        score: 1,
        payload: point.payload,
      }))
  }

  public async deletePointsByFilePath(_filePath: string): Promise<void> {}

  public async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
    this.multi.push(filePaths)
  }

  public async activateFileGeneration(filePath: string, generation: string, runId: string): Promise<void> {
    const rel = filePath.split("/").pop()
    for (const point of this.records) {
      if (point.payload.filePath !== filePath && point.payload.filePath !== rel) continue
      point.payload.active = point.payload.generation === generation && point.payload.runId === runId
    }
  }

  public async deleteInactiveFilePoints(filePath: string, activeGeneration: string): Promise<void> {
    const rel = filePath.split("/").pop()
    this.records = this.records.filter(
      (point) =>
        (point.payload.filePath !== filePath && point.payload.filePath !== rel) ||
        point.payload.generation === activeGeneration ||
        point.payload.active === true,
    )
  }

  public getCollectionName(): string {
    return "test"
  }

  public async clearCollection(): Promise<void> {}

  public async deleteCollection(): Promise<void> {}

  public async collectionExists(): Promise<boolean> {
    return true
  }

  public async hasIndexedData(): Promise<boolean> {
    return false
  }

  public async markIndexingComplete(): Promise<void> {}

  public async markIndexingIncomplete(): Promise<void> {}
}

class BeginFailGraph extends CodeGraphJsonStorage {
  public override async beginFullScan(): Promise<void> {
    throw new Error("graph begin failed")
  }
}

class FinishFailGraph extends CodeGraphJsonStorage {
  public override async markFullScanComplete(): Promise<void> {
    throw new Error("graph commit rename failed")
  }
}

class FailStore extends Store {
  private calls = 0

  public override async upsertPoints(points: PointStruct[]): Promise<void> {
    this.calls++
    if (this.calls === 2) {
      throw new Error("upsert failed")
    }
    await super.upsertPoints(points)
  }
}

class RetryStore extends Store {
  private calls = 0

  public override async upsertPoints(points: PointStruct[]): Promise<void> {
    this.calls += 1
    if (this.calls === 1) {
      throw new Error("temporary upsert failure for /tmp/retry/path.ts")
    }
    await super.upsertPoints(points)
  }
}

class CleanupCrashStore extends Store {
  public failCleanup = false

  public override async deleteInactiveFilePoints(filePath: string, activeGeneration: string): Promise<void> {
    if (this.failCleanup) {
      this.failCleanup = false
      throw new Error("crash between new chunk upsert and stale cleanup")
    }
    await super.deleteInactiveFilePoints(filePath, activeGeneration)
  }
}

describe("DirectoryScanner", () => {
  test("uses seeded baseline hashes to index only worktree changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const same = join(root, "same.ts")
    const changed = join(root, "changed.ts")
    const added = join(root, "added.ts")
    const deleted = join(root, "deleted.ts")
    const sameContent = "export const same = 1\n"
    const changedContent = "export const changed = 2\n"

    await Bun.write(same, sameContent)
    await Bun.write(changed, changedContent)
    await Bun.write(added, "export const added = 1\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.seedHashes({
      [same]: createHash("sha256").update(sameContent).digest("hex"),
      [changed]: "baseline-changed",
      [deleted]: "baseline-deleted",
    })

    const store = new Store()
    const scan = new DirectoryScanner(new Emb(), store, new Parser(), cache, ignore(), 1, 1)
    const result = await scan.scanDirectory(root)

    expect(result.stats.processed).toBe(2)
    expect(store.points).toBe(2)
    expect(cache.getHash(same)).toBe(createHash("sha256").update(sameContent).digest("hex"))
    expect(cache.getHash(changed)).toBe(createHash("sha256").update(changedContent).digest("hex"))
    expect(cache.getHash(added)).toBeDefined()
    expect(cache.getHash(deleted)).toBeUndefined()
  })

  test("keeps file metadata when threshold flush is triggered by that file", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    const content = "export const value = 2\n"
    await Bun.write(file, content)

    const hash = createHash("sha256").update(content).digest("hex")
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.updateHash(file, "old-hash")

    const emb = new Emb()
    const parser = new Parser()
    const store = new Store()
    const scan = new DirectoryScanner(emb, store, parser, cache, ignore(), 1, 1)

    const result = await scan.scanDirectory(root)

    expect(result.stats.processed).toBe(1)
    expect(store.points).toBe(1)
    expect(store.multi).toEqual([])
    expect(cache.getHash(file)).toBe(hash)
  })

  test("does not mark hash current when a later batch fails for the same file", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    const content = "export const value = 2\n"
    await Bun.write(file, content)

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.updateHash(file, "old-hash")

    const emb = new Emb()
    const parser = new ManyParser()
    const store = new FailStore()
    const scan = new DirectoryScanner(emb, store, parser, cache, ignore(), 2, 1)

    await scan.scanDirectory(root)

    expect(cache.getHash(file)).toBe("old-hash")
  })

  test("cleans stale active chunks when a file shrinks after a cleanup crash", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    const oldContent = "export const oldValue = 1\n"
    const newContent = "export const newValue = 2\n"
    await Bun.write(file, oldContent)

    const oldHash = createHash("sha256").update(oldContent).digest("hex")
    const newHash = createHash("sha256").update(newContent).digest("hex")
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const store = new CleanupCrashStore()

    const first = new DirectoryScanner(new Emb(), store, new CountParser(10), cache, ignore(), 3, 1)
    await first.scanDirectory(root)
    expect(cache.getHash(file)).toBe(oldHash)
    expect((await store.search([0.1])).length).toBe(10)

    await Bun.write(file, newContent)
    store.failCleanup = true
    const crashed = new DirectoryScanner(new Emb(), store, new CountParser(6), cache, ignore(), 3, 1)
    await expect(crashed.scanDirectory(root)).rejects.toThrow("crash between new chunk upsert and stale cleanup")
    expect(cache.getHash(file)).toBe(oldHash)

    const resumed = new DirectoryScanner(new Emb(), store, new CountParser(6), cache, ignore(), 3, 1)
    await resumed.scanDirectory(root)

    const results = await store.search([0.1])
    expect(cache.getHash(file)).toBe(newHash)
    expect(results.length).toBe(6)
    expect(new Set(results.map((result) => result.payload?.fileHash))).toEqual(new Set([newHash]))
  })

  test("emits candidate counts for scan telemetry", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    await Bun.write(file, "export const value = 2\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const events: IndexingTelemetryEvent[] = []
    const scan = new DirectoryScanner(
      new Emb(),
      new Store(),
      new Parser(),
      cache,
      ignore(),
      1,
      1,
      (event) => events.push(event),
      {
        provider: "openai",
        vectorStore: "lancedb",
        modelId: "text-embedding-3-small",
      },
    )

    await scan.scanDirectory(root, undefined, undefined, undefined, "full")

    const count = events.find((event) => event.type === "file_count")
    expect(count).toBeDefined()
    expect(count?.type).toBe("file_count")
    expect(count?.mode).toBe("full")
    expect(count?.source).toBe("scan")
    expect(count?.candidate).toBe(1)
  })

  test("emits stable scan progress targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.c")
    await Bun.write(file, "int main(void) { return 0; }\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const events: ScanProgressEvent[] = []
    const scan = new DirectoryScanner(new Emb(), new Store(), new Parser(), cache, ignore(), 1, 1)

    await scan.scanDirectory(root, undefined, undefined, undefined, "full", (event) => events.push(event))

    expect(events.at(0)).toEqual({
      type: "target",
      totalFiles: 1,
      graphTotalFiles: 1,
    })
    expect(events.some((event) => event.type === "graph" && event.filePath === file)).toBe(true)
  })

  test("skips files matched by .kilocodeignore during full scans", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const blocked = join(root, "blocked.ts")
    const open = join(root, "open.ts")

    await Bun.write(join(root, ".kilocodeignore"), "blocked.ts\n")
    await Bun.write(blocked, "export const blocked = 1\n")
    await Bun.write(open, "export const open = 1\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const scan = new DirectoryScanner(new Emb(), new Store(), new Parser(), cache, await loadIgnore(root), 1, 1)
    const result = await scan.scanDirectory(root)

    expect(result.stats.processed).toBe(1)
    expect(cache.getHash(blocked)).toBeUndefined()
    expect(cache.getHash(open)).toBeDefined()
  })

  test("skips plugin state directories during full scans", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const open = join(root, "main.c")
    const nested = join(root, ".kilo", "worktrees", "feature", "copy.c")

    await mkdir(join(root, ".kilo", "worktrees", "feature"), { recursive: true })
    await Bun.write(open, "int main(void) { return 0; }\n")
    await Bun.write(nested, "int copied(void) { return 0; }\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const scan = new DirectoryScanner(new Emb(), new Store(), new Parser(), cache, ignore(), 1, 1)
    const result = await scan.scanDirectory(root)

    expect(result.stats.processed).toBe(1)
    expect(cache.getHash(open)).toBeDefined()
    expect(cache.getHash(nested)).toBeUndefined()
  })

  test("updates code graph without marking RAG cache current during graph-only scans", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.c")
    await Bun.write(file, "int main(void) { return 0; }\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const graph = new CodeGraphJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const postings = new CodePostingsJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const scan = new DirectoryScanner(
      undefined,
      undefined,
      new Parser(),
      cache,
      ignore(),
      1,
      1,
      undefined,
      undefined,
      graph,
      postings,
      { writeCache: false },
    )

    const result = await scan.scanDirectory(root)

    expect(result.stats.processed).toBe(1)
    expect(cache.getHash(file)).toBeUndefined()
    expect((await graph.getFileGraph(file))?.functions[0]?.name).toBe("main")
    expect((await postings.search("main"))[0]?.filePath).toBe("main.c")
  })

  test("propagates graph transaction begin and completion failures", async () => {
    for (const phase of ["begin", "finish"] as const) {
      const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
      const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
      const cache = new CacheManager(cacheDir, root)
      await cache.initialize()
      const graph =
        phase === "begin"
          ? new BeginFailGraph({ workspacePath: root, cacheDirectory: cacheDir })
          : new FinishFailGraph({ workspacePath: root, cacheDirectory: cacheDir })
      const scan = new DirectoryScanner(
        undefined,
        undefined,
        new Parser(),
        cache,
        ignore(),
        1,
        1,
        undefined,
        undefined,
        graph,
        undefined,
        { writeCache: false },
      )

      await expect(
        scan.scanDirectory(root, undefined, undefined, undefined, "full", undefined, "codeGraph"),
      ).rejects.toThrow(phase === "begin" ? "graph begin failed" : "graph commit rename failed")
      expect(graph.getScanState()).toBe(phase === "begin" ? "never" : "interrupted")
      scan.disposeGraphWorkers()
    }
  })

  test("commits an empty Code Graph and Postings scan once", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const graph = new CodeGraphJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const postings = new CodePostingsJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const scan = new DirectoryScanner(
      undefined,
      undefined,
      new Parser(),
      cache,
      ignore(),
      1,
      1,
      undefined,
      undefined,
      graph,
      postings,
      { writeCache: false },
    )

    const result = await scan.scanDirectory(root, undefined, undefined, undefined, "full", undefined, "codeGraph")

    expect(result.candidateFiles).toEqual([])
    expect(graph.getScanState()).toBe("complete")
    expect(postings.getScanState()).toBe("complete")
    expect(graph.status()).toMatchObject({ validFileCount: 0, recordCount: 0 })
    expect(postings.status()).toMatchObject({ validFileCount: 0, recordCount: 0 })
    scan.disposeGraphWorkers()
  })

  test("graph-only target skips embedding and keeps RAG cache stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.c")
    await Bun.write(file, "int main(void) { return 0; }\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const graph = new CodeGraphJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const postings = new CodePostingsJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const store = new Store()
    const scan = new DirectoryScanner(
      new Emb(),
      store,
      new Parser(),
      cache,
      ignore(),
      1,
      1,
      undefined,
      undefined,
      graph,
      postings,
      { writeCache: false },
    )

    const result = await scan.scanDirectory(root, undefined, undefined, undefined, "full", undefined, "codeGraph")

    expect(result.stats.processed).toBe(1)
    expect(store.points).toBe(0)
    expect(cache.getHash(file)).toBeUndefined()
    expect((await graph.getFileGraph(file))?.functions[0]?.name).toBe("main")
    expect((await postings.search("main"))[0]?.filePath).toBe("main.c")
  })

  test("graph-only target only scans files supported by Code Graph", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const cfile = join(root, "main.c")
    const tsfile = join(root, "app.ts")
    await Bun.write(cfile, "int main(void) { return 0; }\n")
    await Bun.write(tsfile, "export const app = 1\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const graph = new CodeGraphJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const postings = new CodePostingsJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const store = new Store()
    const scan = new DirectoryScanner(
      new Emb(),
      store,
      new Parser(),
      cache,
      ignore(),
      1,
      1,
      undefined,
      undefined,
      graph,
      postings,
      { writeCache: false },
    )

    const graphResult = await scan.scanDirectory(root, undefined, undefined, undefined, "full", undefined, "codeGraph")

    expect(graphResult.stats.processed).toBe(1)
    expect(await graph.getFileGraph(cfile)).toBeDefined()
    expect(await graph.getFileGraph(tsfile)).toBeUndefined()
    expect(cache.getHash(tsfile)).toBeUndefined()

    const ragResult = await scan.scanDirectory(root, undefined, undefined, undefined, "full", undefined, "rag")
    expect(ragResult.stats.processed).toBe(2)
    expect(store.points).toBe(2)
  })

  test("RAG-only target does not update code graph or postings", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.c")
    await Bun.write(file, "int main(void) { return 0; }\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const graph = new CodeGraphJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const postings = new CodePostingsJsonStorage({ workspacePath: root, cacheDirectory: cacheDir })
    const store = new Store()
    const scan = new DirectoryScanner(
      new Emb(),
      store,
      new Parser(),
      cache,
      ignore(),
      1,
      1,
      undefined,
      undefined,
      graph,
      postings,
    )

    const result = await scan.scanDirectory(root, undefined, undefined, undefined, "full", undefined, "rag")

    expect(result.stats.processed).toBe(1)
    expect(store.points).toBe(1)
    expect(cache.getHash(file)).toBeDefined()
    expect(await graph.getFileGraph(file)).toBeUndefined()
    expect(await postings.search("main")).toEqual([])
  })
  test("uses a configured extension allowlist and removes excluded cached files", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const custom = join(root, "main.custom")
    const excluded = join(root, "main.ts")
    await Bun.write(custom, "custom source content\n")
    await Bun.write(excluded, "export const excluded = 1\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    cache.updateHash(excluded, "old-hash")
    const scan = new DirectoryScanner(
      new Emb(),
      new Store(),
      new Parser(),
      cache,
      ignore(),
      1,
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      [".custom"],
    )

    const result = await scan.scanDirectory(root)

    expect(result.stats.processed).toBe(1)
    expect(cache.getHash(custom)).toBeDefined()
    expect(cache.getHash(excluded)).toBeUndefined()
  })

  test("skips binary files admitted by a custom extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "data.custom")
    await Bun.write(file, new Uint8Array([0, 1, 2, 3]))
    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()
    const scan = new DirectoryScanner(
      new Emb(),
      new Store(),
      new Parser(),
      cache,
      ignore(),
      1,
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      [".custom"],
    )

    const result = await scan.scanDirectory(root)

    expect(result.stats).toEqual({ processed: 0, skipped: 1 })
    expect(cache.getHash(file)).toBeUndefined()
  })

  test("skips files matched by nested .kilocodeignore during full scans", async () => {
  const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
  const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
  try {
    const dir = join(root, "pkg")
    const blocked = join(dir, "blocked.ts")
    const open = join(dir, "open.ts")

    await mkdir(dir, { recursive: true })
    await Bun.write(join(dir, ".kilocodeignore"), "blocked.ts\n")
    await Bun.write(blocked, "export const blocked = 1\n")
    await Bun.write(open, "export const open = 1\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const scan = new DirectoryScanner(new Emb(), new Store(), new Parser(), cache, await loadIgnore(root), 1, 1)
    const result = await scan.scanDirectory(root)

    expect(result.stats.processed).toBe(1)
    expect(cache.getHash(blocked)).toBeUndefined()
    expect(cache.getHash(open)).toBeDefined()
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(cacheDir, { recursive: true, force: true })
  }
})

  test("emits retry telemetry for transient batch failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-test-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "scanner-cache-"))
    const file = join(root, "main.ts")
    await Bun.write(file, "export const value = 2\n")

    const cache = new CacheManager(cacheDir, root)
    await cache.initialize()

    const events: IndexingTelemetryEvent[] = []
    const scan = new DirectoryScanner(
      new Emb(),
      new RetryStore(),
      new Parser(),
      cache,
      ignore(),
      1,
      2,
      (event) => events.push(event),
      {
        provider: "openai",
        vectorStore: "lancedb",
        modelId: "text-embedding-3-small",
      },
    )

    await scan.scanDirectory(root, undefined, undefined, undefined, "full")

    const retry = events.find((event) => event.type === "batch_retry")
    expect(retry).toBeDefined()
    expect(retry?.type).toBe("batch_retry")
    expect(retry?.source).toBe("scan")
    expect(retry?.attempt).toBe(1)
    expect(retry?.maxRetries).toBe(2)
    expect(retry?.error).toContain("[REDACTED_PATH]")
  })
})
