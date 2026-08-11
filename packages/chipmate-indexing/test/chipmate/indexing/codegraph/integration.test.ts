import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import ignore from "ignore"
import { describe, expect, test } from "bun:test"
import type {
  CodeBlock,
  ICodeParser,
  IEmbedder,
  IVectorStore,
  PointStruct,
  VectorStoreSearchResult,
} from "../../../../src/indexing/interfaces"
import type { CacheManager } from "../../../../src/indexing/cache-manager"
import type {
  CodeGraphFileGraph,
  CodeGraphStorageStatus,
  CodeGraphStatusInput,
  CodePostingsDocument,
  CodePostingsSearchResult,
  CodePostingsStorageStatus,
  ICodeGraphStorage,
  ICodePostingsStorage,
} from "../../../../src/indexing/codegraph"
import { DirectoryScanner } from "../../../../src/indexing/processors/scanner"
import { FileWatcher } from "../../../../src/indexing/processors/file-watcher"
import { CodeGraphJsonStorage, CodePostingsJsonStorage } from "../../../../src/indexing/codegraph/storage"

class Emb implements IEmbedder {
  public async createEmbeddings(texts: string[]): Promise<{ embeddings: number[][] }> {
    return { embeddings: texts.map(() => [0.1]) }
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
      content?: string
      fileHash?: string
    },
  ): Promise<CodeBlock[]> {
    return [
      {
        file_path: filePath,
        identifier: "main",
        type: "definition.function",
        start_line: 1,
        end_line: 1,
        content: options?.content ?? "int main(void) { return 0; }",
        fileHash: options?.fileHash ?? "",
        segmentHash: `${filePath}:1`,
      },
    ]
  }
}

class Store implements IVectorStore {
  public points = 0
  public deleted: string[][] = []

  public async initialize(): Promise<boolean> {
    return false
  }

  public async upsertPoints(points: PointStruct[]): Promise<void> {
    this.points += points.length
  }

  public async search(
    _queryVector: number[],
    _directoryPrefix?: string,
    _minScore?: number,
    _maxResults?: number,
  ): Promise<VectorStoreSearchResult[]> {
    return []
  }

  public async deletePointsByFilePath(filePath: string): Promise<void> {
    this.deleted.push([filePath])
  }

  public async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
    this.deleted.push(filePaths)
  }

  public async activateFileGeneration(_filePath: string, _generation: string, _runId: string): Promise<void> {}

  public async deleteInactiveFilePoints(_filePath: string, _activeGeneration: string): Promise<void> {}

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

class Cache {
  private hashes: Record<string, string> = {}

  public getHash(filePath: string): string | undefined {
    return this.hashes[filePath]
  }

  public updateHash(filePath: string, hash: string): void {
    this.hashes[filePath] = hash
  }

  public async flush(): Promise<void> {}

  public deleteHash(filePath: string): void {
    delete this.hashes[filePath]
  }

  public getAllHashes(): Record<string, string> {
    return { ...this.hashes }
  }
}

class ThrowGraph implements ICodeGraphStorage {
  public async upsertFileGraph(): Promise<void> {
    throw new Error("graph write failed")
  }
  public async removeFileGraph(): Promise<void> {
    throw new Error("graph remove failed")
  }
  public async getFileGraph(): Promise<CodeGraphFileGraph | undefined> {
    throw new Error("graph read failed")
  }
  public async listFiles(): Promise<string[]> {
    return []
  }
  public async clear(): Promise<void> {}
  public status(): CodeGraphStorageStatus {
    return {
      workspacePath: "/tmp/ws",
      graphSchemaVersion: 1,
      parserVersion: 1,
      recordCount: 0,
      validFileCount: 0,
      parseErrorCount: 0,
      unsupportedCount: 0,
      staleCount: 0,
      schemaMismatch: false,
      parserMismatch: false,
      needsRebuild: false,
      evidenceAvailable: false,
    }
  }
  public async markFileGraphStatus(
    _filePath: string,
    _status: "parse_error" | "unsupported" | "stale",
    _input?: CodeGraphStatusInput,
  ): Promise<void> {
    throw new Error("graph status failed")
  }
  public async beginFullScan(): Promise<void> {
    throw new Error("graph begin failed")
  }
  public async markFullScanComplete(): Promise<void> {
    throw new Error("graph finish failed")
  }
}

class ThrowPostings implements ICodePostingsStorage {
  public async upsertFilePostings(): Promise<void> {
    throw new Error("postings write failed")
  }
  public async removeFilePostings(): Promise<void> {
    throw new Error("postings remove failed")
  }
  public async markFilePostingsStatus(): Promise<void> {}
  public async getFilePostings(): Promise<CodePostingsDocument | undefined> {
    return undefined
  }
  public async listFiles(): Promise<string[]> {
    return []
  }
  public async search(): Promise<CodePostingsSearchResult[]> {
    return []
  }
  public async clear(): Promise<void> {}
  public status(): CodePostingsStorageStatus {
    return {
      workspacePath: "/tmp/ws",
      postingsSchemaVersion: 1,
      tokenizerVersion: 1,
      graphSchemaVersion: 1,
      parserVersion: 1,
      documentCount: 0,
      recordCount: 0,
      validFileCount: 0,
      parseErrorCount: 0,
      unsupportedCount: 0,
      staleCount: 0,
      postingsErrorCount: 0,
      schemaMismatch: false,
      tokenizerMismatch: false,
      graphSchemaMismatch: false,
      parserMismatch: false,
      needsRebuild: false,
      diagnostics: [],
    }
  }
  public async beginFullScan(): Promise<void> {}
  public async markFullScanComplete(): Promise<void> {}
}

async function make() {
  const root = await mkdtemp(path.join(tmpdir(), "codegraph-integration-test-"))
  const cache = path.join(root, ".cache")
  await mkdir(path.join(root, "src"), { recursive: true })
  await mkdir(cache, { recursive: true })
  const mgr = new Cache() as unknown as CacheManager
  return { root, cache, mgr }
}

describe("code graph scanner and watcher integration", () => {
  test("DirectoryScanner upserts changed C graphs and prunes deleted graphs", async () => {
    const ctx = await make()
    const file = path.join(ctx.root, "src/main.c")
    await writeFile(file, "// scanner comment token\nint helper(void) { return 1; }\n")
    const graph = new CodeGraphJsonStorage({ workspacePath: ctx.root, cacheDirectory: ctx.cache })
    const postings = new CodePostingsJsonStorage({ workspacePath: ctx.root, cacheDirectory: ctx.cache })
    const scan = new DirectoryScanner(
      new Emb(),
      new Store(),
      new Parser(),
      ctx.mgr,
      ignore(),
      10,
      1,
      undefined,
      undefined,
      graph,
      postings,
    )

    await scan.scanDirectory(ctx.root)
    expect(graph.status()).toMatchObject({
      recordCount: 1,
      validFileCount: 1,
      parseErrorCount: 0,
      evidenceAvailable: false,
    })
    expect((await graph.getFileGraph(file))?.functions[0]?.name).toBe("helper")
    expect((await postings.search("scanner comment"))[0]?.filePath).toBe("src/main.c")

    await rm(file)
    await scan.scanDirectory(ctx.root)
    expect(graph.status()).toMatchObject({
      recordCount: 0,
      validFileCount: 0,
      staleCount: 0,
    })
    expect(await graph.getFileGraph(file)).toBeUndefined()
    expect(await postings.search("scanner comment")).toEqual([])
  })

  test("FileWatcher updates changed graphs and removes deleted graphs", async () => {
    const ctx = await make()
    const file = path.join(ctx.root, "main.c")
    await writeFile(file, "int first(void) { return 1; }\n")
    const graph = new CodeGraphJsonStorage({ workspacePath: ctx.root, cacheDirectory: ctx.cache })
    const postings = new CodePostingsJsonStorage({ workspacePath: ctx.root, cacheDirectory: ctx.cache })
    const watcher = new FileWatcher(
      ctx.root,
      ctx.mgr,
      new Emb(),
      new Store(),
      ignore(),
      10,
      1,
      undefined,
      undefined,
      graph,
      postings,
    )

    await watcher.processFile(file)
    expect((await graph.getFileGraph(file))?.functions[0]?.name).toBe("first")
    expect((await postings.search("first"))[0]?.filePath).toBe("main.c")

    await writeFile(file, "// watcher updated token\nint second(void) { return first(); }\n")
    await watcher.processFile(file)
    expect((await graph.getFileGraph(file))?.functions[0]?.name).toBe("second")
    expect(await postings.search("watcher updated")).toHaveLength(1)

    await (
      watcher as unknown as {
        processBatch(events: Map<string, { path: string; type: "create" | "change" | "delete" }>): Promise<void>
      }
    ).processBatch(new Map([[file, { path: file, type: "delete" }]]))
    expect(graph.status()).toMatchObject({ validFileCount: 0, staleCount: 1 })
    expect(postings.status()).toMatchObject({ validFileCount: 0, staleCount: 1 })
  })

  test("postings failures mark postings_error without interrupting vector indexing flow", async () => {
    const ctx = await make()
    const file = path.join(ctx.root, "main.c")
    await writeFile(file, "int main(void) { return 0; }\n")
    const store = new Store()
    const graph = new CodeGraphJsonStorage({ workspacePath: ctx.root, cacheDirectory: ctx.cache })
    const scan = new DirectoryScanner(
      new Emb(),
      store,
      new Parser(),
      ctx.mgr,
      ignore(),
      10,
      1,
      undefined,
      undefined,
      graph,
      new ThrowPostings(),
    )

    const result = await scan.scanDirectory(ctx.root)

    expect(result.stats.processed).toBe(1)
    expect(store.points).toBe(1)
  })

  test("graph transaction failures stop vector indexing", async () => {
    const ctx = await make()
    const file = path.join(ctx.root, "main.c")
    await writeFile(file, "int main(void) { return 0; }\n")
    const store = new Store()
    const scan = new DirectoryScanner(
      new Emb(),
      store,
      new Parser(),
      ctx.mgr,
      ignore(),
      10,
      1,
      undefined,
      undefined,
      new ThrowGraph(),
    )

    await expect(scan.scanDirectory(ctx.root)).rejects.toThrow("graph begin failed")
    expect(store.points).toBe(0)
  })
})
