import assert from "node:assert/strict"
import test from "node:test"
import { completeRanking, RerankClient } from "../src/rerank.js"

test("Rerank 使用内网兼容请求并按返回索引校验结果", async (context) => {
  let body: Record<string, unknown> | undefined
  context.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.2 },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    )
  })
  const client = new RerankClient({ endpoint: "http://rerank.internal/v1/rerank", model: "bge-reranker" })
  const result = await client.rank("低功耗采样", ["文献一", "文献二"])
  assert.deepEqual(result, [
    { index: 1, score: 0.9 },
    { index: 0, score: 0.2 },
  ])
  assert.deepEqual(body, { model: "bge-reranker", query: "低功耗采样", documents: ["文献一", "文献二"], top_n: 2 })
})

test("Rerank 只返回部分候选时保留其余融合召回结果", () => {
  assert.deepEqual(completeRanking(4, [{ index: 2, score: 0.9 }]), [
    { index: 2, score: 0.9 },
    { index: 0, score: null },
    { index: 1, score: null },
    { index: 3, score: null },
  ])
})
