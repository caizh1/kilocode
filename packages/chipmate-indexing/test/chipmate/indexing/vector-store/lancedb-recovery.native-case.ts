import { afterEach, describe, expect, test } from "bun:test"
import { connect, type Connection } from "@lancedb/lancedb"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import ignore from "ignore"
import { CodeIndexConfigManager } from "../../../../src/indexing/config-manager"
import { DocumentIndexService } from "../../../../src/indexing/documents/service"
import { EmbeddingRuntimeStore } from "../../../../src/indexing/embedding-runtime-store"
import type { EmbeddingRuntimeProfile, IEmbedder } from "../../../../src/indexing/interfaces/embedder"
import type { IVectorStore, PointStruct } from "../../../../src/indexing/interfaces/vector-store"
import { compactSafeGenerationRoot } from "../../../../src/indexing/vector-store/lancedb-paths"
import { LanceDBVectorStore } from "../../../../src/indexing/vector-store/lancedb-vector-store"
import { SafeLanceDBVectorStore } from "../../../../src/indexing/vector-store/safe-lancedb-vector-store"

const roots: string[] = []
const stores: IVectorStore[] = []
const connections: Connection[] = []
const services: DocumentIndexService[] = []

afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose()
  for (const store of stores.splice(0)) await store.close?.()
  for (const connection of connections.splice(0)) connection.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function profile(modelId = "qwen3-vl-embedding-8b"): EmbeddingRuntimeProfile {
  return {
    provider: "openai-compatible",
    modelId,
    dimensionMode: "fixed",
    requestedDimension: 4096,
    dimension: 4096,
    endpointDigest: "隔离端点摘要",
    fingerprint: [vector()],
    fingerprintDigest: `隔离模型指纹-${modelId}`,
    qualityVersion: "qwen3-dense-v1",
    instructionVersion: "qwen3-retrieval-v1",
  }
}

function vector(seed = 1): number[] {
  return Array.from({ length: 4096 }, (_, index) => Math.cos((index + 1) * seed) + 0.03)
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "chipmate-lancedb-recovery-"))
  roots.push(root)
  const workspace = path.join(root, "workspace")
  await mkdir(workspace)
  const directory = path.join(root, "database")
  const db = await connect(directory)
  connections.push(db)
  const open = (identity = profile()) => {
    const store = new LanceDBVectorStore(workspace, identity.dimension, directory, identity, "")
    stores.push(store)
    return store
  }
  return { root, workspace, directory, db, open }
}

function point(workspace: string, file = "sample.c", seed = 1): PointStruct {
  return {
    id: randomUUID(),
    vector: vector(seed),
    payload: {
      workspaceId: "隔离工作区",
      normalizedRoot: workspace,
      filePath: file,
      fileHash: "内容哈希",
      chunkHash: "分块哈希",
      chunkRange: "1:1",
      runId: "索引轮次",
      generation: "索引代",
      checkpointMetaHash: "检查点哈希",
      active: true,
      codeChunk: "int sample(void) { return 1; }",
      startLine: 1,
      endLine: 1,
      segmentHash: "片段哈希",
    },
  }
}

async function metadata(db: Connection) {
  const table = await db.openTable("metadata")
  try {
    const rows = await table.query().toArray()
    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  } finally {
    table.close()
  }
}

describe("LanceDB 初始化恢复原生回归", () => {
  for (const state of ["空库", "仅元数据表", "仅向量表", "完整兼容库"] as const) {
    test(`${state}恢复后保持正确的模型身份与完成状态`, async () => {
      const ctx = await fixture()
      const identity = profile("qwen3-embedding-8b")
      const old = point(ctx.workspace)
      if (state !== "空库") {
        const initial = ctx.open(identity)
        await initial.initialize()
        await initial.upsertPoints([old])
        await initial.markIndexingComplete()
        await initial.close()
        if (state === "仅元数据表") await ctx.db.dropTable("vector")
        if (state === "仅向量表") await ctx.db.dropTable("metadata")
      }
      const reuse = state === "完整兼容库"
      const current = reuse ? identity : profile()
      const store = ctx.open(current)
      expect(await store.initialize()).toBe(!reuse)
      expect((await ctx.db.tableNames()).sort()).toEqual(["metadata", "vector"])
      expect(await metadata(ctx.db)).toMatchObject({
        embedding_model_id: current.modelId,
        vector_size: "4096",
        embedding_dimension: "4096",
        indexing_complete: String(reuse),
        indexing_run_incomplete: "false",
      })
      expect(await store.hasIndexedData()).toBe(reuse)
      const found = await store.search(old.vector, "sample.c", 0, 5)
      expect(found.map((item) => item.id)).toEqual(reuse ? [old.id] : [])
      expect(await store.initialize()).toBe(false)
    })
  }

  for (const interrupted of [false, true]) {
    test(`4096 维模型切换${interrupted ? "中断恢复" : "正常重建"}后可写入、完成并重开检索`, async () => {
      const ctx = await fixture()
      const initial = ctx.open(profile("qwen3-embedding-8b"))
      const old = point(ctx.workspace)
      await initial.initialize()
      await initial.upsertPoints([old])
      await initial.markIndexingComplete()
      await initial.close()

      if (interrupted) {
        const switching = ctx.open()
        const drop = switching["_dropTableIfExists"].bind(switching)
        switching["_dropTableIfExists"] = async (db, name) => {
          if (name === "metadata") throw new Error("模拟两次删表之间中断")
          await drop(db, name)
        }
        await expect(switching.initialize()).rejects.toThrow("模拟两次删表之间中断")
        await switching.close()
        expect(await ctx.db.tableNames()).toEqual(["metadata"])
      }

      const current = ctx.open()
      expect(await current.initialize()).toBe(true)
      expect(await metadata(ctx.db)).toMatchObject({
        embedding_model_id: "qwen3-vl-embedding-8b",
        vector_size: "4096",
        indexing_complete: "false",
      })
      expect(await current.search(old.vector, "sample.c", 0, 5)).toEqual([])
      const replacement = point(ctx.workspace, "sample.c", 2)
      await current.upsertPoints([replacement])
      await current.markIndexingComplete()
      await current.close()

      const reopened = ctx.open()
      await reopened.openExisting()
      expect((await reopened.search(replacement.vector, "sample.c", 0, 5))[0]?.id).toBe(replacement.id)
    })
  }

  test("候选库重建后立即持久化空样本，连续重启不再校验已删除文件", async () => {
    const ctx = await fixture()
    const runtime = new EmbeddingRuntimeStore(ctx.root, ctx.workspace)
    const open = () => {
      const store = new SafeLanceDBVectorStore(ctx.workspace, ctx.root, profile(), runtime)
      stores.push(store)
      return store
    }
    const initial = open()
    await initial.initialize()
    const old = point(ctx.workspace, "deleted.c")
    await initial.upsertPoints([old])
    await initial.finalizeFileGenerations([{ filePath: "deleted.c", generation: "索引代", runId: "索引轮次" }])
    await initial.close()
    const directory = compactSafeGenerationRoot(ctx.workspace, ctx.root)
    const pointer = path.join(directory, "candidate.json")
    const candidate = JSON.parse(await readFile(pointer, "utf8"))
    expect(candidate.samples).toHaveLength(1)
    const db = await connect(path.join(directory, candidate.generation))
    connections.push(db)
    // 保留向量表以独立复现样本恢复缺陷，不依赖仅元数据表缺陷的修复。
    await db.dropTable("metadata")

    const rebuilt = open()
    expect(await rebuilt.initialize()).toBe(true)
    expect(JSON.parse(await readFile(pointer, "utf8")).samples).toHaveLength(0)
    await rebuilt.close()

    const resumed = open()
    expect(await resumed.initialize()).toBe(false)
    const current = point(ctx.workspace, "current.c", 2)
    await resumed.upsertPoints([current])
    await resumed.finalizeFileGenerations([{ filePath: "current.c", generation: "索引代", runId: "索引轮次" }])
    await resumed.markIndexingComplete()
    await resumed.close()

    const reopened = open()
    await reopened.openExisting()
    expect((await reopened.search(current.vector, "current.c", 0, 5))[0]?.id).toBe(current.id)
    expect(await reopened.search(old.vector, "deleted.c", 0, 5)).toEqual([])
  })

  test("真实文档入口在库恢复后重新嵌入未变化文件并完成索引", async () => {
    const ctx = await fixture()
    await writeFile(path.join(ctx.workspace, "notes.txt"), "模型切换后的索引恢复需要重新生成文档向量。")
    let embedded = 0
    const embedder: IEmbedder = {
      embedderInfo: { name: "openai-compatible" },
      validateConfiguration: async () => ({ valid: true }),
      createEmbeddings: async (texts) => {
        embedded += texts.length
        return { embeddings: texts.map(() => vector()) }
      },
    }
    const config = new CodeIndexConfigManager({
      enabled: true,
      embedderProvider: "openai-compatible",
      modelId: profile().modelId,
      modelDimension: 4096,
      documents: { enabled: true },
    })
    const start = async () => {
      const service = new DocumentIndexService(
        ctx.workspace,
        path.join(ctx.root, "cache"),
        config,
        embedder,
        ctx.open(),
        ignore(),
        undefined,
        undefined,
        { autoRefresh: false },
      )
      services.push(service)
      await service.start("manual")
      expect(service.getStatus()).toMatchObject({ state: "Complete", processedFiles: 1, errorCount: 0 })
      await service.dispose()
    }
    await start()
    expect(embedded).toBe(1)
    await start()
    expect(embedded).toBe(1)
    await ctx.db.dropTable("vector")
    await start()
    expect(embedded).toBe(2)
    const reopened = ctx.open()
    await reopened.openExisting()
    expect((await reopened.search(vector(), "notes.txt", 0, 5))[0]?.payload.codeChunk).toContain("索引恢复")
  })
})
