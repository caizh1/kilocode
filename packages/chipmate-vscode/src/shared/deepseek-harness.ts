export const DEEPSEEK_HARNESS_AGENT = "deepseek-harness"
export const DEEPSEEK_HARNESS_VERSION = "0.1.0-rc.6"
export const DEEPSEEK_HARNESS_NODE_VERSION = "24.19.0"
export const DEEPSEEK_HARNESS_PROTOCOL_VERSION = "0.0.1"
export const DEEPSEEK_HARNESS_PRESET_POLICY_VERSION = "platform-preset-v1"
export const DEEPSEEK_HARNESS_OFFICIAL_PROJECTION_READY = true
export const DEEPSEEK_HARNESS_RELEASE_VALIDATED = false

export interface DeepSeekHarnessBootEntry {
  id: string
  url: string
  rev: string
  inject?: string[]
  immediately?: boolean
}

export interface DeepSeekHarnessBootManifest {
  rev: string
  entries: DeepSeekHarnessBootEntry[]
}

export type DeepSeekHarnessState =
  | "stopped"
  | "installing-runtime"
  | "runtime-ready"
  | "acquiring-lock"
  | "checking-process"
  | "starting-supervisor"
  | "spawning-official-dsh"
  | "waiting-listen-address"
  | "describing-host"
  | "configuring-preset"
  | "configuring-provider"
  | "resolving-provider"
  | "provider-selection-required"
  | "switching-provider"
  | "provider-switch-confirmation-required"
  | "connecting-mux"
  | "connecting-host"
  | "reconnecting-events"
  | "resyncing-session"
  | "projecting-session"
  | "runtime-unavailable"
  | "preset-unavailable"
  | "ready"
  | "restart-required"
  | "stopping"
  | "crashed"

export interface DeepSeekHarnessModel {
  providerID: string
  modelID: string
  name: string
}

export type DeepSeekHarnessProviderUnavailableReason =
  | "missing-base-url"
  | "missing-api-key"
  | "unsupported-auth"
  | "auth-read-failed"

export interface DeepSeekHarnessProviderOption {
  providerID: string
  providerName: string
  available: boolean
  reason?: DeepSeekHarnessProviderUnavailableReason
  models: DeepSeekHarnessModel[]
}

export type DeepSeekHarnessSelectionState = "checking" | "required" | "ready" | "switching" | "restart-required"

export type DeepSeekHarnessAgentPreset = "standard" | "minimal"

export interface DeepSeekHarnessSession {
  sessionId: string
  mappingKey?: string
  agentPreset?: string
  readOnly?: boolean
  updatedAt?: string | number
  running?: boolean
  blank?: boolean
  cwd?: string
}

export interface DeepSeekHarnessSnapshot {
  state: DeepSeekHarnessState
  launchStage?: DeepSeekHarnessState
  active: boolean
  taskId?: string
  sessionId?: string
  expectedAgentPreset?: DeepSeekHarnessAgentPreset
  agentPreset?: string
  presetState?: "checking" | "ready" | "legacy-mismatch" | "unavailable"
  readOnlySession?: boolean
  sessions: DeepSeekHarnessSession[]
  models: DeepSeekHarnessModel[]
  selectedModel?: DeepSeekHarnessModel
  providerOptions: DeepSeekHarnessProviderOption[]
  desiredSelection?: DeepSeekHarnessModel
  runningSelection?: DeepSeekHarnessModel
  selectionState: DeepSeekHarnessSelectionState
  bootManifest?: DeepSeekHarnessBootManifest
  connectionGeneration: number
  reconnectAttempt?: number
  running: boolean
  error?: string
  forcedTermination?: boolean
  logPath?: string
  transportLogPath?: string
}

export type DeepSeekHarnessWebviewMessage =
  | {
      type: "chipmateDeepSeekHarness.activate"
      taskId: string
      preferredSelection?: Pick<DeepSeekHarnessModel, "providerID" | "modelID">
      /** @deprecated 一版兼容旧 Webview。扩展宿主仍会把它当作未验证偏好。 */
      providerID?: string
      /** @deprecated 一版兼容旧 Webview。扩展宿主仍会把它当作未验证偏好。 */
      modelID?: string
    }
  | { type: "chipmateDeepSeekHarness.deactivate" }
  | { type: "chipmateDeepSeekHarness.refresh" }
  | {
      type: "chipmateDeepSeekHarness.transport.request"
      taskId: string
      requestId: string
      connectionGeneration: number
      path: string
      method: "GET" | "POST"
      body?: string
    }
  | {
      type: "chipmateDeepSeekHarness.projectionReady"
      taskId: string
      sessionId: string
      connectionGeneration: number
    }
  | {
      type: "chipmateDeepSeekHarness.projectionFailed"
      taskId: string
      sessionId: string
      connectionGeneration: number
      error: string
    }
  | { type: "chipmateDeepSeekHarness.detached"; taskId: string }
  | {
      type: "chipmateDeepSeekHarness.modelSelected"
      providerID: string
      modelID: string
    }
  | {
      type: "chipmateDeepSeekHarness.selectionRequested"
      providerID: string
      modelID: string
    }
  | { type: "chipmateDeepSeekHarness.confirmProviderSwitch" }
  | { type: "chipmateDeepSeekHarness.cancelProviderSwitch" }
  | { type: "chipmateDeepSeekHarness.stop" }
  | { type: "chipmateDeepSeekHarness.restart" }
  | { type: "chipmateDeepSeekHarness.retryRuntime" }
  | { type: "chipmateDeepSeekHarness.createPreferredSession" }
  /** @deprecated 一版兼容别名；实际 preset 始终由扩展宿主的平台策略决定。 */
  | { type: "chipmateDeepSeekHarness.createMinimalSession" }
  | { type: "chipmateDeepSeekHarness.openMappedSession"; mappingKey: string }
  | { type: "chipmateDeepSeekHarness.returnToActiveSession" }

export type DeepSeekHarnessExtensionMessage =
  | { type: "chipmateDeepSeekHarness.connectionState"; snapshot: DeepSeekHarnessSnapshot }
  | {
      type: "chipmateDeepSeekHarness.transport.response"
      requestId: string
      status: number
      headers: Array<[string, string]>
      body: string
      error?: string
    }

export type DeepSeekHarnessEventMessage =
  | {
      type: "chipmateDeepSeekHarness.transport.downlink"
      channel: "mux" | "host"
      connectionGeneration: number
      data: string
    }
  | {
      type: "chipmateDeepSeekHarness.transport.downlink"
      channel: "plugins"
      connectionGeneration: number
      frame: unknown
    }

export function isDeepSeekHarnessMessage(value: unknown): value is DeepSeekHarnessWebviewMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      typeof value.type === "string" &&
      value.type.startsWith("chipmateDeepSeekHarness."),
  )
}

export function isDeepSeekModel(providerID: string, providerName: string, modelID: string, modelName: string): boolean {
  return `${providerID} ${providerName} ${modelID} ${modelName}`.toLowerCase().includes("deepseek")
}
