import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { LanceDBVectorStore } from "../../../../src/indexing/vector-store/lancedb-vector-store"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("LanceDB 原生批量 generation finalize 隔离用例", () => {
  test("使用当前原生运行库激活新 generation 并清理旧数据", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-lancedb-finalize-"))
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
})
