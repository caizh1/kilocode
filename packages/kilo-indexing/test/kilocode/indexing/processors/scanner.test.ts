import { createHash } from "crypto"
import { mkdtemp } from "fs/promises"
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
