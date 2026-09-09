import assert from "node:assert/strict"
import test from "node:test"
import { loadConfig } from "../src/config.js"

test("Embedding 自动维度配置不包含 dimensions 字段", () => {
  const config = loadConfig({
    PATENT_DATABASE_URL: "postgresql://patent:test@127.0.0.1/patent",
    PATENT_OPENSEARCH_URL: "http://127.0.0.1:9200",
    PATENT_EMBEDDING_ENDPOINT: "http://model.internal/v1/embeddings",
    PATENT_EMBEDDING_MODEL: "qwen3-embedding-8b",
  })
  assert.deepEqual(config.embedding, {
    endpoint: "http://model.internal/v1/embeddings",
    model: "qwen3-embedding-8b",
  })
  assert.equal("dimensions" in (config.embedding ?? {}), false)
  assert.deepEqual(config.jurisdictions, ["CN", "JP", "KR", "US", "EP", "RU"])
  assert.equal(config.allowIncompleteCorpusSearch, false)
})

test("中国单地区试运行配置需要显式开启不完整语料检索", () => {
  const config = loadConfig({
    PATENT_DATABASE_URL: "postgresql://patent:test@127.0.0.1/patent",
    PATENT_OPENSEARCH_URL: "http://127.0.0.1:9200",
    PATENT_JURISDICTIONS: "CN",
    PATENT_ALLOW_INCOMPLETE_CORPUS_SEARCH: "1",
  })
  assert.deepEqual(config.jurisdictions, ["CN"])
  assert.equal(config.allowIncompleteCorpusSearch, true)
})

test("默认关闭 Rerank，意外配置端点也不会创建 Rerank 客户端配置", () => {
  const config = loadConfig({
    PATENT_DATABASE_URL: "postgresql://patent:test@127.0.0.1/patent",
    PATENT_OPENSEARCH_URL: "http://127.0.0.1:9200",
    PATENT_RERANK_ENDPOINT: "http://rerank.internal/v1/rerank",
  })
  assert.equal(config.rerankMode, "off")
  assert.equal(config.rerank, undefined)
})

test("当前版本拒绝启用 Rerank", () => {
  assert.throws(
    () =>
      loadConfig({
        PATENT_DATABASE_URL: "postgresql://patent:test@127.0.0.1/patent",
        PATENT_OPENSEARCH_URL: "http://127.0.0.1:9200",
        PATENT_RERANK_MODE: "on",
      }),
    /只允许 off/,
  )
})

test("无效网段配置被拒绝", () => {
  assert.throws(
    () =>
      loadConfig({
        PATENT_DATABASE_URL: "postgresql://patent:test@127.0.0.1/patent",
        PATENT_OPENSEARCH_URL: "http://127.0.0.1:9200",
        PATENT_ALLOWED_CIDRS: "10.0.0.0/99",
      }),
    /无效/,
  )
})
