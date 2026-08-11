import { Component, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { Card } from "@chipmate/chipmate-ui/card"
import { TextField } from "@chipmate/chipmate-ui/text-field"
import { Button } from "@chipmate/chipmate-ui/button"
import { Switch } from "@chipmate/chipmate-ui/switch"
import { Markdown } from "@chipmate/chipmate-ui/markdown"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import type { LanguageContextValue } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import {
  CHIPMATE_SERVER_KEY,
  isCurrentChipmateServerTest,
  normalizeChipmateServerBaseUrl,
  type ChipmateServerState,
  type ChipmateServerTestResult,
} from "../../../../src/shared/chipmate-server"
import { sanitize, type ChipmateUpdateResult } from "../../../../src/shared/update-check"

const UPDATE_AUTO_INSTALL_KEY = "updateCheck.autoInstall"

type Phase = "idle" | "checking" | "installing"

export interface ChipmateServerTabProps {
  preview?: {
    value?: string
    state?: ChipmateServerState
    result?: ChipmateServerTestResult
    testing?: boolean
    update?: ChipmateUpdateResult
    updatePhase?: Exclude<Phase, "idle">
    notesExpanded?: boolean
  }
}

const Codicon: Component<{ name: string; spin?: boolean }> = (props) => (
  <i class={`codicon codicon-${props.name}${props.spin ? " codicon-modifier-spin" : ""}`} aria-hidden="true" />
)

const ChipmateServerTab: Component<ChipmateServerTabProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const { settings, updateSetting } = useConfig()
  const [state, setState] = createSignal<ChipmateServerState | undefined>(props.preview?.state)
  const [testRequest, setTestRequest] = createSignal<string | undefined>(
    props.preview?.testing ? "storybook-preview" : undefined,
  )
  const [result, setResult] = createSignal<ChipmateServerTestResult | undefined>(props.preview?.result)
  const [phase, setPhase] = createSignal<Phase>(props.preview?.updatePhase ?? "idle")
  const [update, setUpdate] = createSignal<ChipmateUpdateResult | undefined>(props.preview?.update)
  const [candidate, setCandidate] = createSignal<Extract<ChipmateUpdateResult, { status: "available" }> | undefined>(
    props.preview?.update?.status === "available" ? props.preview.update : undefined,
  )
  const [updateRequest, setUpdateRequest] = createSignal<string | undefined>()
  const [action, setAction] = createSignal<"check" | "install">("check")
  const [expanded, setExpanded] = createSignal(Boolean(props.preview?.notesExpanded))

  const value = () => String(props.preview?.value ?? settings()[CHIPMATE_SERVER_KEY] ?? state()?.baseUrl ?? "")
  const ready = () =>
    props.preview?.value !== undefined || settings()[CHIPMATE_SERVER_KEY] !== undefined || Boolean(state())
  const error = createMemo(() => {
    if (!ready()) return undefined
    try {
      normalizeChipmateServerBaseUrl(value())
      return undefined
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  })

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "chipmateServerSettingsLoaded") {
      setState(message.state)
      return
    }
    if (message.type === "chipmateServerTestResult") {
      if (!isCurrentChipmateServerTest(testRequest(), message.requestId)) return
      setTestRequest(undefined)
      setResult(message.result)
      return
    }
    if (message.type !== "chipmateUpdateState" || message.requestId !== updateRequest()) return
    setUpdateRequest(undefined)
    setPhase("idle")
    setUpdate(message.result)
    if (message.result.status === "available") {
      setCandidate(message.result)
      setExpanded(false)
    }
  })
  onCleanup(unsubscribe)
  vscode.postMessage({ type: "requestChipmateServerSettings" })

  const change = (next: string) => {
    updateSetting(CHIPMATE_SERVER_KEY, next)
    setResult(undefined)
    setTestRequest(undefined)
    setUpdateRequest(undefined)
    setPhase("idle")
    setAction("check")
    setUpdate(undefined)
    setCandidate(undefined)
    setExpanded(false)
  }

  const test = () => {
    if (!ready() || error() || testRequest()) return
    const id = requestId()
    setTestRequest(id)
    setResult(undefined)
    vscode.postMessage({ type: "testChipmateServer", baseUrl: value(), requestId: id })
  }

  const check = () => {
    if (phase() !== "idle") return
    const id = requestId()
    setAction("check")
    setPhase("checking")
    setUpdateRequest(id)
    setExpanded(false)
    vscode.postMessage({ type: "checkChipmateUpdate", requestId: id })
  }

  const install = () => {
    const item = candidate()
    if (!item || phase() !== "idle") return
    const id = requestId()
    setAction("install")
    setPhase("installing")
    setUpdateRequest(id)
    vscode.postMessage({ type: "installChipmateUpdate", candidateId: item.candidateId, requestId: id })
  }

  const retry = () => {
    const item = update()
    if (item?.status === "error" && !item.retryable) {
      check()
      return
    }
    if (action() === "install" && candidate()) {
      install()
      return
    }
    check()
  }

  const status = () => serverStatus(error(), testRequest(), result(), state(), language.t)

  return (
    <div class="chipmate-server-page" data-ui="chipmate-server-page">
      <Card
        class="chipmate-server-card"
        data-ui="chipmate-server-form"
        data-setting-search-title={language.t("settings.chipmateServer.address.title")}
      >
        <div class="chipmate-server-label-row">
          <div class="chipmate-server-label-copy">
            <label for="chipmate-server-base-url">{language.t("settings.chipmateServer.address.title")}</label>
          </div>
        </div>
        <div class={`chipmate-server-control${error() ? " chipmate-server-control-error" : ""}`}>
          <div class="chipmate-server-input" data-ui="chipmate-server-input">
            <TextField
              id="chipmate-server-base-url"
              value={value()}
              label={language.t("settings.chipmateServer.address.title")}
              hideLabel
              spellcheck={false}
              autocomplete="off"
              placeholder={language.t("settings.chipmateServer.address.placeholder")}
              aria-description={language.t("settings.chipmateServer.address.description")}
              aria-invalid={Boolean(error())}
              aria-describedby="chipmate-server-status chipmate-server-reload"
              onChange={change}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === "Enter") test()
              }}
            />
          </div>
          <Button
            class="chipmate-server-test"
            variant="secondary"
            onClick={test}
            disabled={!ready() || Boolean(error()) || Boolean(testRequest())}
            data-ui="chipmate-server-test"
          >
            {testRequest()
              ? language.t("settings.chipmateServer.test.testing")
              : language.t("settings.chipmateServer.test.action")}
          </Button>
          <div class="chipmate-server-status-slot" data-ui="chipmate-server-status">
            <Show when={status()} fallback={<span class="chipmate-server-status-spacer" aria-hidden="true" />}>
              {(item) => (
                <div
                  id="chipmate-server-status"
                  class={`chipmate-server-status chipmate-server-status-${item().kind}`}
                  role={item().kind === "error" ? "alert" : "status"}
                  aria-live="polite"
                >
                  <Codicon name={statusIcon(item().kind)} spin={item().kind === "testing"} />
                  <span>{item().text}</span>
                </div>
              )}
            </Show>
          </div>
        </div>
      </Card>

      <UpdateCard
        phase={phase}
        update={update}
        candidate={candidate}
        expanded={expanded}
        toggle={() => setExpanded((value) => !value)}
        check={check}
        install={install}
        retry={retry}
      />
    </div>
  )
}

const UpdateCard: Component<{
  phase: () => Phase
  update: () => ChipmateUpdateResult | undefined
  candidate: () => Extract<ChipmateUpdateResult, { status: "available" }> | undefined
  expanded: () => boolean
  toggle: () => void
  check: () => void
  install: () => void
  retry: () => void
}> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const { settings, updateSetting } = useConfig()
  const [copied, setCopied] = createSignal(false)
  const autoInstall = () => settings()[UPDATE_AUTO_INSTALL_KEY] !== false
  const copy = (result: Extract<ChipmateUpdateResult, { status: "error" }>) => {
    const version = props.candidate()?.version
    const lines = [
      `时间：${new Date().toISOString()}`,
      `错误码：${result.code}`,
      ...(version ? [`候选版本：${version}`] : []),
      `错误信息：${safeError(result.message)}`,
    ]
    void navigator.clipboard.writeText(lines.join("\n")).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2_000)
      },
      () => setCopied(false),
    )
  }
  return (
    <Card class="chipmate-server-card chipmate-update-card" data-ui="chipmate-server-update">
      <div class="chipmate-update-heading">
        <div>
          <h3>{language.t("settings.chipmateServer.update.title")}</h3>
          <p>{language.t("settings.chipmateServer.update.description")}</p>
        </div>
        <Button
          class="chipmate-update-check"
          variant="secondary"
          onClick={props.check}
          disabled={props.phase() !== "idle"}
          data-ui="chipmate-update-check"
        >
          <Codicon name="sync" spin={props.phase() === "checking"} />
          <span>
            {props.phase() === "checking"
              ? language.t("settings.chipmateServer.update.checking")
              : language.t("settings.chipmateServer.update.check")}
          </span>
        </Button>
      </div>

      <div
        class="chipmate-update-auto"
        data-setting-search-title={language.t("settings.chipmateServer.autoUpdate.title")}
      >
        <div>
          <strong>{language.t("settings.chipmateServer.autoUpdate.title")}</strong>
          <span>{language.t("settings.chipmateServer.autoUpdate.description")}</span>
        </div>
        <Switch
          checked={autoInstall()}
          onChange={(checked: boolean) => updateSetting(UPDATE_AUTO_INSTALL_KEY, checked)}
          disabled={props.phase() === "installing"}
          hideLabel
        >
          {language.t("settings.chipmateServer.autoUpdate.title")}
        </Switch>
      </div>

      <Show when={props.phase() === "checking"}>
        <UpdateStatus
          icon="sync"
          spin
          kind="progress"
          title={language.t("settings.chipmateServer.update.checking")}
          detail={language.t("settings.chipmateServer.update.checkingDetail")}
        />
      </Show>
      <Show when={props.phase() === "installing"}>
        <UpdateStatus
          icon="loading"
          spin
          kind="progress"
          title={language.t("settings.chipmateServer.update.installing")}
          detail={language.t("settings.chipmateServer.update.installingDetail")}
        />
      </Show>
      <Show when={props.phase() === "idle" && props.update()?.status === "latest"}>
        <UpdateStatus
          icon="pass-filled"
          kind="latest"
          title={language.t("settings.chipmateServer.update.latest")}
          detail={`${language.t("settings.chipmateServer.update.currentVersion", {
            version: (props.update() as Extract<ChipmateUpdateResult, { status: "latest" }>).currentVersion,
          })} · ${checkedLabel(
            (props.update() as Extract<ChipmateUpdateResult, { status: "latest" }>).checkedAt,
            language.t,
          )}`}
        />
      </Show>
      <Show
        when={
          props.phase() === "idle" && props.update()?.status === "available"
            ? (props.update() as Extract<ChipmateUpdateResult, { status: "available" }>)
            : undefined
        }
      >
        {(value) => {
          const item = value
          return (
            <div class="chipmate-update-available" aria-live="polite" data-ui="chipmate-update-available">
              <div class="chipmate-update-icon chipmate-update-icon-available">
                <Codicon name="cloud-download" />
              </div>
              <div class="chipmate-update-copy">
                <strong>{language.t("settings.chipmateServer.update.available", { version: item().version })}</strong>
                <span>
                  {language.t("settings.chipmateServer.update.versionTransition", {
                    current: item().currentVersion,
                    latest: item().version,
                  })}
                </span>
                <span>{language.t("settings.chipmateServer.update.installDetail")}</span>
                <button
                  type="button"
                  class="chipmate-update-notes-toggle"
                  aria-expanded={props.expanded()}
                  onClick={props.toggle}
                >
                  <span>
                    {props.expanded()
                      ? language.t("settings.chipmateServer.update.notesHide")
                      : language.t("settings.chipmateServer.update.notesShow")}
                  </span>
                  <Codicon name={props.expanded() ? "chevron-up" : "chevron-down"} />
                </button>
                <Show when={props.expanded()}>
                  <div class="chipmate-update-notes" data-ui="chipmate-update-notes">
                    <div class="chipmate-update-notes-title">
                      <Codicon name="file" />
                      <strong>
                        {language.t("settings.chipmateServer.update.notesTitle", { version: item().version })}
                      </strong>
                    </div>
                    <Show
                      when={item().releaseNotes}
                      fallback={<p>{language.t("settings.chipmateServer.update.notesEmpty")}</p>}
                    >
                      {(notes) => <Markdown text={safeNotes(notes())} />}
                    </Show>
                    <p class="chipmate-update-notes-meta">
                      {publishedLabel(item().publishedAt, language.t)}
                      {" · "}
                      {language.t("settings.chipmateServer.update.currentPlatform")}
                    </p>
                  </div>
                </Show>
              </div>
              <Button class="chipmate-update-install" variant="primary" onClick={props.install}>
                <Codicon name="cloud-download" />
                <span>{language.t("settings.chipmateServer.update.install")}</span>
              </Button>
            </div>
          )
        }}
      </Show>
      <Show when={props.phase() === "idle" && props.update()?.status === "installed"}>
        <div class="chipmate-update-result-row" aria-live="polite">
          <UpdateStatus
            icon="check-all"
            kind="latest"
            title={language.t("settings.chipmateServer.update.installed")}
            detail={language.t("settings.chipmateServer.update.installedDetail", {
              version: (props.update() as Extract<ChipmateUpdateResult, { status: "installed" }>).version,
            })}
          />
          <Button variant="primary" onClick={() => vscode.postMessage({ type: "reloadChipmateWindow" })}>
            <Codicon name="window" />
            <span>{language.t("settings.chipmateServer.update.reload")}</span>
          </Button>
        </div>
      </Show>
      <Show when={props.phase() === "idle" && props.update()?.status === "error"}>
        <div class="chipmate-update-error" aria-live="assertive" data-ui="chipmate-update-error">
          {(() => {
            const result = props.update() as Extract<ChipmateUpdateResult, { status: "error" }>
            return (
              <>
                <UpdateStatus
                  icon="error"
                  kind="error"
                  title={updateErrorTitle(result, language.t)}
                  detail={updateError(result, language.t)}
                />
                <div class="chipmate-update-error-detail">
                  <span>
                    {language.t("settings.chipmateServer.update.errorCode", { code: result.code })}
                  </span>
                  <pre data-ui="chipmate-update-error-message">{safeError(result.message)}</pre>
                </div>
                <div class="chipmate-update-actions">
                  <Button variant="secondary" onClick={props.retry} data-ui="chipmate-update-retry">
                    <Codicon name="refresh" />
                    <span>{language.t("settings.chipmateServer.update.retry")}</span>
                  </Button>
                  <Button variant="secondary" onClick={() => copy(result)} data-ui="chipmate-update-copy-error">
                    <Codicon name={copied() ? "check" : "copy"} />
                    <span>
                      {copied()
                        ? language.t("settings.chipmateServer.update.copied")
                        : language.t("settings.chipmateServer.update.copyError")}
                    </span>
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => vscode.postMessage({ type: "showChipmateUpdateLog" })}
                    data-ui="chipmate-update-show-log"
                  >
                    <Codicon name="output" />
                    <span>{language.t("settings.chipmateServer.update.showLog")}</span>
                  </Button>
                </div>
              </>
            )
          })()}
        </div>
      </Show>

      <div id="chipmate-server-reload" class="chipmate-server-reload" data-ui="chipmate-server-hint">
        <Codicon name="window" />
        <span>{language.t("settings.chipmateServer.update.reloadHint")}</span>
      </div>
    </Card>
  )
}

const UpdateStatus: Component<{
  icon: string
  spin?: boolean
  kind: "latest" | "progress" | "error"
  title: string
  detail: string
}> = (props) => (
  <div
    class={`chipmate-update-status chipmate-update-status-${props.kind}`}
    role={props.kind === "error" ? "alert" : "status"}
  >
    <div class="chipmate-update-icon">
      <Codicon name={props.icon} spin={props.spin} />
    </div>
    <div>
      <strong>{props.title}</strong>
      <span>{props.detail}</span>
    </div>
  </div>
)

function testStatus(result: ChipmateServerTestResult, t: LanguageContextValue["t"]) {
  if (result.status === "success") {
    return { kind: "success", text: t("settings.chipmateServer.status.success") }
  }
  if (result.status === "warning") {
    return { kind: "warning", text: t("settings.chipmateServer.status.warning") }
  }
  const key = `settings.chipmateServer.status.${result.code}`
  return {
    kind: "error",
    text: t(key, { status: result.statusCode ?? "", message: result.message ?? "" }),
  }
}

function updateError(result: Extract<ChipmateUpdateResult, { status: "error" }>, t: LanguageContextValue["t"]) {
  if (result.code === "availability" || result.code === "server") {
    return t("settings.chipmateServer.update.error.server")
  }
  if (result.code === "download" || result.code === "install") {
    return t("settings.chipmateServer.update.error.action")
  }
  if (result.code === "download-size" || result.code === "download-hash" || result.code === "sha256") {
    return t("settings.chipmateServer.update.error.package")
  }
  return t("settings.chipmateServer.update.error.validation")
}

function updateErrorTitle(
  result: Extract<ChipmateUpdateResult, { status: "error" }>,
  t: LanguageContextValue["t"],
) {
  if (result.code === "install") return t("settings.chipmateServer.update.errorTitle.install")
  if (
    result.code === "download" ||
    result.code === "download-size" ||
    result.code === "download-hash" ||
    result.code === "sha256"
  ) {
    return t("settings.chipmateServer.update.errorTitle.download")
  }
  if (result.code === "availability" || result.code === "server") {
    return t("settings.chipmateServer.update.errorTitle.check")
  }
  return t("settings.chipmateServer.update.errorTitle.validation")
}

function safeError(value: string): string {
  return sanitize(value)
}

function serverStatus(
  invalid: string | undefined,
  request: string | undefined,
  result: ChipmateServerTestResult | undefined,
  state: ChipmateServerState | undefined,
  t: LanguageContextValue["t"],
) {
  if (invalid) return { kind: "error", text: t("settings.chipmateServer.status.invalid") }
  if (request) return { kind: "testing", text: t("settings.chipmateServer.status.testing") }
  if (result) return testStatus(result, t)
  if (state?.source === "invalid") return { kind: "error", text: t("settings.chipmateServer.status.savedInvalid") }
  if (state?.source === "conflict") return { kind: "warning", text: t("settings.chipmateServer.status.conflict") }
  if (state?.source === "migrated") return { kind: "success", text: t("settings.chipmateServer.status.migrated") }
  return undefined
}

function statusIcon(kind: string): string {
  if (kind === "success") return "check"
  if (kind === "testing") return "sync"
  if (kind === "error") return "error"
  return "warning"
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function checkedLabel(value: number, t: LanguageContextValue["t"]): string {
  if (Date.now() - value < 60_000) return t("settings.chipmateServer.update.justChecked")
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value)
}

function publishedLabel(value: string | undefined, t: LanguageContextValue["t"]): string {
  if (!value) return t("settings.chipmateServer.update.publishedUnknown")
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t("settings.chipmateServer.update.publishedUnknown")
  return t("settings.chipmateServer.update.publishedAt", {
    date: date.toISOString().slice(0, 10),
  })
}

function safeNotes(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "")
    .replaceAll("<", "&lt;")
}

export default ChipmateServerTab
