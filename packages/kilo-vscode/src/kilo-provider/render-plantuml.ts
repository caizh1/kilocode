import { chipmateServerEndpoints } from "../services/chipmate-server"

type Request = {
  requestId: string
  source: string
}

export type PlantUmlRenderedMessage = {
  type: "plantUmlRendered"
  requestId: string
  ok: boolean
  dataUrl?: string
  width?: number
  height?: number
  issues?: string[]
}

type Fetch = typeof fetch

const MAX_BASE64 = 24 * 1024 * 1024

export async function renderPlantUml(request: Request, post: (message: PlantUmlRenderedMessage) => void, fetcher: Fetch = fetch) {
  const resolved = chipmateServerEndpoints()
  if (!resolved.endpoints) {
    post(failed(request.requestId, resolved.state.error ?? "ChipMate Server 地址无效。"))
    return
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 65_000)
  const response = await fetcher(resolved.endpoints.plantuml, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: request.source, filename: "diagram.puml", timeoutMs: 60_000 }),
    signal: controller.signal,
  }).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
  clearTimeout(timer)
  if (response instanceof Error) {
    const timeout = response.name === "AbortError" || /aborted|timeout/i.test(response.message)
    post(failed(request.requestId, timeout ? "PlantUML 渲染超过 60 秒。" : response.message))
    return
  }
  const body = await response.json().catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
  if (body instanceof Error || !record(body)) {
    post(failed(request.requestId, body instanceof Error ? body.message : `ChipMate Server 返回了无效响应（HTTP ${response.status}）。`))
    return
  }
  const issues = strings(body.issues)
  const png = record(body.png) && typeof body.png.base64 === "string" ? body.png.base64 : undefined
  const verified = record(body.metadata) && body.metadata.verified === true
  if (!response.ok || body.ok !== true || !png || !verified) {
    post(failed(request.requestId, issues[0] ?? `PlantUML 渲染失败（HTTP ${response.status}）。`, issues))
    return
  }
  if (png.length === 0 || png.length > MAX_BASE64) {
    post(failed(request.requestId, "ChipMate Server 返回的 PlantUML PNG 超过大小限制。"))
    return
  }
  post({
    type: "plantUmlRendered",
    requestId: request.requestId,
    ok: true,
    dataUrl: `data:image/png;base64,${png}`,
    width: number(body.width),
    height: number(body.height),
    issues,
  })
}

function failed(requestId: string, issue: string, issues: string[] = []): PlantUmlRenderedMessage {
  return {
    type: "plantUmlRendered",
    requestId,
    ok: false,
    issues: issues.length > 0 ? issues : [issue],
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === "string") return item
      if (!record(item) || typeof item.message !== "string") return undefined
      return item.message
    })
    .filter((item): item is string => item !== undefined)
    .slice(0, 16)
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}
