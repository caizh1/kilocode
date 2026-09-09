import { Button } from "@chipmate/chipmate-ui/button"
import { Card } from "@chipmate/chipmate-ui/card"
import { Switch } from "@chipmate/chipmate-ui/switch"
import { TextField } from "@chipmate/chipmate-ui/text-field"
import { Component, For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useDialog } from "@chipmate/chipmate-ui/context/dialog"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useVSCode } from "../../context/vscode"
import {
  PATENT_RADAR_SERVER_KEY,
  normalizePatentServerBaseUrl,
  type PatentCenterAction,
  type PatentCenterSettings,
  type PatentCenterTestResult,
} from "../../../../src/shared/patent-center"
import SettingsRow from "./SettingsRow"
import { ModelSelectorBase } from "../shared/ModelSelector"
import type { PatentRadarRun } from "../../../../src/patent-radar/types"
import PatentRadarProgressDialog from "./PatentRadarProgressDialog"
import { PatentCenterRequestGate } from "./patent-center-request-gate"

const DEFAULTS: PatentCenterSettings = {
  enabled: false,
  serverBaseUrl: "",
  scheduleDays: 7,
  analysisModel: null,
  uploadFullSnapshot: false,
}

const ACTIONS: Array<{ action: PatentCenterAction; icon: string; key: string }> = [
  { action: "scan", icon: "search-fuzzy", key: "scan" },
  { action: "scanModule", icon: "symbol-module", key: "scanModule" },
  { action: "manageModules", icon: "list-tree", key: "manageModules" },
  { action: "open", icon: "lightbulb", key: "open" },
  { action: "research", icon: "search", key: "research" },
  { action: "export", icon: "export", key: "export" },
  { action: "importReviews", icon: "cloud-upload", key: "importReviews" },
]

const PatentCenterTab: Component = () => {
  const language = useLanguage()
  const vscode = useVSCode()
  const provider = useProvider()
  const dialog = useDialog()
  const { settings, updateSetting } = useConfig()
  const [loaded, setLoaded] = createSignal<PatentCenterSettings>(DEFAULTS)
  const [testRequest, setTestRequest] = createSignal<string>()
  const [result, setResult] = createSignal<PatentCenterTestResult>()
  const [activity, setActivity] = createSignal<PatentRadarRun | null>(null)
  const [activityLoading, setActivityLoading] = createSignal(true)
  const [activityError, setActivityError] = createSignal<string>()
  const [scanActionLoading, setScanActionLoading] = createSignal(false)
  const [cancelRequest, setCancelRequest] = createSignal<string>()
  const activityRequests = new Map<string, number>()
  const actionRequests = new Map<string, { action: PatentCenterAction; sequence?: number }>()
  const requestGate = new PatentCenterRequestGate()
  let activitySequence = 0
  let appliedActivitySequence = 0

  const setting = <T,>(key: string, fallback: T): T => {
    const current = settings()[`patentRadar.${key}`]
    return (current === undefined ? loaded()[key as keyof PatentCenterSettings] : current) as T
  }
  const server = () => setting("serverBaseUrl", "")
  const availableModels = createMemo(() => {
    const connected = new Set(provider.connected())
    return provider.models().filter((model) => connected.has(model.providerID))
  })
  const analysisModel = createMemo(() => {
    const configured = setting<PatentCenterSettings["analysisModel"]>("analysisModel", null)
    if (configured && availableModels().some((model) => model.providerID === configured.providerID && model.id === configured.modelID)) {
      return configured
    }
    const fallback = provider.defaultSelection()
    if (fallback && availableModels().some((model) => model.providerID === fallback.providerID && model.id === fallback.modelID)) {
      return fallback
    }
    const first = availableModels()[0]
    return first ? { providerID: first.providerID, modelID: first.id } : null
  })
  const error = createMemo(() => {
    if (!server().trim()) return undefined
    try {
      normalizePatentServerBaseUrl(server())
      return undefined
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
  })

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "patentCenterSettingsLoaded") {
      setLoaded(message.settings)
      return
    }
    if (message.type === "patentRadarActivityLoaded") {
      const sequence = activityRequests.get(message.requestId)
      if (sequence === undefined) return
      activityRequests.delete(message.requestId)
      if (sequence <= appliedActivitySequence) return
      appliedActivitySequence = sequence
      setActivityLoading(false)
      setActivityError(message.error)
      setActivity(message.run)
      return
    }
    if (message.type === "patentRadarActionCompleted") {
      const request = actionRequests.get(message.requestId)
      if (!request || request.action !== message.action) return
      actionRequests.delete(message.requestId)
      if (request.sequence !== undefined && !requestGate.isLatestScan(request.sequence)) return
      if (request.sequence !== undefined) setScanActionLoading(false)
      appliedActivitySequence = Math.max(appliedActivitySequence, activitySequence)
      if (message.error) {
        setActivityLoading(false)
        setActivityError(message.error)
        return
      }
      if (message.run) {
        setActivity(message.run)
        setActivityLoading(false)
        setActivityError(undefined)
        return
      }
      if (message.cancelled) setActivityLoading(false)
      return
    }
    if (message.type === "patentRadarCancelCompleted") {
      if (!requestGate.completeCancel(message.requestId)) return
      setCancelRequest(undefined)
      appliedActivitySequence = ++activitySequence
      setActivityLoading(false)
      if (message.error) {
        setActivityError(message.error)
        poll()
        return
      }
      if (message.run) {
        setActivity(message.run)
        setActivityError(undefined)
      }
      poll()
      return
    }
    if (message.type !== "patentServerTestResult" || message.requestId !== testRequest()) return
    setTestRequest(undefined)
    setResult(message.result)
  })
  onCleanup(() => {
    activityRequests.clear()
    actionRequests.clear()
    unsubscribe()
  })
  function poll() {
    const requestId = id()
    const oldestRequest = activityRequests.size >= 60 ? activityRequests.keys().next().value : undefined
    if (oldestRequest) activityRequests.delete(oldestRequest)
    activityRequests.set(requestId, ++activitySequence)
    vscode.postMessage({ type: "requestPatentRadarActivity", requestId })
  }
  poll()
  const poller = window.setInterval(poll, 1000)
  onCleanup(() => window.clearInterval(poller))
  vscode.postMessage({ type: "requestPatentCenterSettings" })

  const update = (key: keyof PatentCenterSettings, value: unknown) => {
    updateSetting(`patentRadar.${key}`, value)
    if (key !== "serverBaseUrl") return
    setTestRequest(undefined)
    setResult(undefined)
  }
  const test = () => {
    if (!server().trim() || error() || testRequest()) return
    const requestId = id()
    setTestRequest(requestId)
    setResult(undefined)
    vscode.postMessage({ type: "testPatentServer", baseUrl: server(), requestId })
  }
  const showProgress = () =>
    dialog.show(() => (
      <PatentRadarProgressDialog
        run={activity}
        loading={activityLoading}
        cancelling={() => Boolean(cancelRequest())}
        error={activityError}
        model={() => {
          const selected = analysisModel()
          return selected ? `${selected.providerID} / ${selected.modelID}` : ""
        }}
        onCancel={(runId) => {
          if (cancelRequest()) return
          const requestId = id()
          if (!requestGate.beginCancel(requestId)) return
          setCancelRequest(requestId)
          setActivityError(undefined)
          vscode.postMessage({ type: "cancelPatentRadarRun", requestId, runId })
        }}
        onRestart={() => startScan()}
        onRetry={() => retryActivity()}
        onOpenCandidates={() => {
          dialog.close()
          run("open")
        }}
      />
    ))
  const startScan = () => {
    if (!analysisModel() || scanActionLoading()) return
    appliedActivitySequence = ++activitySequence
    setActivity(null)
    setActivityLoading(true)
    setScanActionLoading(true)
    setActivityError(undefined)
    const requestId = id()
    actionRequests.set(requestId, { action: "scan", sequence: requestGate.beginScan() })
    vscode.postMessage({
      type: "runPatentCenterAction",
      requestId,
      action: "scan",
      ...(analysisModel() ? { analysisModel: analysisModel()! } : {}),
    })
    poll()
  }
  const retryActivity = () => {
    setActivityLoading(true)
    setActivityError(undefined)
    poll()
  }
  const run = (action: PatentCenterAction) => {
    if (action === "scan" && activity()?.status === "SCANNING") {
      showProgress()
      return
    }
    if (action === "scan") {
      startScan()
      showProgress()
      return
    }
    if (action === "scanModule" && (activity()?.status === "SCANNING" || scanActionLoading())) {
      showProgress()
      return
    }
    const requestId = id()
    const sequence = action === "scanModule" ? requestGate.beginScan() : undefined
    if (sequence !== undefined) setScanActionLoading(true)
    actionRequests.set(requestId, { action, sequence })
    vscode.postMessage({
      type: "runPatentCenterAction",
      requestId,
      action,
      ...(action === "scanModule" && analysisModel() ? { analysisModel: analysisModel()! } : {}),
    })
  }

  return (
    <div class="patent-center-page" data-ui="patent-center-page">
      <Card class="patent-center-card patent-center-connection" data-ui="patent-center-connection">
        <div class="patent-center-card-heading">
          <div>
            <h3>{language.t("settings.patentCenter.connection.title")}</h3>
            <p>{language.t("settings.patentCenter.connection.description")}</p>
          </div>
          <span class="patent-center-privacy-badge">
            <i class="codicon codicon-lock" aria-hidden="true" />
            {language.t("settings.patentCenter.localOnly")}
          </span>
        </div>
        <div
          class={`patent-center-server-control${error() ? " patent-center-server-control-error" : ""}`}
          data-setting-search-title={language.t("settings.patentCenter.server.title")}
        >
          <TextField
            value={server()}
            label={language.t("settings.patentCenter.server.title")}
            hideLabel
            spellcheck={false}
            autocomplete="off"
            placeholder={language.t("settings.patentCenter.server.placeholder")}
            aria-invalid={Boolean(error())}
            onChange={(value) => update("serverBaseUrl", value)}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Enter") test()
            }}
          />
          <Button variant="secondary" onClick={test} disabled={!server().trim() || Boolean(error()) || Boolean(testRequest())}>
            <i class={`codicon codicon-${testRequest() ? "loading codicon-modifier-spin" : "plug"}`} aria-hidden="true" />
            {testRequest()
              ? language.t("settings.patentCenter.test.testing")
              : language.t("settings.patentCenter.test.action")}
          </Button>
        </div>
        <Show when={error()}>
          {(message) => <div class="patent-center-status patent-center-status-error" role="alert">{message()}</div>}
        </Show>
        <Show when={result()}>{(item) => <CorpusStatus result={item()} />}</Show>
      </Card>

      <Card class="patent-center-card">
        <div class="patent-center-card-heading">
          <div>
            <h3>{language.t("settings.patentCenter.automation.title")}</h3>
            <p>{language.t("settings.patentCenter.automation.description")}</p>
          </div>
        </div>
        <SettingsRow
          title={language.t("settings.patentCenter.enabled.title")}
          description={language.t("settings.patentCenter.enabled.description")}
        >
          <Switch checked={setting("enabled", false)} onChange={(value) => update("enabled", value)} hideLabel>
            {language.t("settings.patentCenter.enabled.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.patentCenter.schedule.title")}
          description={language.t("settings.patentCenter.schedule.description")}
        >
          <div class="patent-center-number">
            <input
              type="number"
              min="1"
              max="365"
              step="1"
              value={setting("scheduleDays", 7)}
              aria-label={language.t("settings.patentCenter.schedule.title")}
              onInput={(event) => {
                const value = Number(event.currentTarget.value)
                if (Number.isInteger(value) && value >= 1 && value <= 365) update("scheduleDays", value)
              }}
            />
            <span>{language.t("settings.patentCenter.schedule.unit")}</span>
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.patentCenter.analysisModel.title")}
          description={language.t("settings.patentCenter.analysisModel.description")}
        >
          <div class="patent-center-model-control">
            <div class="patent-center-model-selector">
              <ModelSelectorBase
                value={analysisModel()}
                onSelect={(providerID, modelID) => update("analysisModel", { providerID, modelID })}
                placement="bottom-end"
                models={availableModels()}
                favorites={false}
                emptyLabel={language.t("settings.patentCenter.analysisModel.empty")}
                label={language.t("settings.patentCenter.analysisModel.title")}
                description={language.t("settings.patentCenter.analysisModel.description")}
                showProviderName
                showConnectionStatus
              />
            </div>
            <span class="patent-center-model-helper">
              {language.t("settings.patentCenter.analysisModel.helper")}
            </span>
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.patentCenter.snapshot.title")}
          description={language.t("settings.patentCenter.snapshot.description")}
          last
        >
          <Switch
            checked={setting("uploadFullSnapshot", false)}
            onChange={(value) => update("uploadFullSnapshot", value)}
            hideLabel
          >
            {language.t("settings.patentCenter.snapshot.title")}
          </Switch>
        </SettingsRow>
      </Card>

      <Card class="patent-center-card">
        <div class="patent-center-card-heading">
          <div>
            <h3>{language.t("settings.patentCenter.actions.title")}</h3>
            <p>{language.t("settings.patentCenter.actions.description")}</p>
          </div>
        </div>
        <Show when={activityError()}>
          {(message) => (
            <div class="patent-center-status patent-center-status-error" role="alert">
              <div class="patent-center-status-title">
                <i class="codicon codicon-error" aria-hidden="true" />
                <strong>无法读取 Patent Radar 扫描状态</strong>
              </div>
              <span>{message()}</span>
              <Button variant="secondary" onClick={retryActivity}>重新读取</Button>
            </div>
          )}
        </Show>
        <Show when={activity()?.status === "SCANNING"}>
          <PatentRadarTaskStrip run={activity()!} onOpen={showProgress} />
        </Show>
        <div class="patent-center-actions">
          <For each={ACTIONS}>
            {(item) => (
              <Button
                variant={item.action === "scan" ? "primary" : "secondary"}
                onClick={() => run(item.action)}
                disabled={
                  ((item.action === "scan" || item.action === "scanModule") && (!analysisModel() || scanActionLoading())) ||
                  (item.action === "scanModule" && activity()?.status === "SCANNING")
                }
              >
                <i class={`codicon codicon-${item.icon}`} aria-hidden="true" />
                {item.action === "scan" && activity()?.status === "SCANNING"
                  ? "查看扫描进度"
                  : language.t(`settings.patentCenter.actions.${item.key}`)}
              </Button>
            )}
          </For>
        </div>
      </Card>
    </div>
  )
}

export const PatentRadarTaskStrip: Component<{ run: PatentRadarRun; onOpen: () => void }> = (props) => {
  const [clock, setClock] = createSignal(Date.now())
  const timer = window.setInterval(() => setClock(Date.now()), 1000)
  onCleanup(() => window.clearInterval(timer))
  const progress = () => props.run.progress
  const percent = () => (progress()?.totalUnits ? Math.min(100, (progress()!.completedUnits / progress()!.totalUnits) * 100) : 0)
  return (
    <div class="patent-radar-task-strip" data-ui="patent-radar-task-strip">
      <span class="patent-radar-live-dot is-active" aria-hidden="true" />
      <div class="patent-radar-task-copy">
        <strong>{patentPhaseText(progress()?.phase)} · 后台运行中</strong>
        <span>
          文件覆盖 {props.run.coverage?.analyzedFiles ?? 0} / {props.run.coverage?.supportedFiles ?? "—"} · 当前阶段 {progress()?.completedUnits ?? 0} / {progress()?.totalUnits ?? "—"} · 已运行 {elapsedText(progress()?.startedAt, clock())}
        </span>
        <div class="patent-radar-task-track"><span style={{ width: `${percent()}%` }} /></div>
        <small>关闭弹窗后任务仍会继续</small>
      </div>
      <Button variant="secondary" onClick={props.onOpen}>查看进度</Button>
    </div>
  )
}

function patentPhaseText(phase: NonNullable<PatentRadarRun["progress"]>["phase"] | undefined) {
  if (phase === "workspace-scan") return "正在清点工作区"
  if (phase === "scope-resolution") return "正在计算模块闭包"
  if (phase === "mechanism-distillation") return "正在提炼机制"
  if (phase === "relation-building") return "正在构建关系"
  if (phase === "bridge-discovery") return "正在发现跨文件组合"
  if (phase === "bridge-verification") return "正在复核原文"
  if (phase === "patent-research") return "正在检索专利"
  return "专利扫描"
}

function elapsedText(start: string | undefined, now: number) {
  if (!start) return "0 分 00 秒"
  const seconds = Math.max(0, Math.floor((now - new Date(start).getTime()) / 1000))
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`
}

const CorpusStatus: Component<{ result: PatentCenterTestResult }> = (props) => {
  const language = useLanguage()
  const corpus = () => props.result.corpus
  return (
    <div
      class={`patent-center-status patent-center-status-${props.result.status}`}
      role={props.result.status === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <div class="patent-center-status-title">
        <i
          class={`codicon codicon-${props.result.status === "success" ? "pass-filled" : props.result.status === "warning" ? "warning" : "error"}`}
          aria-hidden="true"
        />
        <strong>{statusText(props.result, language.t)}</strong>
      </div>
      <Show when={corpus()}>
        {(item) => (
          <div class="patent-center-metrics">
            <span>{language.t("settings.patentCenter.status.documents", { count: item().documents })}</span>
            <span>
              {language.t("settings.patentCenter.status.jurisdictions", {
                ready: item().readyJurisdictions,
                total: item().totalJurisdictions,
              })}
            </span>
            <span>
              {language.t("settings.patentCenter.status.vectorCoverage", {
                percent: Math.round(item().vectorCoverage * 100),
              })}
            </span>
            <Show when={item().generation}>
              {(generation) => <span>{language.t("settings.patentCenter.status.generation", { generation: generation() })}</span>}
            </Show>
            <Show when={item().quarantinedBatches > 0}>
              <span>{language.t("settings.patentCenter.status.quarantined", { count: item().quarantinedBatches })}</span>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}

function statusText(result: PatentCenterTestResult, t: (key: string, params?: Record<string, string | number>) => string) {
  if (result.code === "ok") return t("settings.patentCenter.status.ready")
  if (result.code === "not-ready") return t("settings.patentCenter.status.notReady", { state: result.corpus?.state ?? "" })
  if (result.code === "http") return t("settings.patentCenter.status.http", { status: result.statusCode ?? 0 })
  if (result.code === "timeout") return t("settings.patentCenter.status.timeout")
  if (result.code === "network") return t("settings.patentCenter.status.network")
  if (result.code === "identity") return t("settings.patentCenter.status.identity")
  if (result.code === "unhealthy") return t("settings.patentCenter.status.unhealthy")
  if (result.code === "invalid-json") return t("settings.patentCenter.status.invalidJson")
  return result.message ?? t("settings.patentCenter.status.invalid")
}

function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export default PatentCenterTab
