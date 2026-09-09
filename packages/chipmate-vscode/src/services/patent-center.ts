import * as vscode from "vscode"
import {
  normalizePatentServerBaseUrl,
  type PatentCenterAction,
  type PatentCenterModelSelection,
  type PatentCenterCorpusState,
  type PatentCenterSettings,
  type PatentCenterTestResult,
} from "../shared/patent-center"
import { isPatentRadarRun, type PatentRadarRun } from "../patent-radar/types"

const COMMANDS: Record<PatentCenterAction, string> = {
  scan: "chipmate.v2.patentRadar.scan",
  scanModule: "chipmate.v2.patentRadar.scanModule",
  manageModules: "chipmate.v2.patentRadar.manageModules",
  open: "chipmate.v2.patentRadar.open",
  research: "chipmate.v2.patentRadar.research",
  export: "chipmate.v2.patentRadar.export",
  importReviews: "chipmate.v2.patentRadar.importReviews",
}

export function patentCenterSettings(): PatentCenterSettings {
  const config = vscode.workspace.getConfiguration("chipmate.v2.patentRadar")
  return {
    enabled: config.get<boolean>("enabled", false),
    serverBaseUrl: config.get<string>("serverBaseUrl", ""),
    scheduleDays: config.get<number>("scheduleDays", 7),
    analysisModel: config.get<PatentCenterSettings["analysisModel"]>("analysisModel", null),
    uploadFullSnapshot: config.get<boolean>("uploadFullSnapshot", false),
  }
}

export async function runPatentCenterAction(
  action: PatentCenterAction,
  analysisModel?: PatentCenterModelSelection,
): Promise<{ run: PatentRadarRun | null; cancelled: boolean; error?: string }> {
  try {
    if ((action === "scan" || action === "scanModule") && !analysisModel)
      throw new Error("请先连接 Provider，并在“设置 > 专利中心”选择分析模型")
    const result = await vscode.commands.executeCommand(
      COMMANDS[action],
      action === "scan" || action === "scanModule" ? { analysisModel } : undefined,
    )
    return {
      run: isPatentRadarRun(result) ? result : null,
      cancelled: action === "scanModule" && result === undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void vscode.window.showErrorMessage(`Patent Radar：${message}`)
    return { run: null, cancelled: false, error: message }
  }
}

export async function testPatentServer(
  value: string,
  timeout = 5000,
  load: typeof fetch = fetch,
): Promise<PatentCenterTestResult> {
  let baseUrl: string
  try {
    baseUrl = normalizePatentServerBaseUrl(value)
  } catch (error) {
    return { status: "error", code: "invalid-url", message: error instanceof Error ? error.message : String(error) }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const health = await request(load, `${baseUrl}/health`, controller.signal)
    if (!health.ok) return failure(health, baseUrl)
    if (!record(health.body) || health.body.service !== "chipmate-patent-server") {
      return { status: "error", code: "identity", baseUrl }
    }
    if (health.body.ok !== true) return { status: "error", code: "unhealthy", baseUrl }
    const status = await request(load, `${baseUrl}/api/v1/corpus/status`, controller.signal)
    if (!status.ok) return failure(status, baseUrl)
    const corpus = parseCorpus(status.body)
    if (!corpus) return { status: "error", code: "invalid-json", baseUrl }
    return {
      status: corpus.state === "READY" ? "success" : "warning",
      code: corpus.state === "READY" ? "ok" : "not-ready",
      baseUrl,
      corpus,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const timedOut = error instanceof Error && (error.name === "AbortError" || /aborted|timeout/iu.test(message))
    return { status: "error", code: timedOut ? "timeout" : "network", baseUrl, message }
  } finally {
    clearTimeout(timer)
  }
}

async function request(load: typeof fetch, url: string, signal: AbortSignal) {
  const response = await load(url, { method: "GET", signal })
  const body = await response.json().catch(() => undefined)
  return { ok: response.ok, status: response.status, body }
}

function failure(result: { status: number; body: unknown }, baseUrl: string): PatentCenterTestResult {
  return { status: "error", code: "http", baseUrl, statusCode: result.status, message: problemMessage(result.body) }
}

function parseCorpus(value: unknown): PatentCenterTestResult["corpus"] | undefined {
  if (!record(value) || value.service !== "chipmate-patent-server") return
  if (!corpusState(value.state) || !Array.isArray(value.jurisdictions)) return
  const jurisdictions = value.jurisdictions.filter(record)
  if (jurisdictions.length !== value.jurisdictions.length) return
  const documents = jurisdictions.reduce((sum, item) => sum + number(item.documents), 0)
  const ready = jurisdictions.filter(
    (item) => number(item.documents) > 0 && item.historicalBaseline === true && typeof item.coverageThrough === "string",
  ).length
  return {
    state: value.state,
    generation: typeof value.generation === "string" ? value.generation : null,
    publishedAt: typeof value.publishedAt === "string" ? value.publishedAt : null,
    documents,
    readyJurisdictions: ready,
    totalJurisdictions: jurisdictions.length,
    vectorCoverage: number(value.vectorCoverage),
    quarantinedBatches: number(value.quarantinedBatches),
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((item): item is string => typeof item === "string").slice(0, 20)
      : [],
  }
}

function problemMessage(value: unknown): string | undefined {
  if (!record(value)) return
  return typeof value.message === "string" ? value.message : undefined
}

function corpusState(value: unknown): value is PatentCenterCorpusState {
  return value === "EMPTY" || value === "BUILDING" || value === "READY" || value === "DEGRADED"
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
