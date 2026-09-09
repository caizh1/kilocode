import * as vscode from "vscode"
import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  type DeepSeekHarnessAgentPreset,
  type DeepSeekHarnessBootManifest,
  type DeepSeekHarnessModel,
  type DeepSeekHarnessProviderOption,
  type DeepSeekHarnessSession,
  type DeepSeekHarnessSnapshot,
} from "../../shared/deepseek-harness"
import {
  deepSeekHarnessHostTarget,
  deepSeekHarnessPresetForTarget,
  type DeepSeekHarnessRuntimeTarget,
} from "../../shared/deepseek-harness-runtime"
import {
  DeepSeekHarnessPresetUnavailableError,
  DeepSeekHarnessRuntime,
  type DeepSeekHarnessConfig,
} from "./runtime"
import type { InstalledDeepSeekHarnessRuntime } from "./installer"
import type {
  DeepSeekHarnessFrame,
  DeepSeekHarnessProtocol,
  DeepSeekHarnessTransportResponse,
} from "./protocol"

type Subscriber = (snapshot: DeepSeekHarnessSnapshot) => void
type EventSubscriber = (
  channel: "mux" | "host" | "plugins",
  payload: { data: string } | { frame: DeepSeekHarnessFrame },
  connectionGeneration: number,
) => void
type LegacySessionMapping = {
  schemaVersion: 1
  chipmateTaskId: string
  officialDshSessionId: string
  workspaceUri: string
  createdAt: string
  lastOpenedAt: string
  displayTitle: string
}
type MappedSession = {
  mappingKey: string
  officialDshSessionId: string
  agentPreset: string
  createdAt: string
  lastOpenedAt: string
}
type SessionMapping = {
  schemaVersion: 2
  chipmateTaskId: string
  workspaceUri: string
  activeMappingKey: string
  sessions: MappedSession[]
  displayTitle: string
}
type StoredSessionMapping = LegacySessionMapping | SessionMapping
type SessionSummary = {
  sessionId: string
  running?: boolean
  blank?: boolean
  pendingInteraction?: unknown
  cwd?: string
  agentPreset?: string
}
type ActivationRequest = {
  taskId: string
  workspace: string
  config: DeepSeekHarnessConfig
  models: DeepSeekHarnessModel[]
  selected: DeepSeekHarnessModel
}
type PendingProviderSwitch = {
  taskId: string
  workspace: string
  selected: DeepSeekHarnessModel
}
type ProviderPreference = {
  schemaVersion: 1
  providerID: string
  modelID: string
  updatedAt: string
}

export class DeepSeekHarnessService {
  private readonly subscribers = new Set<Subscriber>()
  private readonly eventSubscribers = new Set<EventSubscriber>()
  private readonly runtime: DeepSeekHarnessRuntime
  private readonly context: vscode.ExtensionContext
  private readonly runtimeTarget?: DeepSeekHarnessRuntimeTarget
  private readonly expectedAgentPreset?: DeepSeekHarnessAgentPreset
  private protocol?: DeepSeekHarnessProtocol
  private active = false
  private workspace?: string
  private config?: DeepSeekHarnessConfig
  private sessions: DeepSeekHarnessSession[] = []
  private models: DeepSeekHarnessModel[] = []
  private selectedModel?: DeepSeekHarnessModel
  private providerOptions: DeepSeekHarnessProviderOption[] = []
  private desiredSelection?: DeepSeekHarnessModel
  private runningSelection?: DeepSeekHarnessModel
  private selectionState: DeepSeekHarnessSnapshot["selectionState"] = "checking"
  private pendingProviderSwitch?: PendingProviderSwitch
  private selectionOperation = 0
  private sessionId?: string
  private agentPreset?: string
  private presetState: DeepSeekHarnessSnapshot["presetState"] = "checking"
  private readOnlySession = false
  private taskMapping?: SessionMapping
  private taskId?: string
  private bootManifest?: DeepSeekHarnessBootManifest
  private connectionGeneration = 0
  private reconnectAttempt = 0
  private reconnectCycle = 0
  private reconnectWarning?: NodeJS.Timeout
  private projection?: {
    sessionId: string
    connectionGeneration: number
    promise: Promise<void>
    resolve: () => void
    reject: (error: Error) => void
  }
  private state: DeepSeekHarnessSnapshot["state"] = "stopped"
  private launchStage?: DeepSeekHarnessSnapshot["state"]
  private error?: string
  private running = false
  private readonly runningSessions = new Set<string>()
  private forcedTermination = false
  private restartRequired = false
  private restartReason?: string
  private connectedFingerprint?: string
  private requestedActivation?: ActivationRequest
  private deferredActivation?: ActivationRequest
  private activating?: Promise<void>
  private stopping = false
  private stoppingTask?: Promise<void>
  private preparing?: Promise<InstalledDeepSeekHarnessRuntime>
  private disposed = false

  constructor(context: vscode.ExtensionContext, runtimeTarget = deepSeekHarnessHostTarget()) {
    this.context = context
    this.runtimeTarget = runtimeTarget
    this.expectedAgentPreset = runtimeTarget ? deepSeekHarnessPresetForTarget(runtimeTarget) : undefined
    this.runtime = new DeepSeekHarnessRuntime(
      context,
      (data) => this.receiveMux(data),
      (data) => this.receiveHost(data),
      (frame) => this.receivePlugin(frame),
      (error) => this.markCrashed(error),
      (state) => this.handleRuntimePhase(state),
    )
  }

  subscribe(subscriber: Subscriber, eventSubscriber?: EventSubscriber): vscode.Disposable {
    this.subscribers.add(subscriber)
    if (eventSubscriber) this.eventSubscribers.add(eventSubscriber)
    subscriber(this.snapshot())
    return {
      dispose: () => {
        this.subscribers.delete(subscriber)
        if (eventSubscriber) this.eventSubscribers.delete(eventSubscriber)
      },
    }
  }

  setActive(active: boolean): void {
    this.active = active
    this.broadcast()
  }

  currentSelection(): DeepSeekHarnessModel | undefined {
    return this.runningSelection ?? this.desiredSelection ?? this.selectedModel
  }

  runningProviderSelection(): DeepSeekHarnessModel | undefined {
    return this.runningSelection
  }

  lastSuccessfulSelection(): Pick<DeepSeekHarnessModel, "providerID" | "modelID"> | undefined {
    try {
      const value = JSON.parse(readFileSync(this.providerPreferencePath(), "utf8")) as Partial<ProviderPreference>
      if (value.schemaVersion !== 1 || typeof value.providerID !== "string" || typeof value.modelID !== "string") return
      return { providerID: value.providerID, modelID: value.modelID }
    } catch {
      return
    }
  }

  beginProviderResolution(taskId?: string): void {
    if (taskId) this.taskId = taskId
    if (["crashed", "reconnecting-events", "resyncing-session", "stopping"].includes(this.state)) {
      this.selectionState = "checking"
      this.broadcast()
      return
    }
    this.state = "resolving-provider"
    this.selectionState = "checking"
    this.error = undefined
    this.broadcast()
  }

  currentTaskId(): string | undefined {
    return this.taskId
  }

  setProviderOptions(options: DeepSeekHarnessProviderOption[], desired?: DeepSeekHarnessModel): void {
    this.providerOptions = options
    this.desiredSelection = desired
    this.broadcast()
  }

  requireProviderSelection(error?: string): void {
    this.state = "provider-selection-required"
    this.selectionState = "required"
    this.error = error ?? "请选择已配置直连 NewAPI 凭据的 Provider"
    this.broadcast()
  }

  rejectProviderSelection(error: string): void {
    if (this.state === "crashed") {
      this.pendingProviderSwitch = undefined
      this.selectionState = "required"
      this.error = error
      this.broadcast()
      return
    }
    if (this.runningSelection && this.protocol?.connected) {
      this.pendingProviderSwitch = undefined
      this.desiredSelection = this.runningSelection
      this.selectedModel = this.runningSelection
      this.selectionState = "ready"
      this.state = "ready"
      this.error = error
      this.broadcast()
      return
    }
    this.pendingProviderSwitch = undefined
    this.requireProviderSelection(error)
  }

  runtimeAvailable(): boolean {
    return this.runtime.runtimeAvailable()
  }

  async prefetchRuntime(): Promise<void> {
    if (!this.runtimeAvailable() || this.protocol || this.disposed) return
    if (!this.active) {
      this.state = "installing-runtime"
      this.error = undefined
      this.broadcast()
    }
    try {
      await this.prepareRuntime()
      if (!this.active && !this.protocol) {
        this.state = "stopped"
        this.error = undefined
        this.broadcast()
      }
    } catch (error) {
      if (!this.protocol) {
        this.state = "runtime-unavailable"
        this.error = safeError(error)
        this.broadcast()
      }
      throw error
    }
  }

  noteConfiguration(config: DeepSeekHarnessConfig, models: DeepSeekHarnessModel[]): void {
    if (!this.config) return
    this.config = config
    this.models = models
    this.selectedModel = matchingModel(models, this.selectedModel)
    this.desiredSelection = matchingModel(models, this.desiredSelection) ?? this.desiredSelection
    this.runningSelection = matchingModel(models, this.runningSelection) ?? this.runningSelection
    const connected = this.connectedFingerprint ?? this.runtime.currentConfigFingerprint
    if (!connected) return
    if (this.runtimeTarget && connected === DeepSeekHarnessRuntime.fingerprint(config, this.runtimeTarget)) {
      this.restartRequired = false
      this.restartReason = undefined
      if (this.state === "restart-required" && this.protocol?.connected) {
        this.state = "ready"
        this.selectionState = "ready"
        this.error = undefined
      }
      this.broadcast()
      return
    }
    this.restartRequired = true
    this.restartReason = "NewAPI 地址、凭据或可用 DeepSeek 模型发生变化，需要重启官方 DSH"
    this.state = "restart-required"
    this.selectionState = "restart-required"
    this.error = this.restartReason
    this.broadcast()
  }

  markConfigurationUnavailable(error: unknown): void {
    if (!this.config) return
    this.restartRequired = true
    this.restartReason = `当前 NewAPI 配置不再满足 DeepSeek Harness：${safeError(error)}`
    this.state = "restart-required"
    this.selectionState = "restart-required"
    this.error = this.restartReason
    this.broadcast()
  }

  async activate(
    taskId: string,
    workspace: string,
    config: DeepSeekHarnessConfig,
    models: DeepSeekHarnessModel[],
    selected: DeepSeekHarnessModel,
  ): Promise<void> {
    if (this.disposed || this.stopping || this.state === "stopping")
      throw new Error("DeepSeek Harness 正在停止，拒绝新的 QA 请求")
    if (this.activating) {
      await this.activating
      if (this.stopping) return
    }
    const request = { taskId, workspace, config, models, selected }
    this.desiredSelection = selected
    this.requestedActivation = request
    const pending = this.activateOnce(request)
    this.activating = pending
    try {
      await pending
    } finally {
      if (this.activating === pending) this.activating = undefined
    }
  }

  private async activateOnce(request: ActivationRequest): Promise<void> {
    if (!request.taskId || !request.workspace) throw new Error("ChipMate DeepSeek Harness 需要有效任务和工作区")
    const runtimeTarget = this.requireRuntimeTarget()
    this.config = request.config
    this.models = request.models
    const fingerprint = DeepSeekHarnessRuntime.fingerprint(request.config, runtimeTarget)
    const connected = this.connectedFingerprint ?? this.runtime.currentConfigFingerprint

    if (connected && connected !== fingerprint) {
      this.desiredSelection = request.selected
      this.restartRequired = true
      this.restartReason = "NewAPI 配置或 DeepSeek 模型列表已变化，需要重启官方 DSH"
      this.state = "restart-required"
      this.selectionState = "restart-required"
      this.error = this.restartReason
      this.broadcast()
      return
    }

    if (this.state === "crashed") {
      this.desiredSelection = request.selected
      this.broadcast()
      return
    }

    if (shouldDeferActivation(this.state, connected, fingerprint)) {
      this.deferredActivation = request
      this.broadcast()
      return
    }

    const reusable = this.runtime.reusableProtocol(request.config)
    if (reusable) {
      this.protocol = reusable
      this.connectedFingerprint = fingerprint
      this.restartRequired = false
      this.restartReason = undefined
      await this.activateWarm(request)
      return
    }

    if (connected) {
      this.state = "crashed"
      this.launchStage = undefined
      this.error = "官方 DSH 仍有运行记录，但当前协议连接不可复用；请等待事件恢复或手动重新启动"
      this.broadcast()
      return
    }

    await verifyNewApi(request.config, request.selected.modelID)
    if (this.stopping) return
    this.workspace = request.workspace
    this.restartRequired = false
    this.restartReason = undefined
    this.taskId = request.taskId
    this.desiredSelection = request.selected
    this.selectionState = "checking"
    this.agentPreset = undefined
    this.presetState = "checking"
    this.readOnlySession = false
    this.state = "installing-runtime"
    this.launchStage = undefined
    this.error = undefined
    this.broadcast()
    let installed: InstalledDeepSeekHarnessRuntime
    try {
      installed = await this.prepareRuntime()
      this.state = "runtime-ready"
      this.broadcast()
    } catch (error) {
      this.state = "runtime-unavailable"
      this.error = safeError(error)
      this.broadcast()
      throw error
    }
    try {
      this.connectionGeneration += 1
      this.protocol = await this.runtime.ensure(request.workspace, request.config, installed)
      this.connectedFingerprint = this.runtime.currentConfigFingerprint ?? fingerprint
      if (this.stopping) return
      this.bootManifest = await this.protocol.bootManifest()
      await this.protocol.openPluginEvents()
      await this.openTask(request.taskId, request.workspace)
      if (!this.readOnlySession) await this.selectModel(request.selected)
      await this.projectCurrentSession()
    } catch (error) {
      if (this.stopping) return
      if (["reconnecting-events", "resyncing-session"].includes(this.state)) return
      this.state = activationFailureState(error)
      if (error instanceof DeepSeekHarnessPresetUnavailableError) this.presetState = "unavailable"
      this.error = safeError(error)
      this.broadcast()
    }
  }

  private async activateWarm(request: ActivationRequest): Promise<void> {
    this.config = request.config
    this.models = request.models
    const sameTask =
      this.taskId === request.taskId && this.workspace === request.workspace && this.sessionId !== undefined
    this.workspace = request.workspace
    if (sameTask) {
      if (
        !this.readOnlySession &&
        (this.selectedModel?.providerID !== request.selected.providerID ||
          this.selectedModel.modelID !== request.selected.modelID)
      )
        await this.selectModel(request.selected)
      this.state = "ready"
      this.commitReadySelection(request.selected)
      this.launchStage = undefined
      this.error = undefined
      this.broadcast()
      return
    }
    await this.openTask(request.taskId, request.workspace)
    if (!this.readOnlySession) await this.selectModel(request.selected)
    await this.projectCurrentSession()
  }

  async refresh(): Promise<void> {
    this.broadcast()
  }

  private async createSession(taskId: string, workspace: string): Promise<void> {
    const protocol = this.requireProtocol()
    const expectedPreset = this.requireExpectedAgentPreset()
    const result = await protocol.call<{ sessionId: string }>("session.create", {
      cwd: workspace,
      agentPreset: expectedPreset,
    })
    const summary = await this.waitForSessionSummary(result.sessionId)
    if (summary.agentPreset !== expectedPreset)
      throw new DeepSeekHarnessPresetUnavailableError(
        `官方 DSH 创建的会话未采用平台要求的 ${expectedPreset} Agent Preset`,
      )
    if (!summary.cwd || resolve(summary.cwd) !== resolve(workspace))
      throw new Error("官方 DSH 创建的会话工作区与当前任务不一致")
    const now = new Date().toISOString()
    const session: MappedSession = {
      mappingKey: randomUUID(),
      officialDshSessionId: result.sessionId,
      agentPreset: summary.agentPreset,
      createdAt: now,
      lastOpenedAt: now,
    }
    const prior = this.taskMapping
    const mapping: SessionMapping = {
      schemaVersion: 2,
      chipmateTaskId: taskId,
      workspaceUri: workspace,
      activeMappingKey: session.mappingKey,
      sessions: [...(prior?.sessions ?? []), session],
      displayTitle: "ChipMate DeepSeek Harness",
    }
    await this.saveMapping(mapping)
    this.taskMapping = mapping
    this.adoptMappedSession(session, mapping, false)
  }

  private async openTask(taskId: string, workspace: string): Promise<void> {
    const stored = this.mapping(taskId)
    if (!stored) {
      this.taskMapping = undefined
      await this.createSession(taskId, workspace)
      return
    }
    if (stored.workspaceUri !== workspace) throw new Error("当前任务的官方 DSH 会话属于另一个工作区，无法恢复")
    const mapping = stored.schemaVersion === 1 ? await this.upgradeMapping(stored) : stored
    const active = mapping.sessions.find((item) => item.mappingKey === mapping.activeMappingKey)
    if (!active) throw new Error("当前任务的官方 DSH 活动会话映射不存在")
    const summary = await this.verifyMappedSession(active, mapping.workspaceUri)
    const expectedPreset = this.requireExpectedAgentPreset()
    if (summary.blank && active.agentPreset !== expectedPreset) {
      const selected = await this.requireProtocol().call<{ agentPreset?: string }>("agentPreset.select", {
        sessionId: active.officialDshSessionId,
        agentPreset: expectedPreset,
      })
      if (selected.agentPreset !== expectedPreset)
        throw new DeepSeekHarnessPresetUnavailableError(
          `官方空白会话未能切换到平台要求的 ${expectedPreset} Agent Preset`,
        )
      active.agentPreset = selected.agentPreset
    }
    active.lastOpenedAt = new Date().toISOString()
    await this.saveMapping(mapping)
    this.taskMapping = mapping
    this.adoptMappedSession(active, mapping, false)
    this.broadcast()
  }

  async createPreferredSession(): Promise<void> {
    const expectedPreset = this.requireExpectedAgentPreset()
    if (!this.taskId || !this.workspace) throw new Error("当前没有可迁移的 ChipMate DeepSeek Harness 任务")
    const current = this.taskMapping?.sessions.find((item) => item.officialDshSessionId === this.sessionId)
    if (!current || current.mappingKey !== this.taskMapping?.activeMappingKey || current.agentPreset === expectedPreset)
      throw new Error("只有当前任务中与平台模式不匹配的活动历史会话可以迁移")
    const summary = await this.sessionSummary(this.sessionId)
    if (summary?.running || (summary?.pendingInteraction !== null && summary?.pendingInteraction !== undefined))
      throw new Error("历史模式会话仍在运行或等待交互，暂不能新建平台首选会话")
    await this.createSession(this.taskId, this.workspace)
    if (this.selectedModel) await this.selectModel(this.selectedModel)
    await this.projectCurrentSession()
  }

  /** @deprecated 一版兼容别名；preset 仍由平台策略决定。 */
  async createMinimalSession(): Promise<void> {
    await this.createPreferredSession()
  }

  async openMappedSession(mappingKey: string): Promise<void> {
    const mapping = this.taskMapping
    if (!mapping || mapping.chipmateTaskId !== this.taskId) throw new Error("当前任务没有可打开的历史会话")
    const session = mapping.sessions.find((item) => item.mappingKey === mappingKey)
    if (!session) throw new Error("请求的历史会话不属于当前 ChipMate 任务")
    await this.verifyMappedSession(session, mapping.workspaceUri)
    session.lastOpenedAt = new Date().toISOString()
    await this.saveMapping(mapping)
    this.adoptMappedSession(session, mapping, session.mappingKey !== mapping.activeMappingKey)
    await this.projectCurrentSession()
  }

  async returnToActiveSession(): Promise<void> {
    const mapping = this.taskMapping
    if (!mapping) throw new Error("当前任务没有活动的平台首选会话")
    await this.openMappedSession(mapping.activeMappingKey)
  }

  private async upgradeMapping(legacy: LegacySessionMapping): Promise<SessionMapping> {
    const summary = await this.sessionSummary(legacy.officialDshSessionId)
    if (!summary) throw new Error("无法恢复当前任务映射的官方 DSH 会话：会话不存在")
    if (!summary.cwd || resolve(summary.cwd) !== resolve(legacy.workspaceUri))
      throw new Error("无法恢复当前任务映射的官方 DSH 会话：工作区归属不匹配")
    let agentPreset = summary.agentPreset ?? "standard"
    const expectedPreset = this.requireExpectedAgentPreset()
    if (summary.blank && agentPreset !== expectedPreset) {
      const selected = await this.requireProtocol().call<{ agentPreset?: string }>("agentPreset.select", {
        sessionId: legacy.officialDshSessionId,
        agentPreset: expectedPreset,
      })
      if (selected.agentPreset !== expectedPreset)
        throw new DeepSeekHarnessPresetUnavailableError(
          `官方空白会话未能切换到平台要求的 ${expectedPreset} Agent Preset`,
        )
      agentPreset = selected.agentPreset
    }
    const mappingKey = randomUUID()
    const mapping: SessionMapping = {
      schemaVersion: 2,
      chipmateTaskId: legacy.chipmateTaskId,
      workspaceUri: legacy.workspaceUri,
      activeMappingKey: mappingKey,
      sessions: [
        {
          mappingKey,
          officialDshSessionId: legacy.officialDshSessionId,
          agentPreset,
          createdAt: legacy.createdAt,
          lastOpenedAt: new Date().toISOString(),
        },
      ],
      displayTitle: legacy.displayTitle,
    }
    await this.saveMapping(mapping)
    return mapping
  }

  private adoptMappedSession(session: MappedSession, mapping: SessionMapping, viewingHistory: boolean): void {
    const expectedPreset = this.requireExpectedAgentPreset()
    this.taskId = mapping.chipmateTaskId
    this.workspace = mapping.workspaceUri
    this.sessionId = session.officialDshSessionId
    this.agentPreset = session.agentPreset
    this.presetState = session.agentPreset === expectedPreset ? "ready" : "legacy-mismatch"
    this.readOnlySession = viewingHistory || session.agentPreset !== expectedPreset
    this.sessions = mapping.sessions.map((item) => ({
      sessionId: item.officialDshSessionId,
      mappingKey: item.mappingKey,
      agentPreset: item.agentPreset,
      readOnly: item.mappingKey !== mapping.activeMappingKey,
      cwd: mapping.workspaceUri,
    }))
  }

  private async verifyMappedSession(session: MappedSession, workspace: string): Promise<SessionSummary> {
    const summary = await this.sessionSummary(session.officialDshSessionId)
    if (!summary) throw new Error("无法恢复当前任务映射的官方 DSH 会话：会话不存在")
    if (!summary.cwd || resolve(summary.cwd) !== resolve(workspace))
      throw new Error("无法恢复当前任务映射的官方 DSH 会话：工作区归属不匹配")
    const actualPreset = summary.agentPreset ?? "standard"
    if (actualPreset !== session.agentPreset)
      throw new Error("无法恢复当前任务映射的官方 DSH 会话：Agent Preset 与可信映射不匹配")
    try {
      await this.requireProtocol().call("session.history", {
        sessionId: session.officialDshSessionId,
        maxMessages: 1,
      })
    } catch (error) {
      throw new Error(`无法恢复当前任务映射的官方 DSH 会话：${safeError(error)}`)
    }
    return summary
  }

  private async sessionSummary(sessionId?: string): Promise<SessionSummary | undefined> {
    if (!sessionId) return undefined
    const result = await this.requireProtocol().call<{ items?: SessionSummary[] }>("session.list", {})
    return result.items?.find((item) => item.sessionId === sessionId)
  }

  private async waitForSessionSummary(sessionId: string): Promise<SessionSummary> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const summary = await this.sessionSummary(sessionId)
      if (summary) return summary
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
    throw new Error("官方 DSH 创建会话后未能回读会话摘要")
  }

  async selectModel(model: DeepSeekHarnessModel): Promise<void> {
    if (this.readOnlySession) throw new Error("只读历史会话不能切换模型")
    const protocol = this.requireProtocol()
    if (!this.sessionId) throw new Error("尚未创建 DSH 会话")
    if (!this.models.some((item) => item.providerID === model.providerID && item.modelID === model.modelID)) {
      throw new Error("所选模型不在已验证的 DeepSeek 模型列表中")
    }
    await protocol.call("session.selectModel", {
      sessionId: this.sessionId,
      provider: "deepseek-official",
      model: model.modelID,
    })
    this.selectedModel = model
    this.desiredSelection = model
    this.broadcast()
  }

  noteSelectedModel(providerID: string, modelID: string): void {
    if (this.readOnlySession) throw new Error("只读历史会话不能切换模型")
    const model = this.models.find((item) => item.providerID === providerID && item.modelID === modelID)
    if (!model) throw new Error("所选模型不在已验证的 DeepSeek 模型列表中")
    this.selectedModel = model
    this.desiredSelection = model
    this.broadcast()
  }

  async requestSelection(
    taskId: string,
    workspace: string,
    config: DeepSeekHarnessConfig,
    models: DeepSeekHarnessModel[],
    selected: DeepSeekHarnessModel,
  ): Promise<void> {
    const operation = ++this.selectionOperation
    const request = { taskId, workspace, config, models, selected }
    if (["reconnecting-events", "resyncing-session", "stopping"].includes(this.state))
      throw new Error("官方 DSH 正在恢复或停止，暂时不能切换 Provider")
    this.desiredSelection = selected
    this.requestedActivation = request
    if (this.state === "crashed") {
      this.selectionState = "required"
      this.broadcast()
      return
    }
    const running = this.runningSelection
    if (!running || !this.protocol?.connected || this.state === "stopped" || this.state === "provider-selection-required") {
      await this.activate(taskId, workspace, config, models, selected)
      return
    }
    if (running.providerID === selected.providerID) {
      await this.selectWithinRunningProvider(operation, config, models, selected, running)
      return
    }
    if (await this.blockProviderSwitchForOtherLeases()) return
    const activeWork = this.running || (await this.runtime.hasActiveWork())
    if (operation !== this.selectionOperation) return
    if (activeWork) {
      this.pendingProviderSwitch = { taskId, workspace, selected }
      this.state = "provider-switch-confirmation-required"
      this.selectionState = "restart-required"
      this.error = "Provider 切换需要停止正在运行的官方任务"
      this.broadcast()
      return
    }
    await this.switchProvider(request)
  }

  private async selectWithinRunningProvider(
    operation: number,
    config: DeepSeekHarnessConfig,
    models: DeepSeekHarnessModel[],
    selected: DeepSeekHarnessModel,
    running: DeepSeekHarnessModel,
  ): Promise<void> {
    const runtimeTarget = this.requireRuntimeTarget()
    const connected = this.connectedFingerprint ?? this.runtime.currentConfigFingerprint
    if (connected && connected !== DeepSeekHarnessRuntime.fingerprint(config, runtimeTarget)) {
      this.config = config
      this.models = models
      this.restartRequired = true
      this.restartReason = "当前 Provider 的地址、凭据或模型目录发生变化，需要重启官方 DSH"
      this.state = "restart-required"
      this.selectionState = "restart-required"
      this.error = this.restartReason
      this.broadcast()
      return
    }
    this.config = config
    this.models = models
    try {
      if (this.readOnlySession) throw new Error("只读历史会话不能切换模型")
      const protocol = this.requireProtocol()
      if (!this.sessionId) throw new Error("尚未创建 DSH 会话")
      if (!models.some((model) => model.providerID === selected.providerID && model.modelID === selected.modelID))
        throw new Error("所选模型不在已验证的 DeepSeek 模型列表中")
      await protocol.call("session.selectModel", {
        sessionId: this.sessionId,
        provider: "deepseek-official",
        model: selected.modelID,
      })
      if (operation !== this.selectionOperation) return
      this.state = "ready"
      this.error = undefined
      this.commitReadySelection(selected)
    } catch (error) {
      if (operation !== this.selectionOperation) return
      this.desiredSelection = running
      this.selectedModel = running
      this.selectionState = "ready"
      this.state = "ready"
      this.error = `切换模型失败，已保留原模型：${safeError(error)}`
      this.broadcast()
    }
  }

  private async blockProviderSwitchForOtherLeases(): Promise<boolean> {
    if (!(await this.runtime.hasOtherLeases())) return false
    this.state = "restart-required"
    this.selectionState = "restart-required"
    this.error = "另一个 VS Code 窗口仍连接当前官方 DSH；请先完成并关闭其他窗口的 ChipMate DeepSeek Harness，再切换 Provider"
    this.broadcast()
    return true
  }

  pendingProviderSelection(): PendingProviderSwitch | undefined {
    return this.pendingProviderSwitch ? { ...this.pendingProviderSwitch } : undefined
  }

  async confirmProviderSwitch(
    config: DeepSeekHarnessConfig,
    models: DeepSeekHarnessModel[],
    selected: DeepSeekHarnessModel,
  ): Promise<void> {
    this.selectionOperation += 1
    const pending = this.pendingProviderSwitch
    if (!pending) return
    if (pending.selected.providerID !== selected.providerID || pending.selected.modelID !== selected.modelID)
      throw new Error("待确认的 Provider 选择已变化，请重新选择")
    this.pendingProviderSwitch = undefined
    await this.switchProvider({ ...pending, config, models, selected })
  }

  cancelProviderSwitch(): void {
    if (!this.pendingProviderSwitch) return
    this.selectionOperation += 1
    this.pendingProviderSwitch = undefined
    this.desiredSelection = this.runningSelection
    this.selectionState = "ready"
    this.state = this.protocol?.connected ? "ready" : this.state
    this.error = undefined
    this.broadcast()
  }

  private async switchProvider(request: ActivationRequest): Promise<void> {
    if (await this.runtime.hasOtherLeases()) {
      this.desiredSelection = this.runningSelection
      this.state = "restart-required"
      this.selectionState = "restart-required"
      this.error = "另一个 VS Code 窗口仍连接当前官方 DSH；为避免中断其他窗口，已阻止 Provider 切换"
      this.broadcast()
      return
    }
    this.state = "switching-provider"
    this.selectionState = "switching"
    this.error = undefined
    this.broadcast()
    await this.stop(false)
    if (this.snapshot().state !== "stopped") return
    this.desiredSelection = request.selected
    await this.activate(request.taskId, request.workspace, request.config, request.models, request.selected)
  }

  async transport(
    connectionGeneration: number,
    path: string,
    method: "GET" | "POST",
    body?: string,
  ): Promise<DeepSeekHarnessTransportResponse> {
    if (connectionGeneration !== this.connectionGeneration) throw new Error("官方 DSH Relay 连接代次已过期")
    if (!this.isRelayRequestAllowed(path, method)) throw new Error("官方 DSH Relay 拒绝未授权接口")
    const active = this.taskMapping?.sessions.find((item) => item.mappingKey === this.taskMapping?.activeMappingKey)
    const viewingHistory = active?.officialDshSessionId !== this.sessionId
    if (this.readOnlySession && isReadOnlyMutation(path, viewingHistory))
      throw new Error("当前官方 DSH 会话为只读历史，拒绝修改请求")
    return this.requireProtocol().request(path, method, body)
  }

  projectionReady(sessionId: string, connectionGeneration: number): void {
    const pending = this.projection
    if (!pending || pending.sessionId !== sessionId || pending.connectionGeneration !== connectionGeneration) return
    pending.resolve()
  }

  projectionFailed(sessionId: string, connectionGeneration: number, error: string): void {
    const pending = this.projection
    if (!pending || pending.sessionId !== sessionId || pending.connectionGeneration !== connectionGeneration) return
    if (this.state === "resyncing-session" && !error.includes("不存在")) {
      this.error = `官方会话仍在恢复：${safeError(error)}`
      this.broadcast()
      return
    }
    pending.reject(new Error(`官方客户端会话投影失败：${safeError(error)}`))
  }

  async stop(interactive: boolean): Promise<void> {
    if (this.stoppingTask) return this.stoppingTask
    const task = this.confirmAndStop(interactive)
    this.stoppingTask = task
    try {
      await task
    } finally {
      if (this.stoppingTask === task) this.stoppingTask = undefined
    }
  }

  private async confirmAndStop(interactive: boolean): Promise<void> {
    const activeWork =
      interactive && (this.running || (await this.runtime.hasActiveWork()))
    if (activeWork) {
      const choice = await vscode.window.showWarningMessage(
        "官方 DSH 仍有运行任务、工具调用、审批等待，或无法完成状态核对。确定停止 DeepSeek Harness？",
        { modal: true },
        "停止",
      )
      if (choice !== "停止") return
    }
    if (this.disposed) return
    await this.stopOnce()
  }

  private async stopOnce(): Promise<void> {
    this.stopping = true
    this.state = "stopping"
    this.launchStage = undefined
    this.clearReconnectWarning()
    this.broadcast()
    try {
      await this.activating
      const result = await this.runtime.stop()
      this.protocol = undefined
      this.bootManifest = undefined
      this.connectedFingerprint = undefined
      this.deferredActivation = undefined
      this.rejectProjection(new Error("官方 DSH 已停止"))
      this.running = false
      this.runningSelection = undefined
      this.runningSessions.clear()
      this.forcedTermination = result.forced
      this.state = "stopped"
      this.restartRequired = false
      this.restartReason = undefined
      this.launchStage = undefined
      this.broadcast()
    } finally {
      this.stopping = false
    }
  }

  async restart(
    workspace: string,
    config: DeepSeekHarnessConfig,
    models: DeepSeekHarnessModel[],
    selected: DeepSeekHarnessModel,
  ): Promise<void> {
    await this.stop(true)
    if (this.state !== "stopped") return
    const taskId = this.requestedActivation?.taskId ?? this.taskId
    if (!taskId) throw new Error("当前没有可恢复的 ChipMate 任务")
    await this.activate(taskId, workspace, config, models, selected)
  }

  async retryRuntime(): Promise<void> {
    await this.prefetchRuntime()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.clearReconnectWarning()
    if (this.stopping) await this.stoppingTask
    this.stopping = true
    try {
      await this.activating
      const result = await this.runtime.release()
      if (result.stopped) this.protocol = undefined
      if (result.forced) console.warn("[DeepSeek Harness] 官方 DSH 超时，已强制终止进程树")
    } finally {
      this.stopping = false
    }
  }

  private requireProtocol(): DeepSeekHarnessProtocol {
    if (!this.protocol || this.state === "stopping" || this.state === "stopped" || this.state === "crashed")
      throw new Error("官方 DSH 尚未就绪")
    return this.protocol
  }

  private requireRuntimeTarget(): DeepSeekHarnessRuntimeTarget {
    if (!this.runtimeTarget) throw new Error("当前平台不支持 ChipMate DeepSeek Harness")
    return this.runtimeTarget
  }

  private requireExpectedAgentPreset(): DeepSeekHarnessAgentPreset {
    if (!this.expectedAgentPreset) throw new Error("当前平台没有可用的官方 DSH Agent Preset 策略")
    return this.expectedAgentPreset
  }

  private receiveMux(data: string): void {
    const envelope = parseFrame(data)
    if (envelope) {
      const frame = unwrapFrame(envelope)
      const type = typeof frame.type === "string" ? frame.type : ""
      this.receiveSessionFrame(type, frame)
      if (type === "session/jobs" && Array.isArray(frame.jobs) && typeof frame.sessionId === "string") {
        this.setSessionRunning(frame.sessionId, frame.jobs.length > 0)
      }
    }
    for (const subscriber of this.eventSubscribers) subscriber("mux", { data }, this.connectionGeneration)
    this.broadcast()
  }

  private receiveSessionFrame(type: string, frame: DeepSeekHarnessFrame): void {
    if (type !== "session/event") return
    const event = frame.event as { type?: string } | undefined
    const started = event?.type === "turn/start" || event?.type === "step/start" || event?.type === "tool/call"
    if (typeof frame.sessionId === "string" && started) this.setSessionRunning(frame.sessionId, true)
    if (typeof frame.sessionId === "string" && event?.type === "turn/end")
      this.setSessionRunning(frame.sessionId, false)
  }

  private receiveHost(data: string): void {
    const envelope = parseFrame(data)
    if (envelope) {
      const frame = unwrapFrame(envelope)
      if (frame.type === "host/session-status") {
        if (typeof frame.sessionId === "string" && typeof frame.running === "boolean") {
          this.setSessionRunning(frame.sessionId, frame.running)
        }
      }
    }
    for (const subscriber of this.eventSubscribers) subscriber("host", { data }, this.connectionGeneration)
    this.broadcast()
  }

  private receivePlugin(frame: DeepSeekHarnessFrame): void {
    for (const subscriber of this.eventSubscribers) subscriber("plugins", { frame }, this.connectionGeneration)
  }

  private setSessionRunning(sessionId: string, running: boolean): void {
    if (running) this.runningSessions.add(sessionId)
    else this.runningSessions.delete(sessionId)
    this.running = this.runningSessions.size > 0
  }

  private markCrashed(error?: Error): void {
    if (this.state === "stopping" || this.state === "stopped") return
    this.protocol = undefined
    this.bootManifest = undefined
    this.connectedFingerprint = undefined
    this.deferredActivation = undefined
    this.clearReconnectWarning()
    this.rejectProjection(error ?? new Error("官方 DSH 事件连接已断开"))
    this.state = "crashed"
    this.runningSelection = undefined
    this.selectionState = "required"
    this.launchStage = undefined
    this.error = safeError(error ?? new Error("官方 DSH 事件连接已断开"))
    this.broadcast()
  }

  private snapshot(): DeepSeekHarnessSnapshot {
    return {
      state: this.state,
      launchStage: this.launchStage,
      active: this.active,
      taskId: this.taskId,
      sessionId: this.sessionId,
      sessions: this.sessions,
      expectedAgentPreset: this.expectedAgentPreset,
      agentPreset: this.agentPreset,
      presetState: this.presetState,
      readOnlySession: this.readOnlySession,
      models: this.models,
      selectedModel: this.selectedModel,
      providerOptions: this.providerOptions,
      desiredSelection: this.desiredSelection,
      runningSelection: this.runningSelection,
      selectionState: this.selectionState,
      bootManifest: this.bootManifest,
      connectionGeneration: this.connectionGeneration,
      reconnectAttempt: this.reconnectAttempt || undefined,
      running: this.running,
      error: this.error,
      forcedTermination: this.forcedTermination,
      logPath: this.runtime.logPath,
      transportLogPath: this.runtime.transportLogPath,
    }
  }

  private broadcast(): void {
    const snapshot = this.snapshot()
    for (const subscriber of this.subscribers) subscriber(snapshot)
  }

  private prepareRuntime(): Promise<InstalledDeepSeekHarnessRuntime> {
    this.preparing ??= this.runtime.prepareRuntime()
    const current = this.preparing
    return current.finally(() => {
      if (this.preparing === current) this.preparing = undefined
    })
  }

  private async projectCurrentSession(recovery = false): Promise<void> {
    const sessionId = this.sessionId
    if (!sessionId || !this.bootManifest) throw new Error("官方 DSH 会话或 Web 启动清单不可用")
    this.rejectProjection(new Error("官方客户端投影已被新任务替换"))
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((ok, fail) => {
      resolve = ok
      reject = fail
    })
    const pending = { sessionId, connectionGeneration: this.connectionGeneration, promise, resolve, reject }
    this.projection = pending
    this.state = recovery ? "resyncing-session" : "projecting-session"
    this.error = undefined
    this.broadcast()
    const timer = recovery
      ? undefined
      : setTimeout(() => reject(new Error("等待官方客户端会话投影超时（30 秒）")), 30_000)
    try {
      await promise
      if (this.projection !== pending) throw new Error("官方客户端投影已过期")
      this.state = this.restartRequired ? "restart-required" : "ready"
      if (!this.restartRequired && this.selectedModel) this.commitReadySelection(this.selectedModel, false)
      if (this.restartRequired) this.selectionState = "restart-required"
      this.launchStage = undefined
      this.reconnectAttempt = 0
      this.error = this.restartRequired ? this.restartReason : undefined
      this.clearReconnectWarning()
      this.broadcast()
    } finally {
      if (timer) clearTimeout(timer)
      if (this.projection === pending) this.projection = undefined
    }
  }

  private rejectProjection(error: Error): void {
    this.projection?.reject(error)
    this.projection = undefined
  }

  private handleRuntimePhase(state: DeepSeekHarnessSnapshot["state"]): void {
    if (this.state === "stopping" || this.state === "crashed") return
    if (state === "reconnecting-events") {
      if (this.reconnectCycle !== this.runtime.connectionCycle) {
        this.reconnectCycle = this.runtime.connectionCycle
        this.connectionGeneration += 1
        this.rejectProjection(new Error("官方 DSH 事件连接代次已切换"))
      }
      this.protocol = undefined
      this.launchStage = undefined
      this.state = state
      this.reconnectAttempt = this.runtime.reconnectAttempt
      this.error = `官方 DSH 事件连接中断，正在恢复（第 ${Math.max(1, this.reconnectAttempt)} 次）`
      this.scheduleReconnectWarning()
      this.broadcast()
      return
    }
    if (state === "resyncing-session") {
      this.protocol = this.runtime.currentProtocol
      this.launchStage = undefined
      this.state = state
      this.reconnectAttempt = this.runtime.reconnectAttempt
      this.error = undefined
      this.broadcast()
      const protocol = this.protocol
      if (protocol) void protocol.openPluginEvents().catch(() => undefined)
      if (this.sessionId && this.bootManifest)
        void this.projectCurrentSession(true)
          .then(() => this.applyDeferredActivation())
          .catch((error) => {
            if (this.state === "stopping" || this.state === "stopped" || this.state === "reconnecting-events") return
            const failure = error instanceof Error ? error : new Error(String(error))
            if (failure.message.includes("不存在")) this.markCrashed(failure)
            else {
              this.error = `官方会话仍在恢复：${safeError(failure)}`
              this.broadcast()
            }
          })
      return
    }
    this.launchStage = state
    this.state = state
    this.broadcast()
  }

  private async applyDeferredActivation(): Promise<void> {
    const request = this.deferredActivation
    if (!request || this.stopping || this.state !== "ready") return
    this.deferredActivation = undefined
    await this.activate(request.taskId, request.workspace, request.config, request.models, request.selected)
  }

  private scheduleReconnectWarning(): void {
    if (this.reconnectWarning) return
    this.reconnectWarning = setTimeout(() => {
      this.reconnectWarning = undefined
      if (this.state !== "reconnecting-events" && this.state !== "resyncing-session") return
      this.error = "官方 DSH 事件连接已连续 30 秒未恢复；将继续重连，也可以手动重新启动"
      this.broadcast()
    }, 30_000)
  }

  private clearReconnectWarning(): void {
    if (this.reconnectWarning) clearTimeout(this.reconnectWarning)
    this.reconnectWarning = undefined
  }

  private commitReadySelection(model: DeepSeekHarnessModel, shouldBroadcast = true): void {
    this.selectedModel = model
    this.desiredSelection = model
    this.runningSelection = model
    this.selectionState = "ready"
    const path = this.providerPreferencePath()
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      mkdirSync(join(this.context.globalStorageUri.fsPath, "deepseek-harness", "supervisor"), { recursive: true })
      writeFileSync(
        temporary,
        JSON.stringify({
          schemaVersion: 1,
          providerID: model.providerID,
          modelID: model.modelID,
          updatedAt: new Date().toISOString(),
        } satisfies ProviderPreference),
        { mode: 0o600 },
      )
      renameSync(temporary, path)
    } catch (error) {
      console.warn("[DeepSeek Harness] 无法保存脱敏 Provider 偏好：", safeError(error))
    }
    if (shouldBroadcast) this.broadcast()
  }

  private providerPreferencePath(): string {
    return join(
      this.context.globalStorageUri.fsPath,
      "deepseek-harness",
      "supervisor",
      "provider-preference.json",
    )
  }

  private isRelayRequestAllowed(path: string, method: "GET" | "POST"): boolean {
    let target: URL
    try {
      target = new URL(path, "http://127.0.0.1")
    } catch {
      return false
    }
    if (target.origin !== "http://127.0.0.1") return false
    const exact = `${target.pathname}${target.search}`
    if (method === "GET" && this.bootManifest?.entries.some((entry) => entry.url === exact)) return true
    if (method !== "POST" || !target.pathname.startsWith("/api/")) return false
    const name = target.pathname.slice("/api/".length)
    return RELAY_API_ALLOWLIST.has(name)
  }

  private mapping(taskId: string): StoredSessionMapping | undefined {
    const path = this.mappingPath(taskId)
    if (!existsSync(path)) return undefined
    try {
      const mapping = JSON.parse(readFileSync(path, "utf8")) as StoredSessionMapping
      if (![1, 2].includes(mapping.schemaVersion) || mapping.chipmateTaskId !== taskId)
        throw new Error("映射身份或版本不匹配")
      if (
        mapping.schemaVersion === 2 &&
        (!mapping.activeMappingKey ||
          !Array.isArray(mapping.sessions) ||
          !mapping.sessions.some((item) => item.mappingKey === mapping.activeMappingKey))
      )
        throw new Error("映射活动会话不存在")
      return mapping
    } catch (error) {
      throw new Error(`ChipMate DeepSeek Harness 任务映射已损坏：${safeError(error)}`)
    }
  }

  private async saveMapping(mapping: SessionMapping): Promise<void> {
    const path = this.mappingPath(mapping.chipmateTaskId)
    mkdirSync(join(this.context.globalStorageUri.fsPath, "deepseek-harness", "supervisor", "session-mappings"), {
      recursive: true,
      mode: 0o700,
    })
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(mapping, null, 2), { mode: 0o600 })
    renameSync(temporary, path)
  }

  private mappingPath(taskId: string): string {
    const name = createHash("sha256").update(taskId).digest("hex")
    return join(this.context.globalStorageUri.fsPath, "deepseek-harness", "supervisor", "session-mappings", `${name}.json`)
  }
}

const RELAY_API_ALLOWLIST = new Set([
  "host.describe",
  "respond",
  "session.list",
  "session.create",
  "session.history",
  "session.models",
  "session.selectModel",
  "session.prompt",
  "session.updateQueue",
  "session.cancel",
  "workspace.list",
])

async function verifyNewApi(config: DeepSeekHarnessConfig, selectedModel: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${config.baseURL.replace(/\/$/u, "")}/models`, {
      headers: { authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`NewAPI 模型检查失败（HTTP ${response.status}）`)
    const body = (await response.json()) as { data?: Array<{ id?: string }> }
    if (!body.data?.some((model) => model.id === selectedModel)) throw new Error("NewAPI 未返回所选 DeepSeek 模型")
  } finally {
    clearTimeout(timer)
  }
}

function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/(api[_-]?key|authorization)\s*[:=]\s*\S+/giu, "$1=[已脱敏]")
}

function matchingModel(
  models: readonly DeepSeekHarnessModel[],
  selection: DeepSeekHarnessModel | undefined,
): DeepSeekHarnessModel | undefined {
  if (!selection) return
  return models.find(
    (model) => model.providerID === selection.providerID && model.modelID === selection.modelID,
  )
}

function isRuntimeIntegrityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /DSH_HOME|运行时被外部修改|运行时版本|完整性|web Profile/iu.test(message)
}

function activationFailureState(error: unknown): DeepSeekHarnessSnapshot["state"] {
  if (error instanceof DeepSeekHarnessPresetUnavailableError) return "preset-unavailable"
  if (error instanceof Error && error.message.includes("需要重启")) return "restart-required"
  if (isRuntimeIntegrityError(error)) return "runtime-unavailable"
  return "crashed"
}

function shouldDeferActivation(
  state: DeepSeekHarnessSnapshot["state"],
  connected: string | undefined,
  fingerprint: string,
): boolean {
  return connected === fingerprint && (state === "reconnecting-events" || state === "resyncing-session")
}

function isReadOnlyMutation(path: string, viewingHistory: boolean): boolean {
  const name = new URL(path, "http://127.0.0.1").pathname.slice("/api/".length)
  if (["session.prompt", "session.updateQueue", "session.selectModel"].includes(name)) return true
  return viewingHistory && ["session.cancel", "respond"].includes(name)
}

function unwrapFrame(envelope: DeepSeekHarnessFrame): DeepSeekHarnessFrame {
  if (envelope.type !== "server-request" || !envelope.payload || typeof envelope.payload !== "object") return envelope
  return envelope.payload as DeepSeekHarnessFrame
}

function parseFrame(data: string): DeepSeekHarnessFrame | undefined {
  try {
    const value = JSON.parse(data)
    return value && typeof value === "object" ? (value as DeepSeekHarnessFrame) : undefined
  } catch {
    return undefined
  }
}

const services = new Set<DeepSeekHarnessService>()

export function getDeepSeekHarnessService(context: vscode.ExtensionContext): DeepSeekHarnessService {
  const service = new DeepSeekHarnessService(context)
  services.add(service)
  return service
}

export async function disposeDeepSeekHarnessService(): Promise<void> {
  const current = [...services]
  services.clear()
  await Promise.all(current.map((service) => service.dispose()))
}
