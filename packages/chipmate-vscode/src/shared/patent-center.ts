export const PATENT_RADAR_SERVER_KEY = "patentRadar.serverBaseUrl"

export type PatentCenterAction = "scan" | "scanModule" | "manageModules" | "open" | "research" | "export" | "importReviews"

export type PatentCenterSettings = {
  enabled: boolean
  serverBaseUrl: string
  scheduleDays: number
  analysisModel: PatentCenterModelSelection | null
  uploadFullSnapshot: boolean
}

export type PatentCenterModelSelection = {
  providerID: string
  modelID: string
}

export type PatentCenterCorpusState = "EMPTY" | "BUILDING" | "READY" | "DEGRADED"

export type PatentCenterTestResult = {
  status: "success" | "warning" | "error"
  code:
    | "ok"
    | "not-ready"
    | "invalid-url"
    | "timeout"
    | "network"
    | "http"
    | "invalid-json"
    | "identity"
    | "unhealthy"
  baseUrl?: string
  statusCode?: number
  message?: string
  corpus?: {
    state: PatentCenterCorpusState
    generation: string | null
    publishedAt: string | null
    documents: number
    readyJurisdictions: number
    totalJurisdictions: number
    vectorCoverage: number
    quarantinedBatches: number
    warnings: string[]
  }
}

export class PatentServerUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PatentServerUrlError"
  }
}

export function normalizePatentServerBaseUrl(value: string): string {
  const raw = value.trim()
  if (!raw) throw new PatentServerUrlError("Patent Server 地址不能为空。")
  let url: URL
  try {
    url = new URL(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new PatentServerUrlError(`Patent Server 地址无效：${message}`)
  }
  if (url.username || url.password) throw new PatentServerUrlError("Patent Server 地址不能包含账号或密码。")
  if (!url.hostname) throw new PatentServerUrlError("Patent Server 地址缺少主机名。")
  if (url.pathname !== "/") throw new PatentServerUrlError("Patent Server 地址不能包含 API 路径。")
  if (url.search) throw new PatentServerUrlError("Patent Server 地址不能包含查询参数。")
  if (url.hash) throw new PatentServerUrlError("Patent Server 地址不能包含片段。")
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PatentServerUrlError("Patent Server 地址只允许使用 HTTP 或 HTTPS。")
  }
  return url.toString().replace(/\/$/u, "")
}

export function validPatentRadarSetting(leaf: string, value: unknown): boolean {
  if (leaf === "enabled" || leaf === "uploadFullSnapshot") return typeof value === "boolean"
  if (leaf === "scheduleDays") return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 365
  if (leaf === "serverBaseUrl") {
    if (typeof value !== "string") return false
    if (!value.trim()) return true
    try {
      normalizePatentServerBaseUrl(value)
      return true
    } catch {
      return false
    }
  }
  if (leaf === "analysisModel") return value === null || validModelSelection(value)
  return false
}

function validModelSelection(value: unknown): value is PatentCenterModelSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const model = value as Record<string, unknown>
  return (
    typeof model.providerID === "string" &&
    model.providerID.trim().length > 0 &&
    model.providerID.length <= 200 &&
    typeof model.modelID === "string" &&
    model.modelID.trim().length > 0 &&
    model.modelID.length <= 300 &&
    Object.keys(model).every((key) => key === "providerID" || key === "modelID")
  )
}
