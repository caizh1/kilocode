export const CHIPMATE_SERVER_DEFAULT = "http://127.0.0.1:6001"
export const CHIPMATE_SERVER_KEY = "chipmateServer.baseUrl"

export function isCurrentChipmateServerTest(request: string | undefined, response: string) {
  return request !== undefined && request === response
}

export type ChipmateServerEndpoints = {
  marketplace: string
  word: string
  mermaid: string
  plantuml: string
  health: string
  updates: string
  reviewRules: string
}

export type ChipmateServerSource = "saved" | "migrated" | "legacy" | "default" | "conflict" | "invalid"

export type ChipmateServerState = {
  baseUrl: string
  source: ChipmateServerSource
  warning?: string
  error?: string
}

export type ChipmateServerTestStatus = "success" | "warning" | "error"

export type ChipmateServerTestResult = {
  status: ChipmateServerTestStatus
  code: "ok" | "degraded" | "invalid-url" | "timeout" | "network" | "http" | "invalid-json" | "identity" | "unhealthy"
  baseUrl?: string
  statusCode?: number
  missing?: string[]
  skillsCount?: number
  warnings?: string[]
  message?: string
}

export class ChipmateServerUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ChipmateServerUrlError"
  }
}

export function normalizeChipmateServerBaseUrl(value: string): string {
  const raw = value.trim()
  if (!raw) throw new ChipmateServerUrlError("Server address is required.")
  const input = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  const url = parse(input)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ChipmateServerUrlError("Only HTTP and HTTPS server addresses are supported.")
  }
  if (url.username || url.password)
    throw new ChipmateServerUrlError("Credentials are not allowed in the server address.")
  if (!url.hostname) throw new ChipmateServerUrlError("A host is required.")
  if (!url.port) throw new ChipmateServerUrlError("An explicit port is required.")
  if (url.pathname !== "/") throw new ChipmateServerUrlError("Do not include an API path in the server address.")
  if (url.search) throw new ChipmateServerUrlError("Do not include query parameters in the server address.")
  if (url.hash) throw new ChipmateServerUrlError("Do not include a fragment in the server address.")
  return `${url.protocol}//${url.host}`
}

export function deriveChipmateServerEndpoints(value: string): ChipmateServerEndpoints {
  const base = normalizeChipmateServerBaseUrl(value)
  return {
    marketplace: `${base}/marketplace`,
    word: `${base}/render/word`,
    mermaid: `${base}/render/mermaid`,
    plantuml: `${base}/render/plantuml`,
    health: `${base}/health`,
    updates: `${base}/packages/manifest.json`,
    reviewRules: `${base}/api/v1/review-rule-packs/latest`,
  }
}

export function extractChipmateServerOrigin(value: string, suffix: string): string | undefined {
  const raw = value.trim().replace(/\/+$/, "")
  if (!raw.endsWith(suffix)) return undefined
  const base = raw.slice(0, -suffix.length)
  try {
    return normalizeChipmateServerBaseUrl(base)
  } catch (err) {
    if (err instanceof ChipmateServerUrlError) return undefined
    throw err
  }
}

function parse(value: string): URL {
  try {
    return new URL(value)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new ChipmateServerUrlError(`Invalid server address: ${message}`)
  }
}
