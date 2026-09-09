import { Context } from "@deepseek-ai/cordis"
import Loader from "@deepseek-ai/cordis-plugin-loader"
import * as React from "react"
import * as ReactJsxRuntime from "react/jsx-runtime"
import * as ReactDom from "react-dom"
import * as ReactDomClient from "react-dom/client"
import * as Cordis from "@deepseek-ai/cordis"
import * as UiSlots from "@deepseek-ai/dsh-client-ui-slots"
import * as WebReact from "@deepseek-ai/dsh-client-web-react"
import * as UiPrimitives from "@deepseek-ai/dsh-client-ui-primitives"
import * as UiAttachment from "@deepseek-ai/dsh-client-ui-attachment"
import * as SchemaForm from "@deepseek-ai/dsh-client-schema-form"
import type {
  ConversationSnapshot,
  ISessions,
  PendingInteraction,
  SessionFace,
} from "@deepseek-ai/dsh-client-runtime/client"
import { projectDeepSeekHarnessHeader, type DeepSeekHarnessHeaderState } from "./deepseek-harness-header"
import {
  projectDeepSeekHarnessReasoning,
  selectDeepSeekHarnessReasoningEffort,
  type DeepSeekHarnessModelDirectory,
  type DeepSeekHarnessReasoningState,
} from "./deepseek-harness-reasoning"
import type {
  DeepSeekHarnessBootManifest,
  DeepSeekHarnessExtensionMessage,
  DeepSeekHarnessEventMessage,
  DeepSeekHarnessWebviewMessage,
} from "../../../src/shared/deepseek-harness"

type Bridge = {
  postMessage: (message: DeepSeekHarnessWebviewMessage) => void
  onMessage: (handler: (message: DeepSeekHarnessExtensionMessage | DeepSeekHarnessEventMessage) => void) => () => void
}

type PendingRequest = {
  resolve: (value: Response) => void
  reject: (error: Error) => void
}

type ClientModuleExports = {
  ClientModuleSystem: new (options: {
    modules: Array<{ id: string; url: string; rev: string }>
    staticModules: Record<string, unknown>
    loadBundle: (url: string) => Promise<void>
  }) => {
    prefetch: (id: string) => Promise<void>
    registerStatic: (id: string, exports: unknown) => void
    import: (id: string) => Promise<unknown>
  }
  apply: (ctx: Context) => void
  parseBootManifest: (value: unknown) => {
    modules: Array<{ id: string; url: string; rev: string }>
    plugins: Array<{ id: string; inject: string[]; immediately: boolean }>
  }
}

type ModuleHandoff = {
  id: string
  factory: (require: (specifier: string) => unknown) => ClientModuleExports
}

export type OfficialConversation = {
  session: SessionFace
  snapshot: ConversationSnapshot
  header: DeepSeekHarnessHeaderState
  reasoning?: DeepSeekHarnessReasoningState
}

type OfficialModelDirectoryResolver = {
  directoryFor: (sessionId: string) => DeepSeekHarnessModelDirectory
}

export class DeepSeekHarnessRelay {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly sockets = new Map<"mux" | "host", Set<RelayWebSocket>>()
  private readonly pluginSources = new Set<RelayEventSource>()
  private readonly buffered = new Map<"mux" | "host" | "plugins", unknown[]>([
    ["mux", []],
    ["host", []],
    ["plugins", []],
  ])
  private readonly unsubscribe: () => void
  private generation = 0
  private taskId = ""
  private nativeFetch?: typeof window.fetch
  private nativeWebSocket?: typeof window.WebSocket
  private nativeEventSource?: typeof window.EventSource

  constructor(private readonly bridge: Bridge) {
    this.unsubscribe = bridge.onMessage((message) => this.receive(message))
  }

  setGeneration(generation: number): void {
    if (generation === this.generation) return
    this.generation = generation
    for (const group of this.sockets.values()) for (const socket of group) socket.end(1001, "连接代次已切换")
    this.sockets.clear()
    for (const source of this.pluginSources) source.end()
    this.pluginSources.clear()
    this.buffered.set("mux", [])
    this.buffered.set("host", [])
    this.buffered.set("plugins", [])
    for (const request of this.pending.values()) request.reject(new Error("官方 DSH Relay 连接代次已切换"))
    this.pending.clear()
  }

  install(): void {
    if (this.nativeFetch || this.nativeWebSocket || this.nativeEventSource) return
    this.nativeFetch = window.fetch.bind(window)
    this.nativeWebSocket = window.WebSocket
    this.nativeEventSource = window.EventSource
    const relay = this
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url, window.location.href)
      if (!url.pathname.startsWith("/api/")) return relay.nativeFetch!(input, init)
      const method = request.method.toUpperCase()
      if (method !== "GET" && method !== "POST") throw new Error("官方 DSH Relay 只允许 GET/POST")
      const body = method === "POST" ? await request.clone().text() : undefined
      return relay.request(`${url.pathname}${url.search}`, method, body)
    }) as typeof window.fetch

    const Native = this.nativeWebSocket
    const Wrapped = function (this: unknown, url: string | URL, protocols?: string | string[]) {
      const target = new URL(String(url), window.location.href)
      const channel = channelOf(target.pathname)
      if (channel) return relay.openSocket(channel, target.toString())
      return new Native(url, protocols)
    } as unknown as typeof WebSocket
    Object.defineProperties(Wrapped, {
      CONNECTING: { value: WebSocket.CONNECTING },
      OPEN: { value: WebSocket.OPEN },
      CLOSING: { value: WebSocket.CLOSING },
      CLOSED: { value: WebSocket.CLOSED },
    })
    window.WebSocket = Wrapped

    const NativeEventSource = this.nativeEventSource
    const WrappedEventSource = function (this: unknown, url: string | URL, init?: EventSourceInit) {
      const target = new URL(String(url), window.location.href)
      if (target.pathname === "/plugins/events") return relay.openPluginSource(target.toString())
      return new NativeEventSource(url, init)
    } as unknown as typeof EventSource
    Object.defineProperties(WrappedEventSource, {
      CONNECTING: { value: EventSource.CONNECTING },
      OPEN: { value: EventSource.OPEN },
      CLOSED: { value: EventSource.CLOSED },
    })
    window.EventSource = WrappedEventSource
  }

  uninstall(): void {
    if (this.nativeFetch) window.fetch = this.nativeFetch
    if (this.nativeWebSocket) window.WebSocket = this.nativeWebSocket
    if (this.nativeEventSource) window.EventSource = this.nativeEventSource
    this.nativeFetch = undefined
    this.nativeWebSocket = undefined
    this.nativeEventSource = undefined
  }

  dispose(): void {
    this.uninstall()
    this.unsubscribe()
    this.setGeneration(this.generation + 1)
  }

  setTaskId(taskId: string): void {
    this.taskId = taskId
  }

  async request(path: string, method: "GET" | "POST", body?: string): Promise<Response> {
    const requestId = window.crypto.randomUUID()
    const response = new Promise<Response>((resolve, reject) => this.pending.set(requestId, { resolve, reject }))
    this.bridge.postMessage({
      type: "chipmateDeepSeekHarness.transport.request",
      taskId: this.taskId,
      requestId,
      connectionGeneration: this.generation,
      path,
      method,
      ...(body === undefined ? {} : { body }),
    })
    return response
  }

  async call<T>(method: string, payload: unknown): Promise<T> {
    const rpcId = window.crypto.randomUUID()
    const response = await this.request(
      `/api/${method}`,
      "POST",
      JSON.stringify({ type: "client-request", rpcId, method, payload }),
    )
    if (!response.ok) throw new Error(`官方 DSH ${method} 请求失败（HTTP ${response.status}）`)
    const envelope = (await response.json()) as {
      type?: string
      rpcId?: string
      result?: { ok?: boolean; value?: T; error?: { message?: string } }
    }
    if (envelope.type !== "server-response" || envelope.rpcId !== rpcId || !envelope.result)
      throw new Error(`官方 DSH ${method} 返回无效协议响应`)
    if (!envelope.result.ok) throw new Error(envelope.result.error?.message ?? `官方 DSH ${method} 执行失败`)
    return envelope.result.value as T
  }

  private receive(message: DeepSeekHarnessExtensionMessage | DeepSeekHarnessEventMessage): void {
    if (message.type === "chipmateDeepSeekHarness.transport.response") {
      const request = this.pending.get(message.requestId)
      if (!request) return
      this.pending.delete(message.requestId)
      if (message.error) request.reject(new Error(message.error))
      else request.resolve(new Response(message.body, { status: message.status, headers: message.headers }))
      return
    }
    if (
      message.type !== "chipmateDeepSeekHarness.transport.downlink" ||
      message.connectionGeneration !== this.generation
    )
      return
    if (message.channel === "plugins") {
      if (!this.pluginSources.size) {
        const frames = this.buffered.get("plugins") ?? []
        frames.push(message.frame)
        if (frames.length > 200) frames.shift()
        this.buffered.set("plugins", frames)
        return
      }
      for (const source of this.pluginSources) source.deliver(message.frame)
      return
    }
    const sockets = this.sockets.get(message.channel)
    if (!sockets?.size) {
      const frames = this.buffered.get(message.channel) ?? []
      frames.push(message.data)
      if (frames.length > 2_000) frames.shift()
      this.buffered.set(message.channel, frames)
      return
    }
    for (const socket of sockets) socket.deliver(message.data)
  }

  private openSocket(channel: "mux" | "host", url: string): RelayWebSocket {
    const socket = new RelayWebSocket(url, () => this.sockets.get(channel)?.delete(socket))
    const group = this.sockets.get(channel) ?? new Set()
    group.add(socket)
    this.sockets.set(channel, group)
    const buffered = this.buffered.get(channel) ?? []
    this.buffered.set(channel, [])
    queueMicrotask(() => {
      socket.open()
      for (const frame of buffered) socket.deliver(frame)
    })
    return socket
  }

  private openPluginSource(url: string): RelayEventSource {
    const source = new RelayEventSource(url, () => this.pluginSources.delete(source))
    this.pluginSources.add(source)
    const buffered = this.buffered.get("plugins") ?? []
    this.buffered.set("plugins", [])
    queueMicrotask(() => {
      source.open()
      for (const frame of buffered) source.deliver(frame)
    })
    return source
  }
}

export class OfficialDeepSeekHarnessClient {
  private ctx?: Context
  private sessions?: ISessions
  private unsubscribeSession?: () => void
  private unsubscribeSessions?: () => void
  private unsubscribeModelDirectory?: () => void
  private session?: SessionFace
  private modelDirectory?: DeepSeekHarnessModelDirectory
  private moduleSystem?: { prefetch: (id: string) => Promise<void> }
  private manifestRev?: string

  constructor(private readonly relay: DeepSeekHarnessRelay) {}

  async open(
    manifest: DeepSeekHarnessBootManifest,
    sessionId: string,
    publish: (conversation: OfficialConversation) => void,
  ): Promise<SessionFace> {
    if (!this.ctx || this.manifestRev !== manifest.rev) await this.boot(manifest)
    this.unbind()
    const sessions = this.sessions
    if (!sessions) throw new Error("官方客户端未提供 sessions 服务")
    await waitFor(() => sessions.list.getSnapshot().phase === "ready", "官方会话列表")
    if (!Object.prototype.hasOwnProperty.call(sessions.list.getSnapshot().byId, sessionId))
      throw new Error("官方客户端会话列表中不存在当前任务会话")
    sessions.open(sessionId as never)
    const binding = sessions.binding(sessionId as never)
    if (!binding) throw new Error("官方客户端无法绑定当前任务会话")
    const emit = this.bind(sessions, sessionId, binding.session, publish)
    await waitFor(() => {
      const snapshot = binding.session.getSnapshot()
      if (snapshot.openState === "error") throw new Error(snapshot.openError?.message ?? "官方会话历史打开失败")
      return snapshot.openState === "open"
    }, "官方 ConversationSnapshot")
    emit()
    return binding.session
  }

  currentSession(): SessionFace | undefined {
    return this.session
  }

  async selectReasoningEffort(effort: string): Promise<void> {
    const directory = this.modelDirectory
    if (!directory) throw new Error("官方 DSH 当前模型没有可选推理强度")
    await selectDeepSeekHarnessReasoningEffort(directory, effort)
  }

  async refreshModelDirectory(): Promise<void> {
    await this.modelDirectory?.load()
  }

  async waitUntilResynced(sessionId: string, publish: (conversation: OfficialConversation) => void): Promise<void> {
    const ctx = this.ctx
    const sessions = this.sessions
    if (!ctx || !sessions) throw new Error("官方客户端尚未启动")
    const connection = ctx.get("connection") as { hostDescription?: { getSnapshot: () => unknown } } | undefined
    await waitFor(() => Boolean(connection?.hostDescription?.getSnapshot()), "官方连接描述恢复")
    await waitFor(() => sessions.list.getSnapshot().phase === "ready", "官方会话列表恢复")
    const binding = sessions.binding(sessionId as never)
    if (!binding) throw new Error("官方持久化中不存在当前任务会话")
    await waitFor(() => {
      const snapshot = binding.session.getSnapshot()
      if (snapshot.openState === "error") throw new Error(snapshot.openError?.message ?? "官方会话恢复失败")
      return snapshot.openState === "open"
    }, "官方会话恢复")
    this.bind(sessions, sessionId, binding.session, publish)
  }

  async dispose(): Promise<void> {
    this.unbind()
    const ctx = this.ctx as (Context & { fiber?: { dispose?: () => void | Promise<void> } }) | undefined
    this.ctx = undefined
    this.sessions = undefined
    this.moduleSystem = undefined
    this.manifestRev = undefined
    await ctx?.fiber?.dispose?.()
    delete (window as unknown as { __DSH_MODULES__?: unknown }).__DSH_MODULES__
    delete (window as unknown as { __ModuleLoader__?: unknown }).__ModuleLoader__
  }

  private bind(
    sessions: ISessions,
    sessionId: string,
    session: SessionFace,
    publish: (conversation: OfficialConversation) => void,
  ): () => void {
    this.unbind()
    this.session = session
    this.modelDirectory = this.resolveModelDirectory(sessionId)
    let header = projectDeepSeekHarnessHeader(sessionId, sessions.list.getSnapshot().byId[sessionId as never])
    const emit = () => {
      header = projectDeepSeekHarnessHeader(sessionId, sessions.list.getSnapshot().byId[sessionId as never], header)
      const reasoning = this.modelDirectory
        ? projectDeepSeekHarnessReasoning(this.modelDirectory.store.getSnapshot())
        : undefined
      publish({ session, snapshot: session.getSnapshot(), header, ...(reasoning ? { reasoning } : {}) })
    }
    this.unsubscribeSession = session.subscribe(emit)
    this.unsubscribeSessions = sessions.list.subscribe(emit)
    this.unsubscribeModelDirectory = this.modelDirectory?.store.subscribe(emit)
    emit()
    void this.modelDirectory?.load().catch(() => undefined)
    return emit
  }

  private unbind(): void {
    this.unsubscribeSession?.()
    this.unsubscribeSessions?.()
    this.unsubscribeModelDirectory?.()
    this.unsubscribeSession = undefined
    this.unsubscribeSessions = undefined
    this.unsubscribeModelDirectory = undefined
    this.session = undefined
    this.modelDirectory = undefined
  }

  private resolveModelDirectory(sessionId: string): DeepSeekHarnessModelDirectory | undefined {
    const resolver = this.ctx?.get("modelDirectories") as OfficialModelDirectoryResolver | undefined
    if (!resolver) return
    try {
      return resolver.directoryFor(sessionId)
    } catch {
      return
    }
  }

  private async boot(manifest: DeepSeekHarnessBootManifest): Promise<void> {
    await this.dispose()
    this.relay.install()
    const modulesEntry = manifest.entries.find((entry) => entry.id === "@deepseek-ai/dsh-client-modules")
    if (!modulesEntry) throw new Error("官方 DSH Web 启动清单缺少客户端模块系统")
    const moduleExports = await captureClientModuleSystem(this.relay, modulesEntry.url)
    const parsed = moduleExports.parseBootManifest(manifest)
    const modules = new moduleExports.ClientModuleSystem({
      modules: parsed.modules,
      staticModules: officialStaticModules(),
      loadBundle: async (url) => {
        const response = await this.relay.request(url, "GET")
        if (!response.ok) throw new Error(`官方客户端插件下载失败（HTTP ${response.status}）`)
        executeOfficialBundle(await response.text())
      },
    })
    modules.registerStatic("@deepseek-ai/dsh-client-modules", moduleExports)
    ;(window as unknown as { __DSH_MODULES__?: unknown }).__DSH_MODULES__ = modules
    const prefetching = Promise.all(
      parsed.plugins
        .filter((entry) => entry.immediately)
        .map((entry) => modules.prefetch(entry.id).catch(() => undefined)),
    )
    const ctx = new Context()
    await ctx.plugin(Loader)
    ctx.loader.internal = modules as never
    await prefetching
    const names = [
      "@deepseek-ai/dsh-client-modules",
      ...parsed.plugins.map((entry) => entry.id).filter((id) => id !== "@deepseek-ai/dsh-client-modules"),
    ]
    await Promise.all(names.map((name) => ctx.loader.create({ name })))
    await ctx.loader.await()
    const sessions = ctx.get("sessions") as ISessions | undefined
    if (!sessions) {
      await (ctx as Context & { fiber?: { dispose?: () => void | Promise<void> } }).fiber?.dispose?.()
      throw new Error("官方 DSH Client Runtime 未能激活 sessions 服务")
    }
    this.ctx = ctx
    this.sessions = sessions
    this.moduleSystem = modules
    this.manifestRev = manifest.rev
  }
}

function officialStaticModules(): Record<string, unknown> {
  return {
    react: React,
    "react/jsx-runtime": ReactJsxRuntime,
    "react-dom": ReactDom,
    "react-dom/client": ReactDomClient,
    "@deepseek-ai/cordis": Cordis,
    "@deepseek-ai/dsh-client-ui-slots": UiSlots,
    "@deepseek-ai/dsh-client-web-react": WebReact,
    "@deepseek-ai/dsh-client-ui-primitives": UiPrimitives,
    "@deepseek-ai/dsh-client-ui-attachment": UiAttachment,
    "@deepseek-ai/dsh-client-schema-form": SchemaForm,
  }
}

export function pendingInteractionLabel(wait: PendingInteraction): string {
  return wait.kind === "approval" ? "官方 DSH 审批" : "官方 DSH 提问"
}

async function captureClientModuleSystem(relay: DeepSeekHarnessRelay, url: string): Promise<ClientModuleExports> {
  const response = await relay.request(url, "GET")
  if (!response.ok) throw new Error(`官方客户端模块系统下载失败（HTTP ${response.status}）`)
  let handoff: ModuleHandoff | undefined
  ;(window as unknown as { __ModuleLoader__?: { load: (value: ModuleHandoff) => void } }).__ModuleLoader__ = {
    load: (value) => {
      handoff = value
    },
  }
  try {
    executeOfficialBundle(await response.text())
    if (!handoff || handoff.id !== "@deepseek-ai/dsh-client-modules")
      throw new Error("官方客户端模块系统没有注册固定模块")
    return handoff.factory((specifier) => {
      throw new Error(`官方客户端模块系统 bootstrap 出现未知依赖：${specifier}`)
    })
  } finally {
    delete (window as unknown as { __ModuleLoader__?: unknown }).__ModuleLoader__
  }
}

function executeOfficialBundle(source: string): void {
  const nonce = (window as { CHIPMATE_CSP_NONCE?: string }).CHIPMATE_CSP_NONCE
  if (!nonce) throw new Error("ChipMate QA 缺少官方客户端插件执行 nonce")
  const script = document.createElement("script")
  script.nonce = nonce
  script.textContent = source
  document.head.append(script)
  script.remove()
}

function channelOf(path: string): "mux" | "host" | undefined {
  if (path === "/api/events.mux") return "mux"
  if (path === "/api/events.host") return "host"
  return undefined
}

class RelayWebSocket extends EventTarget {
  readonly CONNECTING = WebSocket.CONNECTING
  readonly OPEN = WebSocket.OPEN
  readonly CLOSING = WebSocket.CLOSING
  readonly CLOSED = WebSocket.CLOSED
  readonly protocol = ""
  readonly extensions = ""
  readonly bufferedAmount = 0
  binaryType: BinaryType = "blob"
  readyState: number = WebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(
    readonly url: string,
    private readonly remove: () => void,
  ) {
    super()
  }

  open(): void {
    if (this.readyState !== WebSocket.CONNECTING) return
    this.readyState = WebSocket.OPEN
    const event = new Event("open")
    this.dispatchEvent(event)
    this.onopen?.(event)
  }

  deliver(data: unknown): void {
    if (this.readyState !== WebSocket.OPEN) return
    const event = new MessageEvent("message", { data: typeof data === "string" ? data : JSON.stringify(data) })
    this.dispatchEvent(event)
    this.onmessage?.(event)
  }

  send(): void {
    throw new Error("官方 DSH 事件 WebSocket 是只读下行连接")
  }

  close(code = 1000, reason = ""): void {
    this.end(code, reason)
  }

  end(code: number, reason: string): void {
    if (this.readyState === WebSocket.CLOSED) return
    this.readyState = WebSocket.CLOSED
    this.remove()
    const event = new CloseEvent("close", { code, reason, wasClean: code === 1000 })
    this.dispatchEvent(event)
    this.onclose?.(event)
  }
}

class RelayEventSource extends EventTarget {
  readonly CONNECTING = EventSource.CONNECTING
  readonly OPEN = EventSource.OPEN
  readonly CLOSED = EventSource.CLOSED
  readonly withCredentials = false
  readyState: number = EventSource.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(
    readonly url: string,
    private readonly remove: () => void,
  ) {
    super()
  }

  open(): void {
    if (this.readyState !== EventSource.CONNECTING) return
    this.readyState = EventSource.OPEN
    const event = new Event("open")
    this.dispatchEvent(event)
    this.onopen?.(event)
  }

  deliver(frame: unknown): void {
    if (this.readyState !== EventSource.OPEN) return
    const event = new MessageEvent("message", { data: JSON.stringify(frame) })
    this.dispatchEvent(event)
    this.onmessage?.(event)
  }

  close(): void {
    this.end()
  }

  end(): void {
    if (this.readyState === EventSource.CLOSED) return
    this.readyState = EventSource.CLOSED
    this.remove()
  }
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`等待${label}超时`)
}
