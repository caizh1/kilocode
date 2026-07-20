import * as vscode from "vscode"
import {
  CHIPMATE_SERVER_DEFAULT,
  CHIPMATE_SERVER_KEY,
  ChipmateServerUrlError,
  deriveChipmateServerEndpoints,
  normalizeChipmateServerBaseUrl,
  type ChipmateServerState,
  type ChipmateServerTestResult,
} from "../shared/chipmate-server"

const REQUIRED = ["chromium", "mermaid", "soffice", "pdftoppm", "pdfinfo"] as const

export function resolveChipmateServer(): ChipmateServerState {
  const config = vscode.workspace.getConfiguration("chipmate.v2.chipmateServer")
  const values = config.inspect<string>("baseUrl")
  const saved = values?.globalValue
  const baseUrl = saved ?? values?.defaultValue ?? CHIPMATE_SERVER_DEFAULT
  try {
    return {
      baseUrl: normalizeChipmateServerBaseUrl(baseUrl),
      source: saved === undefined ? "default" : "saved",
    }
  } catch (err) {
    return {
      baseUrl,
      source: "invalid",
      error: err instanceof Error ? err.message : String(err),
    }
  }
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
