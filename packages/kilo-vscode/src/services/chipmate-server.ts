import * as vscode from "vscode"
import {
  CHIPMATE_SERVER_DEFAULT,
  CHIPMATE_SERVER_KEY,
  ChipmateServerUrlError,
  deriveChipmateServerEndpoints,
  extractChipmateServerOrigin,
  normalizeChipmateServerBaseUrl,
  type ChipmateServerState,
  type ChipmateServerTestResult,
} from "../shared/chipmate-server"

const LEGACY = [
  { section: "kilo.marketplace", key: "baseUrl", suffix: "/marketplace" },
  { section: "kilo.documents", key: "wordRender.remoteEndpoint", suffix: "/render/word" },
  { section: "kilo.documents", key: "mermaidRender.remoteEndpoint", suffix: "/render/mermaid" },
] as const

const REQUIRED = ["chromium", "mermaid", "soffice", "pdftoppm", "pdfinfo"] as const

export function resolveChipmateServer(): ChipmateServerState {
  const config = vscode.workspace.getConfiguration("kilo-code.new.chipmateServer")
  const saved = config.inspect<string>("baseUrl")?.globalValue
  if (saved !== undefined) {
    try {
      return { baseUrl: normalizeChipmateServerBaseUrl(saved), source: "saved" }
    } catch (err) {
      return {
        baseUrl: saved,
        source: "invalid",
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  const values = LEGACY.flatMap((item) => {
    const value = vscode.workspace.getConfiguration(item.section).inspect<string>(item.key)?.globalValue
    if (value === undefined) return []
    const origin = extractChipmateServerOrigin(value, item.suffix)
    return [{ value, origin }]
  })
  if (values.length === 0) return { baseUrl: CHIPMATE_SERVER_DEFAULT, source: "default" }
  const origins = new Set(values.flatMap((item) => (item.origin ? [item.origin] : [])))
  if (origins.size === 1 && values.every((item) => item.origin !== undefined)) {
    return { baseUrl: [...origins][0]!, source: "legacy" }
  }
  return {
    baseUrl: CHIPMATE_SERVER_DEFAULT,
    source: "conflict",
    warning:
      "Legacy remote service settings do not share one server address. Save a unified address to switch them together.",
  }
}

export async function migrateChipmateServer(): Promise<ChipmateServerState> {
  const state = resolveChipmateServer()
  if (state.source !== "legacy") return state
  await vscode.workspace
    .getConfiguration("kilo-code.new.chipmateServer")
    .update("baseUrl", state.baseUrl, vscode.ConfigurationTarget.Global)
  return { ...state, source: "migrated" }
}

export async function promptChipmateServerReload() {
  const reload = "Reload Window"
  const action = await vscode.window.showInformationMessage(
    "ChipMate Server saved. Reload the window to apply all remote services.",
    reload,
  )
  if (action === reload) await vscode.commands.executeCommand("workbench.action.reloadWindow")
}

export function chipmateServerEndpoints() {
  const state = resolveChipmateServer()
  if (state.source === "conflict" || state.source === "invalid") return { state }
  return { state, endpoints: deriveChipmateServerEndpoints(state.baseUrl) }
}

export function legacyChipmateServerEndpoints() {
  const market = vscode.workspace.getConfiguration("kilo.marketplace").get<string>("baseUrl", "").trim()
  const docs = vscode.workspace.getConfiguration("kilo.documents")
  const word = docs.get<string>("wordRender.remoteEndpoint", "").trim()
  const mermaid = docs.get<string>("mermaidRender.remoteEndpoint", "").trim()
  return { market, word, mermaid }
}

export async function testChipmateServer(value: string, timeout = 5000): Promise<ChipmateServerTestResult> {
  const base = safe(value)
  if (!base.ok) return { status: "error", code: "invalid-url", message: base.message }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const response = await fetch(`${base.value}/health`, { method: "GET", signal: controller.signal }).catch(
    (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
  )
  clearTimeout(timer)
  if (response instanceof Error) {
    const timeoutError = response.name === "AbortError" || /aborted|timeout/i.test(response.message)
    return {
      status: "error",
      code: timeoutError ? "timeout" : "network",
      baseUrl: base.value,
      message: response.message,
    }
  }
  if (!response.ok) {
    return { status: "error", code: "http", baseUrl: base.value, statusCode: response.status }
  }
  const body = await response.json().catch((err) => err)
  if (body instanceof Error || !record(body)) {
    return {
      status: "error",
      code: "invalid-json",
      baseUrl: base.value,
      message: body instanceof Error ? body.message : undefined,
    }
  }
  if (body.service !== "chipmate-word-render") {
    return { status: "error", code: "identity", baseUrl: base.value }
  }
  if (body.ok !== true) return { status: "error", code: "unhealthy", baseUrl: base.value }
  const tools = record(body.tools) ? body.tools : {}
  const missing = REQUIRED.filter((name) => typeof tools[name] !== "string" || !tools[name])
  const capabilities = record(body.capabilities) ? body.capabilities : {}
  const market = record(capabilities.skillMarket) ? capabilities.skillMarket : {}
  const warnings = Array.isArray(market.warnings)
    ? market.warnings.filter((item): item is string => typeof item === "string")
    : []
  const exists = market.catalogExists === true
  const skills = typeof market.skillsCount === "number" ? market.skillsCount : undefined
  if (missing.length > 0 || !exists || warnings.length > 0) {
    return {
      status: "warning",
      code: "degraded",
      baseUrl: base.value,
      missing,
      skillsCount: skills,
      warnings,
    }
  }
  return { status: "success", code: "ok", baseUrl: base.value, skillsCount: skills, warnings }
}

function safe(value: string): { ok: true; value: string } | { ok: false; message: string } {
  try {
    return { ok: true, value: normalizeChipmateServerBaseUrl(value) }
  } catch (err) {
    if (err instanceof ChipmateServerUrlError) return { ok: false, message: err.message }
    throw err
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export { CHIPMATE_SERVER_KEY }
