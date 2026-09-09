import { BlockList, isIP } from "node:net"
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify"
import type { Config } from "./config.js"
import { JURISDICTIONS, type Jurisdiction, type PatentSearchRequest } from "./contracts.js"
import type { PatentDatabase } from "./database.js"
import type { OpenSearchStore } from "./opensearch.js"

export function buildApi(config: Config, database: PatentDatabase, search: OpenSearchStore) {
  const app = Fastify({ logger: false, bodyLimit: 512 * 1024, trustProxy: false })
  const access = blockList(config.allowedCidrs)
  const concurrency = semaphore(config.searchMaxConcurrency)

  app.addHook("onRequest", async (request, reply) => {
    if (!allowed(access, request.ip))
      return problem(reply, 403, "NETWORK_DENIED", "当前地址不在专利服务允许的公司网段内")
  })
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store")
    reply.header("x-content-type-options", "nosniff")
    reply.header("referrer-policy", "no-referrer")
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'")
    return payload
  })

  app.get("/health", async (_request, reply) => {
    const [databaseReady, opensearchReady] = await Promise.all([database.health(), search.health()])
    return reply.code(databaseReady && opensearchReady ? 200 : 503).send({
      ok: databaseReady && opensearchReady,
      service: "chipmate-patent-server",
      database: databaseReady ? "ready" : "degraded",
      opensearch: opensearchReady ? "ready" : "degraded",
    })
  })

  app.get("/api/v1/capabilities", async () => ({
    service: "chipmate-patent-server",
    apiVersion: "1.0.0",
    anonymousReadOnly: true,
    jurisdictions: config.jurisdictions,
    features: {
      fieldedSearch: true,
      vectorSearch: Boolean(config.embedding),
      rerank: false,
      rerankMode: config.rerankMode,
      familyCollapse: true,
      legalStatus: true,
      remoteAdministration: false,
      requestPersistence: false,
      incompleteCorpusSearch: config.allowIncompleteCorpusSearch,
    },
  }))

  app.get("/api/v1/corpus/status", async () => database.status(await search.health()))

  app.post("/api/v1/search", async (request, reply) => {
    const body = searchRequest(request.body)
    if (!body.ok) return problem(reply, 400, "INVALID_SEARCH", body.message)
    const release = concurrency.acquire()
    if (!release) return problem(reply, 429, "SEARCH_BUSY", "当前检索任务已达到并发上限，请稍后重试")
    try {
      const healthy = await search.health()
      const watermark = await database.watermark(healthy)
      if (watermark.state !== "READY" && !config.allowIncompleteCorpusSearch) {
        return problem(reply, 503, "CORPUS_NOT_READY", "专利语料当前不可用于可靠检索")
      }
      const requested = body.value.jurisdictions ?? config.jurisdictions
      if (requested.some((jurisdiction) => !config.jurisdictions.includes(jurisdiction))) {
        return problem(reply, 400, "UNAVAILABLE_JURISDICTION", "请求包含当前服务未配置的专利地区")
      }
      return await search.search({ ...body.value, jurisdictions: requested }, watermark)
    } finally {
      release()
    }
  })

  app.post("/api/v1/documents/batch", async (request, reply) => {
    const value = request.body as { publicationNumbers?: unknown }
    const numbers = Array.isArray(value?.publicationNumbers)
      ? value.publicationNumbers.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
    if (!numbers.length || numbers.length > 100) {
      return problem(reply, 400, "INVALID_DOCUMENT_BATCH", "publicationNumbers 必须包含 1-100 个公开号")
    }
    return { documents: await database.getDocuments([...new Set(numbers.map((item) => item.trim().toUpperCase()))]) }
  })

  app.get("/api/v1/documents/:publicationNumber", async (request, reply) => {
    const publicationNumber = (request.params as { publicationNumber: string }).publicationNumber.trim().toUpperCase()
    const document = await database.getDocument(publicationNumber)
    if (!document) return problem(reply, 404, "DOCUMENT_NOT_FOUND", "未找到该公开号的当前版本")
    return { document }
  })

  app.get("/api/v1/families/:familyId", async (request, reply) => {
    const familyId = (request.params as { familyId: string }).familyId.trim()
    if (!familyId) return problem(reply, 400, "INVALID_FAMILY", "familyId 不能为空")
    const documents = await database.getFamily(familyId)
    if (!documents.length) return problem(reply, 404, "FAMILY_NOT_FOUND", "未找到该专利族")
    return { familyId, documents }
  })

  app.setErrorHandler((error, _request, reply) => {
    console.error(`[Patent Server] 请求失败：${error instanceof Error ? error.message : String(error)}`)
    return problem(reply, 500, "SERVER_ERROR", "专利服务处理请求失败")
  })
  app.setNotFoundHandler((_request, reply) => problem(reply, 404, "NOT_FOUND", "接口不存在"))
  return app
}

function searchRequest(value: unknown): { ok: true; value: PatentSearchRequest } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "请求体必须是对象" }
  const item = value as Record<string, unknown>
  const queries = Array.isArray(item.queries)
    ? item.queries
        .filter((query): query is string => typeof query === "string")
        .map((query) => query.trim())
        .filter(Boolean)
    : []
  if (!queries.length || queries.length > 32 || queries.some((query) => query.length > 2_000)) {
    return { ok: false, message: "queries 必须包含 1-32 个非空技术特征，单项不超过 2000 字符" }
  }
  const jurisdictions = array(item.jurisdictions)
  if (jurisdictions.some((entry) => !(JURISDICTIONS as readonly string[]).includes(entry))) {
    return { ok: false, message: "jurisdictions 包含不支持的地区" }
  }
  const request: PatentSearchRequest = { queries }
  if (jurisdictions.length) request.jurisdictions = jurisdictions as Jurisdiction[]
  const languages = array(item.languages)
  if (languages.length) request.languages = languages
  const classifications = array(item.classifications)
  if (classifications.length) request.classifications = classifications
  if (item.cutoffDate !== undefined) {
    if (typeof item.cutoffDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.cutoffDate)) {
      return { ok: false, message: "cutoffDate 必须是 YYYY-MM-DD" }
    }
    request.cutoffDate = item.cutoffDate
  }
  if (item.familyCollapse !== undefined) request.familyCollapse = item.familyCollapse !== false
  if (item.limit !== undefined) {
    if (!Number.isSafeInteger(item.limit) || Number(item.limit) < 1 || Number(item.limit) > 100) {
      return { ok: false, message: "limit 必须是 1-100 的整数" }
    }
    request.limit = Number(item.limit)
  }
  return { ok: true, value: request }
}

function array(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []
}

function blockList(cidrs: string[]): BlockList {
  const list = new BlockList()
  for (const entry of cidrs) {
    const [address, prefix] = entry.split("/") as [string, string]
    list.addSubnet(address, Number(prefix), isIP(address) === 6 ? "ipv6" : "ipv4")
  }
  return list
}

function allowed(list: BlockList, input: string): boolean {
  const address = input.startsWith("::ffff:") ? input.slice(7) : input
  const family = isIP(address)
  return family > 0 && list.check(address, family === 6 ? "ipv6" : "ipv4")
}

function semaphore(maximum: number) {
  let active = 0
  return {
    acquire(): (() => void) | null {
      if (active >= maximum) return null
      active += 1
      let released = false
      return () => {
        if (released) return
        released = true
        active -= 1
      }
    },
  }
}

function problem(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ ok: false, code, message })
}
