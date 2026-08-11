/**
 * Comprehensive tests for LanceDBVectorStore.
 * All LanceDB and fs operations are mocked.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import type { Payload } from "../../../../src/indexing/interfaces"
import { createHash } from "crypto"
import * as path from "path"
import fs from "fs"
import { tmpdir } from "os"

const vectorFields = [
  "id",
  "vector",
  "workspaceId",
  "normalizedRoot",
  "filePath",
  "fileHash",
  "chunkHash",
  "chunkRange",
  "runId",
  "generation",
  "checkpointMetaHash",
  "active",
  "codeChunk",
  "startLine",
  "endLine",
  "segmentHash",
]

function schema(missing: string[] = []) {
  return {
    fields: vectorFields.filter((field) => !missing.includes(field)).map((name) => ({ name })),
  }
}

const mockMerge = {
  whenMatchedUpdateAll: mock().mockReturnThis(),
  whenNotMatchedInsertAll: mock().mockReturnThis(),
  execute: mock().mockResolvedValue(undefined),
}

const mockTable = {
  delete: mock().mockResolvedValue(undefined),
  add: mock().mockResolvedValue(undefined),
  mergeInsert: mock().mockReturnValue(mockMerge),
  query: mock().mockReturnThis(),
  where: mock().mockReturnThis(),
  toArray: mock().mockResolvedValue([]),
  countRows: mock().mockResolvedValue(0),
  vectorSearch: mock().mockReturnThis(),
  limit: mock().mockReturnThis(),
  refineFactor: mock().mockReturnThis(),
  postfilter: mock().mockReturnThis(),
  openTable: mock().mockResolvedValue(undefined),
  search: mock().mockReturnThis(),
  name: "vector",
  isOpen: true,
  close: mock(),
  display: mock(),
  schema: mock().mockResolvedValue(schema()),
  count: mock(),
  get: mock(),
  create: mock(),
  drop: mock(),
  insert: mock(),
  update: mock(),
  find: mock(),
  remove: mock(),
  createIndex: mock(),
  dropIndex: mock(),
  indexes: [],
  columns: [],
  primaryKey: "id",
  metadata: {},
  batch: mock(),
  distanceRange: mock().mockReturnThis(),
  optimize: mock().mockResolvedValue(undefined),
}
const mockDb = {
  openTable: mock().mockResolvedValue(mockTable),
  createTable: mock().mockResolvedValue(mockTable),
  dropTable: mock().mockResolvedValue(undefined),
  tableNames: mock().mockResolvedValue(["vector", "metadata"]),
  close: mock().mockResolvedValue(undefined),
  isOpen: true,
  display: mock(),
  createEmptyTable: mock(),
  dropAllTables: mock(),
}

const mockLanceDBModule = {
  connect: mock().mockResolvedValue(mockDb),
}

const mockLoadLanceDB = mock().mockResolvedValue(mockLanceDBModule)

mock.module("@lancedb/lancedb", () => mockLanceDBModule)
mock.module("../../../../src/indexing/vector-store/lancedb-loader", () => ({
  loadLanceDB: mockLoadLanceDB,
}))

// Import module under test AFTER mock.module
import { LanceDBVectorStore } from "../../../../src/indexing/vector-store/lancedb-vector-store"
import {
  compactSafeGenerationRoot,
  lanceDbWorstCasePaths,
  LANCEDB_WINDOWS_PATH_BUDGET,
} from "../../../../src/indexing/vector-store/lancedb-paths"

const workspacePath = path.join("mock", "workspace")
const vectorSize = 768
const dbDirectory = path.join("mock", "db")
let store: LanceDBVectorStore

// Collect all mock functions for bulk reset
const allMocks = [
  mockTable.delete,
  mockTable.add,
  mockTable.mergeInsert,
  mockMerge.whenMatchedUpdateAll,
  mockMerge.whenNotMatchedInsertAll,
  mockMerge.execute,
  mockTable.query,
  mockTable.where,
  mockTable.toArray,
  mockTable.countRows,
  mockTable.vectorSearch,
  mockTable.limit,
  mockTable.refineFactor,
  mockTable.postfilter,
  mockTable.openTable,
  mockTable.search,
  mockTable.close,
  mockTable.display,
  mockTable.schema,
  mockTable.count,
  mockTable.get,
  mockTable.create,
  mockTable.drop,
  mockTable.insert,
  mockTable.update,
  mockTable.find,
  mockTable.remove,
  mockTable.createIndex,
  mockTable.dropIndex,
  mockTable.batch,
  mockTable.distanceRange,
  mockTable.optimize,
  mockDb.openTable,
  mockDb.createTable,
  mockDb.dropTable,
  mockDb.tableNames,
  mockDb.close,
  mockDb.display,
  mockDb.createEmptyTable,
  mockDb.dropAllTables,
  mockLanceDBModule.connect,
  mockLoadLanceDB,
]

function resetAllMocks() {
  for (const m of allMocks) {
    m.mockReset()
  }
  // Re-apply default resolved values after reset
  mockTable.delete.mockResolvedValue(undefined)
  mockTable.add.mockResolvedValue(undefined)
  mockTable.mergeInsert.mockReturnValue(mockMerge)
  mockMerge.whenMatchedUpdateAll.mockReturnThis()
  mockMerge.whenNotMatchedInsertAll.mockReturnThis()
  mockMerge.execute.mockResolvedValue(undefined)
  mockTable.query.mockReturnThis()
  mockTable.where.mockReturnThis()
  mockTable.toArray.mockResolvedValue([])
  mockTable.countRows.mockResolvedValue(0)
  mockTable.vectorSearch.mockReturnThis()
  mockTable.limit.mockReturnThis()
  mockTable.refineFactor.mockReturnThis()
  mockTable.postfilter.mockReturnThis()
  mockTable.openTable.mockResolvedValue(undefined)
  mockTable.search.mockReturnThis()
  mockTable.schema.mockResolvedValue(schema())
  mockTable.distanceRange.mockReturnThis()
  mockTable.optimize.mockResolvedValue(undefined)
  mockDb.openTable.mockResolvedValue(mockTable)
  mockDb.createTable.mockResolvedValue(mockTable)
  mockDb.dropTable.mockResolvedValue(undefined)
  mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
  mockDb.close.mockResolvedValue(undefined)
  mockLanceDBModule.connect.mockResolvedValue(mockDb)
  mockLoadLanceDB.mockResolvedValue(mockLanceDBModule)
}

describe("LocalVectorStore", () => {
  beforeEach(() => {
    resetAllMocks()
    store = new LanceDBVectorStore(workspacePath, vectorSize, dbDirectory)
    // Patch LanceDB module directly for loadLanceDBModule
    // @ts-ignore
    store.lancedbModule = mockLanceDBModule
    // Patch db/table for getDb/getTable
    // @ts-ignore
    store.db = mockDb
    // @ts-ignore
    store.table = mockTable
  })

  afterEach(async () => {
    await store["closeConnect"]()
  })

  describe("constructor", () => {
    test("should set dbPath and vectorSize correctly", () => {
      expect(store["vectorSize"]).toBe(vectorSize)
      expect(store["workspacePath"]).toBe(workspacePath)
      expect(store["dbPath"]).toContain("mock")
    })

    test("keeps direct and safe Code Insiders paths within the Windows write budget", () => {
      const workspace = "D:\\2026\\7.31_2\\suspend_workspace\\branch_for_Jaguar6030_fpga_develop_tag_ES0"
      const indexing =
        "C:\\Users\\qinjc\\AppData\\Roaming\\Code - Insiders\\User\\globalStorage\\chipmate.chipmate\\v2\\state\\indexing"
      const bases = [path.win32.join(indexing, "c"), path.win32.join(indexing, "d")]

      const databases = bases.flatMap((base) => {
        const direct = new LanceDBVectorStore(workspace, 1024, base)
        const generation = path.win32.join(compactSafeGenerationRoot(workspace, base), "AbCd012_")
        const safe = new LanceDBVectorStore(workspace, 1024, generation, undefined, "")
        return [direct["dbPath"], safe["dbPath"]]
      })

      expect(databases).toHaveLength(4)
      expect(databases.every((database) => !database.includes("branch_for_Jaguar"))).toBe(true)
      expect(compactSafeGenerationRoot(workspace, bases[0])).not.toBe(databases[0])
      expect(compactSafeGenerationRoot(workspace, bases[1])).not.toBe(databases[2])
      for (const database of databases) {
        expect(lanceDbWorstCasePaths(database).maximum).toBeLessThanOrEqual(LANCEDB_WINDOWS_PATH_BUDGET)
      }
    })

    test("uses distinct compact identities for same-named workspaces", () => {
      const left = new LanceDBVectorStore("D:\\left\\workspace", vectorSize, "C:\\cmdb")
      const right = new LanceDBVectorStore("D:\\right\\workspace", vectorSize, "C:\\cmdb")

      expect(path.win32.basename(left["dbPath"])).toHaveLength(16)
      expect(left["dbPath"]).not.toBe(right["dbPath"])
    })

    test("normalizes Windows drive and path casing before deriving the identity", () => {
      const upper = new LanceDBVectorStore("D:\\Source\\Workspace", vectorSize, "C:\\cmdb")
      const lower = new LanceDBVectorStore("d:\\source\\workspace", vectorSize, "C:\\cmdb")

      expect(upper["dbPath"]).toBe(lower["dbPath"])
    })

    test("rejects an explicitly configured Windows root before opening LanceDB", () => {
      const base = `C:\\${Array.from({ length: 18 }, (_, index) => `very-long-directory-${index}`).join("\\")}`

      expect(() => new LanceDBVectorStore("D:\\source\\workspace", vectorSize, base)).toThrow(
        /Windows write path is too long.*C:\\cmdb/,
      )
    })

    test("reopens a legacy workspace-named database inside a safe generation", () => {
      const root = fs.mkdtempSync(path.join(tmpdir(), "lancedb-legacy-name-"))
      const workspace = path.join(root, "旧工作区")
      const hash = createHash("sha256").update(workspace).digest("hex").slice(0, 16)
      const legacy = path.join(root, `旧工作区-${hash}`)
      fs.mkdirSync(legacy, { recursive: true })

      try {
        const compatible = new LanceDBVectorStore(workspace, vectorSize, root, undefined, "v")
        expect(compatible["dbPath"]).toBe(legacy)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    test("rebuilds an unsafe legacy path and removes it only after compact completion", async () => {
      const root = fs.mkdtempSync(path.join(tmpdir(), "lancedb-unsafe-legacy-"))
      const workspace = path.join(root, "w".repeat(80))
      const base = path.join(root, "b".repeat(40))
      const hash = createHash("sha256").update(workspace).digest("hex").slice(0, 16)
      const legacy = path.join(base, `${path.basename(workspace)}-${hash}`)
      fs.mkdirSync(legacy, { recursive: true })
      const migrated = new LanceDBVectorStore(workspace, vectorSize, base)
      migrated["lancedbModule"] = mockLanceDBModule
      migrated["db"] = mockDb
      migrated["table"] = mockTable

      try {
        expect(migrated["dbPath"]).not.toBe(legacy)
        expect(fs.existsSync(legacy)).toBe(true)
        await migrated.markIndexingComplete()
        expect(fs.existsSync(legacy)).toBe(false)
      } finally {
        await migrated.close()
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    test("keeps an unsafe legacy path when compact completion fails", async () => {
      const root = fs.mkdtempSync(path.join(tmpdir(), "lancedb-failed-migration-"))
      const workspace = path.join(root, "w".repeat(80))
      const base = path.join(root, "b".repeat(40))
      const hash = createHash("sha256").update(workspace).digest("hex").slice(0, 16)
      const legacy = path.join(base, `${path.basename(workspace)}-${hash}`)
      fs.mkdirSync(legacy, { recursive: true })
      const migrated = new LanceDBVectorStore(workspace, vectorSize, base)
      migrated["lancedbModule"] = mockLanceDBModule
      migrated["db"] = mockDb
      migrated["table"] = mockTable
      mockTable.add.mockRejectedValueOnce(new Error("metadata write failed"))

      try {
        await expect(migrated.markIndexingComplete()).rejects.toThrow("metadata write failed")
        expect(fs.existsSync(legacy)).toBe(true)
      } finally {
        await migrated.close()
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    test("loads LanceDB through the shared loader", async () => {
      // @ts-ignore
      store.lancedbModule = null
      await store["loadLanceDBModule"]()
      expect(mockLoadLanceDB).toHaveBeenCalledTimes(1)
      expect(mockLanceDBModule.connect).not.toHaveBeenCalled()
    })

    test("serializes native connections across stores", async () => {
      const other = new LanceDBVectorStore(path.join("mock", "other"), vectorSize, dbDirectory)
      store["db"] = null
      other["lancedbModule"] = mockLanceDBModule
      let active = 0
      let maximum = 0
      mockLanceDBModule.connect.mockImplementation(async () => {
        active += 1
        maximum = Math.max(maximum, active)
        await Bun.sleep(10)
        active -= 1
        return mockDb
      })

      try {
        await Promise.all([store.collectionExists(), other.collectionExists()])
      } finally {
        await other.close()
      }

      expect(maximum).toBe(1)
    })
  })

  describe("initialize", () => {
    test("opens a complete compatible baseline without mutating it", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true as any)
      store["_getStoredEmbeddingProfile"] = mock().mockResolvedValue({
        provider: "openai",
        modelId: "",
        dimension: vectorSize,
      })
      store["_getMetadataValue"] = mock((_: unknown, key: string) =>
        Promise.resolve(key === "index_schema" ? "2" : "true"),
      )

      await store.openExisting()

      expect(mockDb.createTable).not.toHaveBeenCalled()
      expect(mockDb.dropTable).not.toHaveBeenCalled()
      expect(mockTable.delete).not.toHaveBeenCalled()
    })

    test("should create tables if not exist", async () => {
      mockDb.tableNames.mockResolvedValue([])
      mockDb.createTable.mockResolvedValue(mockTable)
      const result = await store.initialize()
      expect(result).toBe(true)
      expect(mockDb.createTable).toHaveBeenCalled()
    })

    test("should recreate tables if vector size changed", async () => {
      mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
      mockDb.openTable.mockResolvedValue(mockTable)
      store["_getStoredVectorSize"] = mock().mockResolvedValue(vectorSize + 1)
      mockDb.dropTable.mockResolvedValue(undefined)
      mockDb.createTable.mockResolvedValue(mockTable)
      const result = await store.initialize()
      expect(result).toBe(true)
      expect(mockDb.dropTable).toHaveBeenCalled()
    })

    test("should not recreate if vector size and schema match", async () => {
      mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
      mockDb.openTable.mockResolvedValue(mockTable)
      store["_getStoredVectorSize"] = mock().mockResolvedValue(vectorSize)
      store["_getMetadataValue"] = mock().mockResolvedValue("2")
      const result = await store.initialize()
      expect(result).toBe(false)
      expect(mockDb.dropTable).not.toHaveBeenCalled()
      expect(store.getLastCompatibilityDecision()).toMatchObject({
        action: "reuse",
        reason: "compatible",
        created: false,
      })
    })

    test("should recreate legacy vector tables when current schema fields are missing", async () => {
      mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
      mockDb.openTable.mockResolvedValue(mockTable)
      mockTable.countRows.mockResolvedValue(2)
      mockTable.schema.mockResolvedValue(schema(["workspaceId", "active"]))
      store["_getStoredVectorSize"] = mock().mockResolvedValue(vectorSize)
      store["_getStoredEmbeddingProfile"] = mock().mockResolvedValue({
        provider: "openai",
        modelId: "",
        dimension: vectorSize,
      })

      const result = await store.initialize()

      expect(result).toBe(true)
      expect(mockDb.dropTable).toHaveBeenCalledWith("vector")
      expect(mockDb.dropTable).toHaveBeenCalledWith("metadata")
      expect(store.getLastCompatibilityDecision()).toMatchObject({
        action: "rebuild",
        reason: "vector schema mismatch",
        created: true,
      })
    })

    test("recreates an index using the legacy payload schema", async () => {
      mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
      mockDb.openTable.mockResolvedValue(mockTable)
      store["_getStoredVectorSize"] = mock().mockResolvedValue(vectorSize)
      store["_getMetadataValue"] = mock().mockResolvedValue("1")

      expect(await store.initialize()).toBe(true)
      expect(mockDb.dropTable).toHaveBeenCalledTimes(2)
    })

    test("should throw error on LanceDB failure", async () => {
      mockDb.tableNames.mockRejectedValue(new Error("fail"))
      await expect(store.initialize()).rejects.toThrow()
    })

    test("does not recreate when vector metadata cannot be read", async () => {
      store["_getStoredVectorSize"] = mock().mockRejectedValue(new Error("metadata unavailable"))

      await expect(store.initialize()).rejects.toThrow("metadata unavailable")
      expect(mockDb.dropTable).not.toHaveBeenCalled()
      expect(mockDb.createTable).not.toHaveBeenCalled()
    })

    test("does not recreate when profile metadata cannot be read", async () => {
      mockTable.countRows.mockResolvedValue(1)
      store["_getStoredVectorSize"] = mock().mockResolvedValue(vectorSize)
      store["_getMetadataValue"] = mock().mockResolvedValue("2")
      store["_getStoredEmbeddingProfile"] = mock().mockRejectedValue(new Error("profile unavailable"))

      await expect(store.initialize()).rejects.toThrow("profile unavailable")
      expect(mockDb.dropTable).not.toHaveBeenCalled()
      expect(mockDb.createTable).not.toHaveBeenCalled()
    })

    test("should recreate tables when stored embedding identity differs", async () => {
      const identity = {
        provider: "openai",
        modelId: "text-embedding-3-small",
        dimension: vectorSize,
      }
      store = new (LanceDBVectorStore as any)(workspacePath, vectorSize, dbDirectory, identity)
      // @ts-ignore
      store.lancedbModule = mockLanceDBModule
      // @ts-ignore
      store.db = mockDb
      // @ts-ignore
      store.table = mockTable

      const metadataTable = {
        query: mock().mockReturnThis(),
        where: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([]),
      }

      metadataTable.where.mockImplementation((query: string) => {
        const rows = {
          "key = 'vector_size'": [{ key: "vector_size", value: vectorSize }],
          "key = 'embedding_provider'": [{ key: "embedding_provider", value: "ollama" }],
          "key = 'embedding_model_id'": [{ key: "embedding_model_id", value: "nomic-embed-text" }],
          "key = 'embedding_dimension'": [{ key: "embedding_dimension", value: vectorSize }],
        }
        metadataTable.toArray.mockResolvedValue(rows[query as keyof typeof rows] ?? [])
        return metadataTable
      })

      mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
      mockTable.countRows.mockResolvedValue(4)
      mockDb.openTable.mockImplementation((name: string) => {
        if (name === "metadata") return Promise.resolve(metadataTable as any)
        return Promise.resolve(mockTable as any)
      })

      const result = await store.initialize()

      expect(result).toBe(true)
      expect(mockDb.dropTable).toHaveBeenCalledWith("vector")
      expect(mockDb.dropTable).toHaveBeenCalledWith("metadata")
    })

    test("should recreate legacy populated tables when identity metadata is missing", async () => {
      const identity = {
        provider: "openai",
        modelId: "text-embedding-3-small",
        dimension: vectorSize,
      }
      store = new (LanceDBVectorStore as any)(workspacePath, vectorSize, dbDirectory, identity)
      // @ts-ignore
      store.lancedbModule = mockLanceDBModule
      // @ts-ignore
      store.db = mockDb
      // @ts-ignore
      store.table = mockTable

      const metadataTable = {
        query: mock().mockReturnThis(),
        where: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([]),
      }

      metadataTable.where.mockImplementation((query: string) => {
        const rows = {
          "key = 'vector_size'": [{ key: "vector_size", value: vectorSize }],
          "key = 'embedding_provider'": [],
          "key = 'embedding_model_id'": [],
          "key = 'embedding_dimension'": [],
        }
        metadataTable.toArray.mockResolvedValue(rows[query as keyof typeof rows] ?? [])
        return metadataTable
      })

      mockDb.tableNames.mockResolvedValue(["vector", "metadata"])
      mockTable.countRows.mockResolvedValue(2)
      mockDb.openTable.mockImplementation((name: string) => {
        if (name === "metadata") return Promise.resolve(metadataTable as any)
        return Promise.resolve(mockTable as any)
      })

      const result = await store.initialize()

      expect(result).toBe(true)
      expect(mockDb.dropTable).toHaveBeenCalledWith("vector")
      expect(mockDb.dropTable).toHaveBeenCalledWith("metadata")
    })
  })

  describe("upsertPoints", () => {
    test("should do nothing for empty points", async () => {
      await expect(store.upsertPoints([])).resolves.toBeUndefined()
    })

    test("should do nothing for invalid payloads", async () => {
      const points = [{ id: "1", vector: [1, 2, 3], payload: {} }]
      mockTable.add.mockResolvedValue(undefined)
      await expect(store.upsertPoints(points)).resolves.toBeUndefined()
      expect(mockTable.add).not.toHaveBeenCalled()
    })

    test("should upsert valid points", async () => {
      const points = [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          vector: [1, 2, 3],
          payload: { filePath: "a", fileHash: "hash-a", codeChunk: "b", startLine: 1, endLine: 2 },
        },
      ]
      await store.upsertPoints(points)
      expect(mockTable.mergeInsert).toHaveBeenCalledWith("id")
      expect(mockMerge.whenMatchedUpdateAll).toHaveBeenCalled()
      expect(mockMerge.whenNotMatchedInsertAll).toHaveBeenCalled()
      expect(mockMerge.execute).toHaveBeenCalledTimes(1)
      expect(mockMerge.execute.mock.calls[0]?.[1]).toEqual({ timeoutMs: 120_000 })
    })

    test("serializes concurrent merge inserts", async () => {
      let active = 0
      let maximum = 0
      mockMerge.execute.mockImplementation(async () => {
        active += 1
        maximum = Math.max(maximum, active)
        await Bun.sleep(10)
        active -= 1
      })
      const point = (id: string) => ({
        id,
        vector: [1, 2, 3],
        payload: { filePath: id, fileHash: id, codeChunk: id, startLine: 1, endLine: 2 },
      })

      await Promise.all([
        store.upsertPoints([point("123e4567-e89b-12d3-a456-426614174000")]),
        store.upsertPoints([point("123e4567-e89b-12d3-a456-426614174001")]),
      ])

      expect(maximum).toBe(1)
      expect(mockMerge.execute).toHaveBeenCalledTimes(2)
    })

    test("serializes generation finalization behind an active merge insert", async () => {
      let writing = false
      let overlapped = false
      mockMerge.execute.mockImplementation(async () => {
        writing = true
        await Bun.sleep(10)
        writing = false
      })
      mockTable.update.mockImplementation(async () => {
        if (writing) overlapped = true
      })
      const point = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        vector: [1, 2, 3],
        payload: { filePath: "src/a.ts", fileHash: "hash", codeChunk: "code", startLine: 1, endLine: 2 },
      }

      await Promise.all([
        store.upsertPoints([point]),
        store.finalizeFileGenerations([{ filePath: "src/a.ts", generation: "generation", runId: "run" }]),
      ])

      expect(overlapped).toBe(false)
      expect(mockTable.update).toHaveBeenCalledTimes(1)
    })

    test("splits one timed-out merge insert into smaller serialized batches", async () => {
      const points = Array.from({ length: 4 }, (_, index) => ({
        id: `123e4567-e89b-12d3-a456-42661417400${index}`,
        vector: [1, 2, 3],
        payload: {
          filePath: `src/file-${index}.ts`,
          fileHash: `hash-${index}`,
          codeChunk: `export const value${index} = ${index}`,
          startLine: 1,
          endLine: 1,
        },
      }))
      mockMerge.execute.mockRejectedValueOnce(
        new Error("Failed to execute merge insert: GenericFailure, runtime error: Merge Insert timed out"),
      )

      await store.upsertPoints(points)

      expect(mockMerge.execute).toHaveBeenCalledTimes(3)
      expect(mockMerge.execute.mock.calls.map((call) => call[0].length)).toEqual([4, 2, 2])
    })

    test("recursively splits repeated merge timeouts down to single-point writes", async () => {
      const points = Array.from({ length: 4 }, (_, index) => ({
        id: `123e4567-e89b-12d3-a456-42661417401${index}`,
        vector: [1, 2, 3],
        payload: {
          filePath: `src/repeated-${index}.ts`,
          fileHash: `hash-${index}`,
          codeChunk: `export const repeated${index} = ${index}`,
          startLine: 1,
          endLine: 1,
        },
      }))
      mockMerge.execute.mockImplementation(async (data: unknown[]) => {
        if (data.length > 1) {
          throw new Error("Failed to execute merge insert: GenericFailure, runtime error: Merge Insert timed out")
        }
      })

      await store.upsertPoints(points)

      expect(mockMerge.execute.mock.calls.map((call) => call[0].length)).toEqual([4, 2, 1, 1, 2, 1, 1])
    })

    test("uses one merge transaction for a 1000-point batch", async () => {
      const points = Array.from({ length: 1000 }, (_, index) => ({
        id: crypto.randomUUID(),
        vector: [1, 2, 3],
        payload: {
          filePath: `src/file-${index}.ts`,
          fileHash: `hash-${index}`,
          codeChunk: `export const value${index} = ${index}`,
          startLine: 1,
          endLine: 1,
        },
      }))

      await store.upsertPoints(points)

      expect(mockMerge.execute).toHaveBeenCalledTimes(1)
      expect(mockMerge.execute.mock.calls[0]?.[0]).toHaveLength(1000)
      expect(mockTable.delete).not.toHaveBeenCalled()
      expect(mockTable.add).not.toHaveBeenCalled()
    })

    test("should throw error on add failure", async () => {
      const points = [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          vector: [1, 2, 3],
          payload: { filePath: "a", fileHash: "hash-a", codeChunk: "b", startLine: 1, endLine: 2 },
        },
      ]
      mockMerge.execute.mockRejectedValue(new Error("fail"))
      await expect(store.upsertPoints(points)).rejects.toThrow()
    })
  })

  test("finalizes multiple file generations with one update and one delete", async () => {
    await store.finalizeFileGenerations([
      { filePath: "目录/O'Reilly one.ts", generation: "gen-1", runId: "run-1" },
      { filePath: String.raw`src\second.ts`, generation: "gen-2", runId: "run-2" },
    ])

    expect(mockTable.update).toHaveBeenCalledTimes(1)
    expect(mockTable.delete).toHaveBeenCalledTimes(1)
    const update = mockTable.update.mock.calls[0]?.[0] as { where: string; values: { active: boolean } }
    expect(update.where).toContain("O''Reilly one.ts")
    expect(update.where).toContain("gen-1")
    expect(update.where).toContain("gen-2")
    expect(update.values.active).toBe(true)
    expect(mockTable.delete.mock.calls[0]?.[0]).toContain("AND NOT (")
  })

  test("cleans inactive points without clearing or deleting the collection", async () => {
    const stats = await store.cleanupInactivePoints()

    expect(stats.skipped).toEqual([])
    expect(mockTable.delete).toHaveBeenCalledWith("`active` = false")
    expect(mockTable.optimize).toHaveBeenCalled()
    expect(mockDb.dropTable).not.toHaveBeenCalled()
  })

  describe("indexing metadata", () => {
    test("does not clear completed marker when marking current run incomplete", async () => {
      mockDb.openTable.mockResolvedValue(mockTable)

      await store.markIndexingIncomplete()

      const added = mockTable.add.mock.calls.flatMap((call) => call[0] as Array<{ key: string; value: string }>)
      expect(added.some((item) => item.key === "indexing_complete")).toBe(false)
      expect(added).toContainEqual({ key: "indexing_run_incomplete", value: "true" })
    })
  })

  describe("search", () => {
    test("should return filtered results using distanceRange", async () => {
      const distanceRangeSpy = mock().mockReturnThis()
      const toArray = mock().mockResolvedValue([
        { id: "2", _distance: 0.2, filePath: "a", fileHash: "hash-a", codeChunk: "c", startLine: 3, endLine: 4 },
      ])
      mockTable.search.mockResolvedValue({
        where: mock().mockReturnThis(),
        distanceType: mock().mockReturnThis(),
        distanceRange: distanceRangeSpy,
        limit: mock().mockReturnThis(),
        toArray,
      })
      const results = await store.search([1, 2, 3], "a", 0.7, 1)
      expect(results.length).toBe(1)
      const first = results[0]
      expect(first).toBeDefined()
      expect(first!.id).toBe("2")
      expect(first!.score).toBeCloseTo(1 - 0.2)
      // Keep numerically perfect cosine matches whose distance can be a tiny negative value.
      const calls = distanceRangeSpy.mock.calls[0]
      expect(calls).toBeDefined()
      expect(calls![0]).toBe(-1e-6)
      expect(calls![1]).toBeCloseTo(0.3) // Handle floating point precision: 1 - 0.7
      expect(toArray).toHaveBeenCalledWith({ timeoutMs: 30_000 })
    })

    test("should filter by minScore at database level", async () => {
      const distanceRangeSpy = mock().mockReturnThis()
      mockTable.search.mockResolvedValue({
        where: mock().mockReturnThis(),
        distanceType: mock().mockReturnThis(),
        distanceRange: distanceRangeSpy,
        limit: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([
          { id: "2", _distance: 0.2, filePath: "a", fileHash: "hash-a", codeChunk: "c", startLine: 3, endLine: 4 },
        ]),
      })
      const results = await store.search([1, 2, 3], "a", 0.1, 2)
      expect(results.length).toBe(1)
      const first = results[0]
      expect(first).toBeDefined()
      expect(first!.id).toBe("2")
      // Verify distanceRange preserves the score ceiling and the floating-point tolerance.
      expect(distanceRangeSpy).toHaveBeenCalledWith(-1e-6, 0.9)
    })

    test("should throw error on search failure", async () => {
      mockTable.search.mockRejectedValue(new Error("fail"))
      await expect(store.search([1, 2, 3])).rejects.toThrow()
    })
  })

  describe("deletePointsByFilePath", () => {
    test("should call deletePointsByMultipleFilePaths", async () => {
      const spy = spyOn(store, "deletePointsByMultipleFilePaths").mockResolvedValue(undefined)
      await store.deletePointsByFilePath("a")
      expect(spy).toHaveBeenCalledWith(["a"])
    })
  })

  describe("deletePointsByMultipleFilePaths", () => {
    test("should do nothing for empty filePaths", async () => {
      await expect(store.deletePointsByMultipleFilePaths([])).resolves.toBeUndefined()
    })

    test("should delete points for valid filePaths", async () => {
      mockTable.delete.mockResolvedValue(undefined)
      await store.deletePointsByMultipleFilePaths(["a", "b"])
      expect(mockTable.delete).toHaveBeenCalled()
    })

    test("should throw error on delete failure", async () => {
      mockTable.delete.mockRejectedValue(new Error("fail"))
      await expect(store.deletePointsByMultipleFilePaths(["a"])).rejects.toThrow()
    })
  })

  describe("deleteCollection", () => {
    test("should remove dbPath if exists", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true as any)
      spyOn(fs, "rmSync").mockImplementation(() => {})
      await expect(store.deleteCollection()).resolves.toBeUndefined()
      expect(fs.rmSync).toHaveBeenCalled()
    })

    test("should clear tables if rmSync fails", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true as any)
      spyOn(fs, "rmSync").mockImplementation(() => {
        throw new Error("fail")
      })
      mockDb.tableNames.mockImplementation(() => ["vector"])
      mockDb.dropTable.mockResolvedValue(undefined)
      await expect(store.deleteCollection()).rejects.toThrow()
      expect(mockDb.dropTable).toHaveBeenCalled()
    })
  })

  describe("clearCollection", () => {
    test("clears vectors while restoring the complete embedding profile", async () => {
      const metadataTable = {
        delete: mock().mockResolvedValue(undefined),
        add: mock().mockResolvedValue(undefined),
      }
      store = new LanceDBVectorStore(workspacePath, vectorSize, dbDirectory, {
        provider: "openai-compatible",
        modelId: "qwen3-embedding-8b",
        dimension: vectorSize,
        dimensionMode: "fixed",
        requestedDimension: vectorSize,
        endpointDigest: "endpoint-digest",
        fingerprintDigest: "fingerprint-digest",
        qualityVersion: "qwen3-dense-v1",
        instructionVersion: "qwen3-retrieval-v1",
      })
      store["lancedbModule"] = mockLanceDBModule
      store["db"] = mockDb
      store["table"] = mockTable
      mockDb.tableNames.mockResolvedValue(["metadata"])
      mockDb.openTable.mockImplementation((name: string) =>
        Promise.resolve(name === "metadata" ? (metadataTable as any) : mockTable),
      )

      await expect(store.clearCollection()).resolves.toBeUndefined()

      expect(mockTable.delete).toHaveBeenCalledWith("true")
      expect(metadataTable.delete).not.toHaveBeenCalledWith("true")
      expect(metadataTable.add.mock.calls.map((call) => call[0][0])).toEqual(
        expect.arrayContaining([
          { key: "index_schema", value: "2" },
          { key: "vector_size", value: String(vectorSize) },
          { key: "embedding_provider", value: "openai-compatible" },
          { key: "embedding_model_id", value: "qwen3-embedding-8b" },
          { key: "embedding_dimension", value: String(vectorSize) },
          { key: "embedding_dimension_mode", value: "fixed" },
          { key: "embedding_requested_dimension", value: String(vectorSize) },
          { key: "embedding_endpoint_digest", value: "endpoint-digest" },
          { key: "embedding_fingerprint_digest", value: "fingerprint-digest" },
          { key: "embedding_quality_version", value: "qwen3-dense-v1" },
          { key: "embedding_instruction_version", value: "qwen3-retrieval-v1" },
          { key: "indexing_complete", value: "false" },
          { key: "indexing_run_incomplete", value: "false" },
        ]),
      )
    })

    test("fails the clear when compatibility metadata cannot be restored", async () => {
      mockTable.delete.mockResolvedValue(undefined)
      mockDb.tableNames.mockResolvedValue(["metadata"])
      mockDb.openTable.mockRejectedValue(new Error("fail"))
      await expect(store.clearCollection()).rejects.toThrow("fail")
    })

    test("should throw error on main table clear failure", async () => {
      mockTable.delete.mockRejectedValue(new Error("fail"))
      await expect(store.clearCollection()).rejects.toThrow()
    })
  })

  describe("collectionExists", () => {
    test("should return true if vector table exists", async () => {
      mockDb.tableNames.mockResolvedValue(["vector"])
      const exists = await store.collectionExists()
      expect(exists).toBe(true)
    })

    test("should return false if vector table does not exist", async () => {
      mockDb.tableNames.mockResolvedValue([])
      const exists = await store.collectionExists()
      expect(exists).toBe(false)
    })

    test("should return false on error", async () => {
      mockDb.tableNames.mockRejectedValue(new Error("fail"))
      const exists = await store.collectionExists()
      expect(exists).toBe(false)
    })
  })

  describe("isPayloadValid", () => {
    test("should return false for null/undefined", () => {
      expect(store["isPayloadValid"](null)).toBe(false)
      expect(store["isPayloadValid"](undefined)).toBe(false)
    })

    test("should return false for missing keys", () => {
      expect(store["isPayloadValid"]({ filePath: "a" })).toBe(false)
    })

    test("should return true for valid payload", () => {
      const payload: Payload = { filePath: "a", fileHash: "hash-a", codeChunk: "b", startLine: 1, endLine: 2 }
      expect(store["isPayloadValid"](payload)).toBe(true)
    })
  })

  describe("escapeSqlString", () => {
    test("should double single quotes", () => {
      expect(store["escapeSqlString"]("O'Reilly")).toBe("O''Reilly")
    })

    test("should handle SQL injection attempts", () => {
      expect(store["escapeSqlString"]("' OR '1'='1")).toBe("'' OR ''1''=''1")
    })

    test("should handle multiple consecutive quotes", () => {
      expect(store["escapeSqlString"]("''")).toBe("''''")
    })

    test("should handle empty strings", () => {
      expect(store["escapeSqlString"]("")).toBe("")
    })

    test("should preserve backslashes", () => {
      expect(store["escapeSqlString"]("C:\\Users\\test")).toBe("C:\\Users\\test")
    })

    test("should handle strings with no special characters", () => {
      expect(store["escapeSqlString"]("normalstring")).toBe("normalstring")
    })

    test("should handle unicode characters", () => {
      expect(store["escapeSqlString"]("test's 文件")).toBe("test''s 文件")
    })

    test("should prevent comment injection attempts", () => {
      expect(store["escapeSqlString"]("test' --")).toBe("test'' --")
    })
  })

  describe("escapeSqlLikePattern", () => {
    test("should escape percent signs", () => {
      expect(store["escapeSqlLikePattern"]("50%")).toBe("50\\%")
    })

    test("should escape underscores", () => {
      expect(store["escapeSqlLikePattern"]("test_file")).toBe("test\\_file")
    })

    test("should escape both quotes and wildcards", () => {
      expect(store["escapeSqlLikePattern"]("test'_%")).toBe("test''\\_\\%")
    })

    test("should handle empty strings", () => {
      expect(store["escapeSqlLikePattern"]("")).toBe("")
    })

    test("should handle multiple wildcards", () => {
      expect(store["escapeSqlLikePattern"]("%%__")).toBe("\\%\\%\\_\\_")
    })

    test("should escape quotes before wildcards", () => {
      const result = store["escapeSqlLikePattern"]("path's%file_name")
      expect(result).toBe("path''s\\%file\\_name")
    })

    test("should escape backslashes in Windows paths", () => {
      expect(store["escapeSqlLikePattern"]("C:\\Users\\test")).toBe("C:\\\\Users\\\\test")
    })

    test("should escape backslashes before wildcards", () => {
      expect(store["escapeSqlLikePattern"]("C:\\test_file%")).toBe("C:\\\\test\\_file\\%")
    })

    test("should handle backslash at end", () => {
      expect(store["escapeSqlLikePattern"]("path\\")).toBe("path\\\\")
    })
  })

  describe("isValidId", () => {
    test("should accept UUID ids", () => {
      const id = "123e4567-e89b-12d3-a456-426614174000"
      expect(store["isValidId"](id)).toBe(true)
    })

    test("should reject non UUID ids", () => {
      expect(store["isValidId"]("test")).toBe(false)
      expect(store["isValidId"]("test' OR id != '")).toBe(false)
      expect(store["isValidId"]("123e4567-e89b-12d3-a456")).toBe(false)
    })
  })

  describe("SQL Injection Prevention", () => {
    test("should reject non UUID ids in upsertPoints", async () => {
      const maliciousId = "test' OR id != '"
      const points = [
        {
          id: maliciousId,
          vector: [1, 2, 3],
          payload: {
            filePath: "test.ts",
            fileHash: "hash-test",
            codeChunk: "code",
            startLine: 1,
            endLine: 2,
          },
        },
      ]

      mockTable.delete.mockResolvedValue(undefined)
      mockTable.add.mockResolvedValue(undefined)
      await expect(store.upsertPoints(points)).rejects.toThrow("Invalid point id format")
      expect(mockTable.delete).not.toHaveBeenCalled()
      expect(mockTable.add).not.toHaveBeenCalled()
    })

    test("should reject batches that include non UUID ids", async () => {
      const points = [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          vector: [1, 2, 3],
          payload: { filePath: "a", fileHash: "hash-a", codeChunk: "b", startLine: 1, endLine: 2 },
        },
        {
          id: "' OR '1'='1",
          vector: [4, 5, 6],
          payload: { filePath: "c", fileHash: "hash-c", codeChunk: "d", startLine: 3, endLine: 4 },
        },
      ]

      mockTable.delete.mockResolvedValue(undefined)
      mockTable.add.mockResolvedValue(undefined)
      await expect(store.upsertPoints(points)).rejects.toThrow("Invalid point id format")
      expect(mockTable.delete).not.toHaveBeenCalled()
      expect(mockTable.add).not.toHaveBeenCalled()
    })

    test("should prevent injection via directory prefix in search", async () => {
      const maliciousPrefix = "src' OR '1'='1"
      const whereSpy = mock().mockReturnThis()
      mockTable.search.mockResolvedValue({
        where: whereSpy,
        distanceType: mock().mockReturnThis(),
        distanceRange: mock().mockReturnThis(),
        limit: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([]),
      })

      await store.search([1, 2, 3], maliciousPrefix)

      // Verify proper escaping in the where clause
      expect(whereSpy).toHaveBeenCalledWith("`active` = true AND `filePath` LIKE 'src'' OR ''1''=''1%'")
    })

    test("should prevent injection with wildcards in directory prefix", async () => {
      const maliciousPrefix = "50%_test"
      const whereSpy = mock().mockReturnThis()
      mockTable.search.mockResolvedValue({
        where: whereSpy,
        distanceType: mock().mockReturnThis(),
        distanceRange: mock().mockReturnThis(),
        limit: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([]),
      })

      await store.search([1, 2, 3], maliciousPrefix)

      expect(whereSpy).toHaveBeenCalledWith("`active` = true AND `filePath` LIKE '50\\%\\_test%'")
    })

    test("should handle Windows paths with backslashes in search", async () => {
      const windowsPrefix = "C:\\Users\\test"
      const whereSpy = mock().mockReturnThis()
      mockTable.search.mockResolvedValue({
        where: whereSpy,
        distanceType: mock().mockReturnThis(),
        distanceRange: mock().mockReturnThis(),
        limit: mock().mockReturnThis(),
        toArray: mock().mockResolvedValue([]),
      })

      await store.search([1, 2, 3], windowsPrefix)

      // Backslashes should be escaped in LIKE patterns
      expect(whereSpy).toHaveBeenCalledWith("`active` = true AND `filePath` LIKE 'C:\\\\Users\\\\test%'")
    })

    test("should prevent injection via file paths in deletePointsByFilePath", async () => {
      const maliciousPath = "file.ts' OR '1'='1"
      mockTable.delete.mockResolvedValue(undefined)

      await store.deletePointsByFilePath(maliciousPath)

      expect(mockTable.delete).toHaveBeenCalledWith("`filePath` IN ('file.ts'' OR ''1''=''1')")
    })

    test("should prevent injection via multiple file paths in deletePointsByMultipleFilePaths", async () => {
      const paths = ["normal.ts", "file' OR '1'='1.ts", "another.ts"]
      mockTable.delete.mockResolvedValue(undefined)

      await store.deletePointsByMultipleFilePaths(paths)

      expect(mockTable.delete).toHaveBeenCalledWith(
        "`filePath` IN ('normal.ts', 'file'' OR ''1''=''1.ts', 'another.ts')",
      )
    })

    test("should handle relative paths with backslashes safely", async () => {
      const windowsPath = "dir\\file.ts"
      mockTable.delete.mockResolvedValue(undefined)

      await store.deletePointsByFilePath(windowsPath)

      // Backslashes should be preserved, only quotes escaped
      expect(mockTable.delete).toHaveBeenCalledWith(`\`filePath\` IN ('dir\\file.ts')`)
    })

    test("should preserve external document keys", async () => {
      mockTable.delete.mockResolvedValue(undefined)

      await store.deletePointsByFilePath("@external/0123456789abcdef/guide.md")

      expect(mockTable.delete).toHaveBeenCalledWith("`filePath` IN ('@external/0123456789abcdef/guide.md')")
    })
  })
})
