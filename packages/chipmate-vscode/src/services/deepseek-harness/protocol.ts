import WebSocket from "ws"
import type {
  DeepSeekHarnessBootEntry,
  DeepSeekHarnessBootManifest,
} from "../../shared/deepseek-harness"

type Envelope = {
  type?: string
  rpcId?: string
  method?: string
  payload?: unknown
  result?: { ok?: boolean; value?: unknown; error?: unknown }
}

export type DeepSeekHarnessFrame = Record<string, unknown>
export type DeepSeekHarnessChannel = "mux" | "host"
export interface DeepSeekHarnessDisconnect {
  channel: DeepSeekHarnessChannel
  kind: "error" | "close" | "stream-error"
  code?: number
  reason?: string
  error?: Error
}
export interface DeepSeekHarnessTransportResponse {
  status: number
  headers: Array<[string, string]>
  body: string
}

export class DeepSeekHarnessProtocol {
  private mux?: WebSocket
  private host?: WebSocket
  private pluginEvents?: AbortController
  private closed = false
  private disconnected = false
  private connectionToken = 0
  private pluginRetry?: NodeJS.Timeout
  private readonly requests = new Set<AbortController>()

  constructor(
    readonly baseUrl: string,
    private readonly onMux: (data: string) => void,
    private readonly onHost: (data: string) => void,
    private readonly onDisconnect: (disconnect: DeepSeekHarnessDisconnect) => void,
    private readonly onPluginEvent: (frame: DeepSeekHarnessFrame) => void = () => undefined,
    private readonly onDiagnostic: (event: Record<string, unknown>) => void = () => undefined,
  ) {}

  get connected(): boolean {
    return (
      !this.closed &&
      !this.disconnected &&
      this.mux?.readyState === WebSocket.OPEN &&
      this.host?.readyState === WebSocket.OPEN
    )
  }

  async connect(onPhase: (phase: "describing-host" | "connecting-mux" | "connecting-host") => void = () => undefined): Promise<unknown> {
    const token = ++this.connectionToken
    this.closed = false
    this.disconnected = false
    onPhase("describing-host")
    const description = await this.call("host.describe", {})
    if (this.closed || token !== this.connectionToken) throw new Error("官方 DSH 连接握手已取消")
    await this.openDownlinks(onPhase, token)
    return description
  }

  async call<T = unknown>(method: string, payload: unknown): Promise<T> {
    const rpcId = crypto.randomUUID()
    const response = await this.request(
      `/api/${method}`,
      "POST",
      JSON.stringify({ type: "client-request", rpcId, method, payload }),
    )
    if (response.status < 200 || response.status >= 300)
      throw new Error(`DSH ${method} 请求失败（HTTP ${response.status}）`)
    const envelope = JSON.parse(response.body) as Envelope
    if (envelope.type !== "server-response" || envelope.rpcId !== rpcId || !envelope.result) {
      throw new Error(`DSH ${method} 返回了无效的官方协议响应`)
    }
    if (!envelope.result.ok) throw new Error(redactError(envelope.result.error, `DSH ${method} 执行失败`))
    return envelope.result.value as T
  }

  async respond(rpcId: string, value: unknown): Promise<void> {
    await this.deliverResponse({ type: "client-response", rpcId, result: { ok: true, value } })
  }

  async reject(rpcId: string): Promise<void> {
    await this.deliverResponse({
      type: "client-response",
      rpcId,
      result: {
        ok: false,
        error: { code: "cancelled", message: "the user closed this question request", details: {} },
      },
    })
  }

  private async deliverResponse(message: unknown): Promise<void> {
    const response = await this.request("/api/respond", "POST", JSON.stringify(message))
    if (response.status < 200 || response.status >= 300)
      throw new Error(`DSH 响应请求失败（HTTP ${response.status}）`)
    const receipt = JSON.parse(response.body) as { accepted?: boolean; reason?: string }
    if (receipt.accepted !== true) throw new Error(`DSH 拒绝了响应：${receipt.reason ?? "未知原因"}`)
  }

  async request(path: string, method: "GET" | "POST", body?: string): Promise<DeepSeekHarnessTransportResponse> {
    const target = new URL(path, this.baseUrl)
    if (target.origin !== new URL(this.baseUrl).origin) throw new Error("官方 DSH Relay 拒绝跨域请求")
    const controller = new AbortController()
    this.requests.add(controller)
    try {
      const response = await fetch(target, {
        method,
        redirect: "manual",
        signal: controller.signal,
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body,
            }),
      })
      if (response.status >= 300 && response.status < 400) throw new Error("官方 DSH Relay 拒绝重定向")
      return {
        status: response.status,
        headers: [...response.headers.entries()],
        body: await response.text(),
      }
    } finally {
      this.requests.delete(controller)
    }
  }

  async bootManifest(): Promise<DeepSeekHarnessBootManifest> {
    const response = await this.request("/", "GET")
    if (response.status !== 200) throw new Error(`官方 DSH Web 启动清单请求失败（HTTP ${response.status}）`)
    const match = response.body.match(/window\.__DSH_BOOT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/u)
    if (!match?.[1]) throw new Error("官方 DSH Web 未提供启动清单")
    return parseBootManifest(JSON.parse(match[1]))
  }

  async openPluginEvents(): Promise<void> {
    if (this.closed) return
    if (this.pluginRetry) clearTimeout(this.pluginRetry)
    this.pluginEvents?.abort()
    const controller = new AbortController()
    this.pluginEvents = controller
    let response: Response
    try {
      response = await fetch(new URL("/plugins/events", this.baseUrl), {
        signal: controller.signal,
        redirect: "manual",
        headers: { accept: "text/event-stream" },
      })
      if (!response.ok || !response.body) throw new Error(`官方 DSH 插件事件流连接失败（HTTP ${response.status}）`)
    } catch (error) {
      if (!controller.signal.aborted && !this.closed) this.schedulePluginReconnect()
      throw error
    }
    void this.pumpPluginEvents(response.body, controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted)
          this.onDiagnostic({ channel: "plugins", event: "error", error: redactError(error, "未知错误") })
      })
      .finally(() => {
        if (controller.signal.aborted || this.closed || this.pluginEvents !== controller) return
        this.onDiagnostic({ channel: "plugins", event: "close" })
        this.schedulePluginReconnect()
      })
  }

  close(): void {
    this.closed = true
    this.connectionToken += 1
    for (const controller of this.requests) controller.abort()
    this.requests.clear()
    if (this.pluginRetry) clearTimeout(this.pluginRetry)
    this.pluginRetry = undefined
    this.pluginEvents?.abort()
    this.pluginEvents = undefined
    this.mux?.close()
    this.host?.close()
    this.mux = undefined
    this.host = undefined
  }

  private async pumpPluginEvents(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let pending = ""
    try {
      while (!signal.aborted) {
        const next = await reader.read()
        if (next.done) return
        pending += decoder.decode(next.value, { stream: true }).replaceAll("\r\n", "\n")
        let boundary = pending.indexOf("\n\n")
        while (boundary >= 0) {
          const block = pending.slice(0, boundary)
          pending = pending.slice(boundary + 2)
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          if (data) {
            const frame = JSON.parse(data)
            if (frame && typeof frame === "object") this.onPluginEvent(frame as DeepSeekHarnessFrame)
          }
          boundary = pending.indexOf("\n\n")
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private schedulePluginReconnect(): void {
    if (this.closed || this.pluginRetry) return
    this.pluginRetry = setTimeout(() => {
      this.pluginRetry = undefined
      void this.openPluginEvents().catch((error) =>
        this.onDiagnostic({ channel: "plugins", event: "reconnect-failed", error: redactError(error, "未知错误") }),
      )
    }, 3_000)
  }

  private async openDownlinks(
    onPhase: (phase: "connecting-mux" | "connecting-host") => void,
    token: number,
  ): Promise<void> {
    const base = new URL(this.baseUrl)
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:"
    const notify = (disconnect: DeepSeekHarnessDisconnect) => {
      if (this.closed || token !== this.connectionToken || this.disconnected) return
      this.disconnected = true
      this.onDisconnect(disconnect)
    }
    const open = (channel: DeepSeekHarnessChannel, path: string, receive: (data: string) => void) =>
      new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(new URL(path, base))
        const fail = (error: Error) => reject(error)
        const failClose = (code: number) => reject(new Error(`官方 DSH ${channel} 事件流在握手前关闭（code=${code}）`))
        socket.once("error", fail)
        socket.once("close", failClose)
        socket.once("open", () => {
          if (this.closed || token !== this.connectionToken) {
            socket.close()
            reject(new Error("官方 DSH 事件流握手已取消"))
            return
          }
          socket.off("error", fail)
          socket.off("close", failClose)
          this.onDiagnostic({ channel, event: "open" })
          socket.on("error", (error) => {
            this.onDiagnostic({ channel, event: "error", error: redactError(error, "WebSocket error") })
            notify({ channel, kind: "error", error })
          })
          socket.on("close", (code, reason) => {
            const text = redactReason(reason.toString())
            this.onDiagnostic({ channel, event: "close", code, reason: text })
            notify({ channel, kind: "close", code, reason: text })
          })
          socket.on("message", (data) => {
            if (this.closed || token !== this.connectionToken) return
            const text = data.toString()
            receive(text)
            try {
              const frame = JSON.parse(text) as { type?: string; payload?: { type?: string } }
              if (frame.type === "stream/error" || frame.payload?.type === "stream/error")
                notify({ channel, kind: "stream-error", reason: "official stream/error" })
            } catch {
              this.onDiagnostic({ channel, event: "malformed-frame" })
            }
          })
          resolve(socket)
        })
      })
    try {
      onPhase("connecting-mux")
      this.mux = await open("mux", "/api/events.mux", this.onMux)
      onPhase("connecting-host")
      this.host = await open("host", "/api/events.host", this.onHost)
    } catch (error) {
      this.close()
      throw error
    }
  }
}

function redactReason(reason: string): string {
  return reason ? `[关闭原因已脱敏，${Math.min(reason.length, 240)} 字符]` : ""
}

function parseBootManifest(value: unknown): DeepSeekHarnessBootManifest {
  if (!value || typeof value !== "object") throw new Error("官方 DSH Web 启动清单格式无效")
  const candidate = value as { rev?: unknown; entries?: unknown }
  if (typeof candidate.rev !== "string" || !Array.isArray(candidate.entries))
    throw new Error("官方 DSH Web 启动清单缺少 rev 或 entries")
  const entries = candidate.entries.map((entry, index): DeepSeekHarnessBootEntry => {
    if (!entry || typeof entry !== "object") throw new Error(`官方 DSH Web 启动清单第 ${index + 1} 项无效`)
    const row = entry as Record<string, unknown>
    if (typeof row.id !== "string" || typeof row.url !== "string" || typeof row.rev !== "string")
      throw new Error(`官方 DSH Web 启动清单第 ${index + 1} 项字段无效`)
    const target = new URL(row.url, "http://127.0.0.1")
    if (target.origin !== "http://127.0.0.1" || !target.pathname.startsWith("/plugins/") || target.searchParams.get("rev") !== row.rev)
      throw new Error(`官方 DSH Web 启动清单第 ${index + 1} 项 URL 无效`)
    if (row.inject !== undefined && (!Array.isArray(row.inject) || row.inject.some((item) => typeof item !== "string")))
      throw new Error(`官方 DSH Web 启动清单第 ${index + 1} 项 inject 无效`)
    if (row.immediately !== undefined && typeof row.immediately !== "boolean")
      throw new Error(`官方 DSH Web 启动清单第 ${index + 1} 项 immediately 无效`)
    return {
      id: row.id,
      url: `${target.pathname}${target.search}`,
      rev: row.rev,
      ...(row.inject === undefined ? {} : { inject: [...(row.inject as string[])] }),
      ...(row.immediately === undefined ? {} : { immediately: row.immediately }),
    }
  })
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error("官方 DSH Web 启动清单包含重复插件")
  return { rev: candidate.rev, entries }
}

function redactError(value: unknown, fallback: string): string {
  if (typeof value === "string" && value)
    return value.replace(/(api[_-]?key|authorization)\s*[:=]\s*\S+/giu, "$1=[已脱敏]")
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    return value.message.replace(/(api[_-]?key|authorization)\s*[:=]\s*\S+/giu, "$1=[已脱敏]")
  }
  return fallback
}
