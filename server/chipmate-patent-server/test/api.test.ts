import assert from "node:assert/strict"
import test from "node:test"
import type { Config } from "../src/config.js"
import { buildApi } from "../src/api.js"
import type { PatentDatabase } from "../src/database.js"
import type { OpenSearchStore } from "../src/opensearch.js"

const config: Config = {
  host: "127.0.0.1",
  port: 6020,
  databaseUrl: "postgresql://unused",
  opensearchUrl: "http://unused",
  dataRoot: "/tmp/unused",
  allowedCidrs: ["127.0.0.1/32"],
  searchMaxConcurrency: 1,
  jurisdictions: ["CN", "JP", "KR", "US", "EP", "RU"],
  allowIncompleteCorpusSearch: false,
  rerankMode: "off",
}

const database = {
  health: async () => true,
  status: async () => ({ state: "EMPTY" }),
} as unknown as PatentDatabase

const search = { health: async () => true } as unknown as OpenSearchStore

test("公共 API 只暴露匿名只读能力且没有管理路由", async () => {
  const app = buildApi(config, database, search)
  try {
    const capabilities = await app.inject({ method: "GET", url: "/api/v1/capabilities" })
    assert.equal(capabilities.statusCode, 200)
    assert.equal(capabilities.json().anonymousReadOnly, true)
    assert.equal(capabilities.json().features.remoteAdministration, false)
    const admin = await app.inject({ method: "POST", url: "/api/v1/admin/import", payload: {} })
    assert.equal(admin.statusCode, 404)
  } finally {
    await app.close()
  }
})

test("不在允许网段的地址在读取能力接口前即被拒绝", async () => {
  const app = buildApi(config, database, search)
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/capabilities", remoteAddress: "203.0.113.8" })
    assert.equal(response.statusCode, 403)
  } finally {
    await app.close()
  }
})

test("中国试运行模式允许 DEGRADED 语料检索但限制到已配置地区", async () => {
  const pilot: Config = { ...config, jurisdictions: ["CN"], allowIncompleteCorpusSearch: true }
  const watermark = {
    requiredJurisdictions: ["CN"],
    generation: "pilot-generation",
    indexName: "pilot-index",
    state: "DEGRADED",
    publishedAt: "2026-08-31T00:00:00.000Z",
    jurisdictions: [],
    vectorCoverage: 0,
    warnings: ["试运行语料不完整"],
  }
  const requests: unknown[] = []
  const pilotDatabase = {
    health: async () => true,
    watermark: async () => watermark,
  } as unknown as PatentDatabase
  const pilotSearch = {
    health: async () => true,
    search: async (request: unknown) => {
      requests.push(request)
      return { hits: [], watermark, searchedAt: "2026-08-31T00:00:00.000Z", warnings: [] }
    },
  } as unknown as OpenSearchStore
  const app = buildApi(pilot, pilotDatabase, pilotSearch)
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/search", payload: { queries: ["拉弧检测"] } })
    assert.equal(response.statusCode, 200)
    assert.deepEqual((requests[0] as { jurisdictions: string[] }).jurisdictions, ["CN"])
    const unavailable = await app.inject({
      method: "POST",
      url: "/api/v1/search",
      payload: { queries: ["拉弧检测"], jurisdictions: ["US"] },
    })
    assert.equal(unavailable.statusCode, 400)
    assert.equal(requests.length, 1)
  } finally {
    await app.close()
  }
})
