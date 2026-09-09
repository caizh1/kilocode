import { isIP } from "node:net"
import path from "node:path"
import { isJurisdiction, JURISDICTIONS, type Jurisdiction } from "./contracts.js"

export interface Config {
  host: string
  port: number
  databaseUrl: string
  opensearchUrl: string
  opensearchUsername?: string
  opensearchPassword?: string
  dataRoot: string
  allowedCidrs: string[]
  searchMaxConcurrency: number
  jurisdictions: Jurisdiction[]
  allowIncompleteCorpusSearch: boolean
  rerankMode: "off"
  embedding?: {
    endpoint: string
    apiKey?: string
    model: string
  }
  rerank?: {
    endpoint: string
    apiKey?: string
    model?: string
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = required(env.PATENT_DATABASE_URL, "PATENT_DATABASE_URL")
  const opensearchUrl = url(required(env.PATENT_OPENSEARCH_URL, "PATENT_OPENSEARCH_URL"), "PATENT_OPENSEARCH_URL")
  const dataRoot = path.resolve(env.PATENT_DATA_ROOT?.trim() || "/srv/chipmate-patent")
  const embeddingEndpoint = env.PATENT_EMBEDDING_ENDPOINT?.trim()
  const rerankMode = mode(env.PATENT_RERANK_MODE)
  return {
    host: env.PATENT_HOST?.trim() || "0.0.0.0",
    port: integer(env.PATENT_PORT, 6020, 1, 65_535),
    databaseUrl,
    opensearchUrl,
    ...(env.PATENT_OPENSEARCH_USERNAME?.trim() ? { opensearchUsername: env.PATENT_OPENSEARCH_USERNAME.trim() } : {}),
    ...(env.PATENT_OPENSEARCH_PASSWORD?.trim() ? { opensearchPassword: env.PATENT_OPENSEARCH_PASSWORD.trim() } : {}),
    dataRoot,
    allowedCidrs: cidrs(env.PATENT_ALLOWED_CIDRS),
    searchMaxConcurrency: integer(env.PATENT_SEARCH_MAX_CONCURRENCY, 8, 1, 128),
    jurisdictions: jurisdictions(env.PATENT_JURISDICTIONS),
    allowIncompleteCorpusSearch: flag(env.PATENT_ALLOW_INCOMPLETE_CORPUS_SEARCH),
    rerankMode,
    ...(embeddingEndpoint
      ? {
          embedding: {
            endpoint: url(embeddingEndpoint, "PATENT_EMBEDDING_ENDPOINT"),
            ...(env.PATENT_EMBEDDING_API_KEY?.trim() ? { apiKey: env.PATENT_EMBEDDING_API_KEY.trim() } : {}),
            model: env.PATENT_EMBEDDING_MODEL?.trim() || "qwen3-embedding-8b",
          },
        }
      : {}),
  }
}

function mode(value: string | undefined): Config["rerankMode"] {
  const normalized = value?.trim().toLowerCase() || "off"
  if (normalized !== "off") throw new Error("当前版本 PATENT_RERANK_MODE 只允许 off")
  return "off"
}

function jurisdictions(value: string | undefined): Jurisdiction[] {
  const entries = (value || JURISDICTIONS.join(","))
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
  if (!entries.length || entries.some((entry) => !isJurisdiction(entry))) {
    throw new Error(`PATENT_JURISDICTIONS 只允许：${JURISDICTIONS.join(",")}`)
  }
  return [...new Set(entries)] as Jurisdiction[]
}

function flag(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() || "")
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`缺少必需环境变量 ${name}`)
  return trimmed
}

function url(value: string, name: string): string {
  const parsed = new URL(value)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`${name} 只允许 HTTP 或 HTTPS`)
  parsed.pathname = parsed.pathname.replace(/\/+$/, "")
  parsed.search = ""
  parsed.hash = ""
  return parsed.toString().replace(/\/$/, "")
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`整数配置 ${value} 不在 ${minimum}-${maximum} 范围内`)
  }
  return parsed
}

function cidrs(value: string | undefined): string[] {
  const entries = (value || "127.0.0.1/32,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  for (const entry of entries) {
    const [address, prefix] = entry.split("/")
    const family = isIP(address || "")
    const bits = Number(prefix)
    if (!family || !Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128)) {
      throw new Error(`无效的 PATENT_ALLOWED_CIDRS 条目：${entry}`)
    }
  }
  return entries
}
