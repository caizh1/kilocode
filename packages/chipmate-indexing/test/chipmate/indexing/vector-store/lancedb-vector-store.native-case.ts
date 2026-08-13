import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { EmbeddingRuntimeStore } from "../../../../src/indexing/embedding-runtime-store"
import { LanceDBVectorStore } from "../../../../src/indexing/vector-store/lancedb-vector-store"
import { SafeLanceDBVectorStore } from "../../../../src/indexing/vector-store/safe-lancedb-vector-store"
import { compactSafeGenerationRoot } from "../../../../src/indexing/vector-store/lancedb-paths"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("LanceDB 原生批量 generation finalize 隔离用例", () => {
  test("1.0.19 的 bge-m3 直存储索引在 1.1.0 中原位复用", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-lancedb-1-0-19-upgrade-"))
    roots.push(root)
    const workspace = path.join(root, "真实升级工作区")
    const base = path.join(root, "索引", "c")
    const profile = {
      provider: "openai-compatible" as const,
      modelId: "bge-m3",
      dimension: 8,
      dimensionMode: "fixed" as const,
      requestedDimension: 8,
    }
    const vector = [1, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07]
    const point = {
      id: "10190190-1019-4019-8019-101901901019",
      vector,
      payload: {
        workspaceId: "workspace",
        normalizedRoot: workspace,
        filePath: "源码/保持不变.c",
        fileHash: "1.0.19-文件哈希",
        chunkHash: "1.0.19-分块哈希",
        chunkRange: "1:3",
        runId: "1.0.19-轮次",
        generation: "1.0.19-代",
        checkpointMetaHash: "1.0.19-检查点",
        active: true,
        codeChunk: "int unchanged_after_upgrade(void) { return 19; }",
        startLine: 1,
        endLine: 3,
        segmentHash: "1.0.19-片段哈希",
      },
    }

    const baseline = new LanceDBVectorStore(workspace, profile.dimension, base, profile)
    await baseline.initialize()
    await baseline.upsertPoints([point])
    await baseline.markIndexingComplete()
    const collection = baseline.getCollectionName()
    await baseline.close()

    const upgraded = new LanceDBVectorStore(workspace, profile.dimension, base, profile)
    expect(upgraded.getCollectionName()).toBe(collection)
    expect(await upgraded.initialize()).toBe(false)
    expect(upgraded.getLastCompatibilityDecision()).toMatchObject({
      action: "reuse",
      reason: "compatible",
      created: false,
    })
    expect((await upgraded.search(vector, "源码", 0, 5))[0]?.id).toBe(point.id)
    expect(await Bun.file(path.join(compactSafeGenerationRoot(workspace, base), "active.json")).exists()).toBe(false)
    expect(await Bun.file(path.join(compactSafeGenerationRoot(workspace, base), "candidate.json")).exists()).toBe(false)
    await upgraded.close()
  }, 30_000)

  test("使用当前原生运行库激活新 generation 并清理旧数据", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-lancedb-finalize-"))
    roots.push(root)
    const workspace = path.join(root, "工作区")
    const store = new LanceDBVectorStore(workspace, 8, path.join(root, "向量库"))
    const filePath = "目录/O'Reilly one.c"
    const vector = [1, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07]

    try {
      await store.initialize()
      await store.upsertPoints([
        {
          id: "11111111-1111-4111-8111-111111111111",
          vector,
          payload: {
            workspaceId: "workspace",
            normalizedRoot: workspace,
            filePath,
            fileHash: "旧哈希",
            chunkHash: "旧分块",
            chunkRange: "1:4",
            runId: "旧轮次",
            generation: "旧代",
            checkpointMetaHash: "checkpoint",
            active: true,
            codeChunk: "旧代码",
            startLine: 1,
            endLine: 4,
            segmentHash: "旧片段",
          },
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          vector,
          payload: {
            workspaceId: "workspace",
            normalizedRoot: workspace,
            filePath,
            fileHash: "新哈希",
            chunkHash: "新分块",
            chunkRange: "1:6",
            runId: "新轮次",
            generation: "新代",
            checkpointMetaHash: "checkpoint",
            active: false,
            codeChunk: "新代码",
            startLine: 1,
            endLine: 6,
            segmentHash: "新片段",
          },
        },
      ])

      await store.finalizeFileGenerations([{ filePath, generation: "新代", runId: "新轮次" }])

      const results = await store.search(vector, "目录", 0, 10)
      expect(results.map((result) => result.id)).toEqual(["22222222-2222-4222-8222-222222222222"])
      expect(results[0]?.payload.active).toBe(true)
      expect(results[0]?.payload.codeChunk).toBe("新代码")
    } finally {
      await store.close()
    }
  }, 30_000)

  test("清空候选代后保留完整向量身份并支持中断恢复和跨进程重开", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-lancedb-rebuild-resume-"))
    roots.push(root)
    const workspace = path.join(root, "工作区")
    const directory = path.join(root, "向量库")
    const profile = {
      provider: "openai-compatible" as const,
      modelId: "qwen3-embedding-8b",
      dimension: 8,
      dimensionMode: "fixed" as const,
      requestedDimension: 8,
      endpointDigest: "端点摘要",
      fingerprintDigest: "指纹摘要",
      qualityVersion: "qwen3-dense-v1",
      instructionVersion: "qwen3-retrieval-v1",
    }
    const vector = [1, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07]
    const partial = {
      id: "33333333-3333-4333-8333-333333333333",
      vector,
      payload: {
        workspaceId: "workspace",
        normalizedRoot: workspace,
        filePath: "文档/中断恢复.txt",
        fileHash: "文件哈希",
        chunkHash: "分块哈希",
        chunkRange: "1:2",
        runId: "恢复轮次",
        generation: "恢复代",
        checkpointMetaHash: "检查点",
        active: true,
        codeChunk: "中断前已写入的文档分块",
        startLine: 1,
        endLine: 2,
        segmentHash: "片段哈希",
      },
    }

    const first = new LanceDBVectorStore(workspace, profile.dimension, directory, profile)
    await first.initialize()
    await first.clearCollection()
    await first.markIndexingIncomplete()
    await first.upsertPoints([partial])
    await first.close()

    const resumed = new LanceDBVectorStore(workspace, profile.dimension, directory, profile)
    expect(await resumed.initialize()).toBe(false)
    expect(resumed.getLastCompatibilityDecision()).toMatchObject({ action: "reuse", created: false })
    await resumed.markIndexingComplete()
    await resumed.close()

    const reopened = new LanceDBVectorStore(workspace, profile.dimension, directory, profile)
    await expect(reopened.openExisting()).resolves.toBeUndefined()
    expect((await reopened.search(vector, "文档", 0, 5))[0]?.payload.codeChunk).toBe("中断前已写入的文档分块")
    await reopened.close()
  }, 30_000)

  test("正常进程退出后保留候选代并由下一进程安全接管", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-lancedb-worker-handoff-"))
    roots.push(root)
    const workspace = path.join(root, "工作区")
    const base = path.join(root, "向量库")
    const vector = [1, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07]
    const profile = {
      provider: "openai-compatible" as const,
      modelId: "qwen3-embedding-8b",
      dimension: 8,
      dimensionMode: "fixed" as const,
      requestedDimension: 8,
      endpointDigest: "端点摘要",
      fingerprint: [vector],
      fingerprintDigest: "指纹摘要",
      qualityVersion: "qwen3-dense-v1",
      instructionVersion: "qwen3-retrieval-v1",
    }
    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const point = {
      id: "44444444-4444-4444-8444-444444444444",
      vector,
      payload: {
        workspaceId: "workspace",
        normalizedRoot: workspace,
        filePath: "源码/升级交接.c",
        fileHash: "文件哈希",
        chunkHash: "分块哈希",
        chunkRange: "1:3",
        runId: "升级轮次",
        generation: "升级代",
        checkpointMetaHash: "检查点",
        active: false,
        codeChunk: "int upgrade_handoff(void) { return 16; }",
        startLine: 1,
        endLine: 3,
        segmentHash: "片段哈希",
      },
    }

    const first = new SafeLanceDBVectorStore(workspace, base, profile, runtime)
    expect(await first.initialize()).toBe(true)
    await first.markIndexingIncomplete()
    await first.upsertPoints([point])
    await first.finalizeFileGenerations([
      { filePath: point.payload.filePath, generation: point.payload.generation, runId: point.payload.runId },
    ])
    await first.close()

    const resumed = new SafeLanceDBVectorStore(workspace, base, profile, runtime)
    expect(await resumed.initialize()).toBe(false)
    expect(resumed.getLastCompatibilityDecision()).toMatchObject({
      action: "rebuild",
      reason: "resumed incomplete candidate",
      created: false,
    })
    await resumed.markIndexingComplete()
    expect((await resumed.search(vector, "源码", 0, 5))[0]?.id).toBe(point.id)
    await resumed.close()
  }, 30_000)

  test("旧版已激活索引只读保留并重建到紧凑路径", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-lancedb-legacy-active-migration-"))
    roots.push(root)
    const workspace = path.join(root, "具有较长名称的真实升级工作区")
    const base = path.join(root, "向量库")
    const compactRoot = compactSafeGenerationRoot(workspace, base)
    const hash = createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 24)
    const generationRoot = path.join(base, "safe-generations", hash)
    const legacyGeneration = `${Date.now()}-${globalThis.crypto.randomUUID()}`
    const legacyDirectory = path.join(generationRoot, legacyGeneration)
    const vector = [1, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07]
    const profile = {
      provider: "openai-compatible" as const,
      modelId: "qwen3-embedding-8b",
      dimension: 8,
      dimensionMode: "fixed" as const,
      requestedDimension: 8,
      endpointDigest: "端点摘要",
      fingerprint: [vector],
      fingerprintDigest: "旧版迁移指纹摘要",
      qualityVersion: "qwen3-dense-v1",
      instructionVersion: "qwen3-retrieval-v1",
    }
    const existing = {
      id: "55555555-5555-4555-8555-555555555555",
      vector,
      payload: {
        workspaceId: "workspace",
        normalizedRoot: workspace,
        filePath: "源码/旧版有效索引.c",
        fileHash: "旧文件哈希",
        chunkHash: "旧分块哈希",
        chunkRange: "1:3",
        runId: "旧轮次",
        generation: "旧代",
        checkpointMetaHash: "旧检查点",
        active: false,
        codeChunk: "int legacy_active(void) { return 15; }",
        startLine: 1,
        endLine: 3,
        segmentHash: "旧片段哈希",
      },
    }
    const legacyName = `${path.basename(workspace)}-${createHash("sha256").update(workspace).digest("hex").slice(0, 16)}`
    const legacy = new LanceDBVectorStore(workspace, profile.dimension, legacyDirectory, profile, legacyName)
    await legacy.initialize()
    await legacy.markIndexingIncomplete()
    await legacy.upsertPoints([existing])
    await legacy.finalizeFileGenerations?.([
      { filePath: existing.payload.filePath, generation: existing.payload.generation, runId: existing.payload.runId },
    ])
    await legacy.markIndexingComplete()
    await legacy.close()
    await mkdir(generationRoot, { recursive: true })
    await writeFile(
      path.join(generationRoot, "active.json"),
      JSON.stringify({
        schema: 1,
        generation: legacyGeneration,
        promotedAt: new Date().toISOString(),
        profile,
      }),
    )

    const runtime = new EmbeddingRuntimeStore(root, workspace)
    const store = new SafeLanceDBVectorStore(workspace, base, profile, runtime)
    expect(await store.initialize()).toBe(true)
    expect(store.getLastCompatibilityDecision()).toMatchObject({
      action: "rebuild",
      reason: "legacy active generation requires compact-path migration",
      created: true,
    })
    expect((await store.search(vector, "源码/旧版有效索引.c", 0, 5))[0]?.id).toBe(existing.id)

    const replacement = {
      ...existing,
      id: "66666666-6666-4666-8666-666666666666",
      payload: {
        ...existing.payload,
        filePath: "源码/新版紧凑索引.c",
        fileHash: "新文件哈希",
        chunkHash: "新分块哈希",
        runId: "新轮次",
        generation: "新代",
        codeChunk: "int compact_active(void) { return 16; }",
        segmentHash: "新片段哈希",
      },
    }
    await store.markIndexingIncomplete()
    await store.upsertPoints([replacement])
    await store.finalizeFileGenerations?.([
      {
        filePath: replacement.payload.filePath,
        generation: replacement.payload.generation,
        runId: replacement.payload.runId,
      },
    ])
    await store.markIndexingComplete()
    expect((await store.search(vector, "源码/新版紧凑索引.c", 0, 5))[0]?.id).toBe(replacement.id)

    const active = JSON.parse(await readFile(path.join(compactRoot, "active.json"), "utf8")) as {
      generation: string
    }
    expect(active.generation).toMatch(/^[A-Za-z0-9_-]{8}$/)
    expect((await stat(path.join(compactRoot, active.generation, "vector.lance"))).isDirectory()).toBe(true)
    expect(
      await stat(generationRoot)
        .then(() => true)
        .catch(() => false),
    ).toBe(false)
    await store.close()
  }, 30_000)
})
