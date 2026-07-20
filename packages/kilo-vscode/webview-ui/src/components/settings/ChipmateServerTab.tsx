import { Component, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Button } from "@kilocode/kilo-ui/button"
import { Switch } from "@kilocode/kilo-ui/switch"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import type { LanguageContextValue } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import SettingsRow from "./SettingsRow"
import {
  CHIPMATE_SERVER_KEY,
  isCurrentChipmateServerTest,
  normalizeChipmateServerBaseUrl,
  type ChipmateServerState,
  type ChipmateServerTestResult,
} from "../../../../src/shared/chipmate-server"

const UPDATE_AUTO_INSTALL_KEY = "updateCheck.autoInstall"

export interface ChipmateServerTabProps {
  preview?: {
    value?: string
    state?: ChipmateServerState
    result?: ChipmateServerTestResult
    testing?: boolean
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
  const [request, setRequest] = createSignal<string | undefined>(
    props.preview?.testing ? "storybook-preview" : undefined,
  )
  const [result, setResult] = createSignal<ChipmateServerTestResult | undefined>(props.preview?.result)

  const value = () => String(props.preview?.value ?? settings()[CHIPMATE_SERVER_KEY] ?? state()?.baseUrl ?? "")
  const ready = () => props.preview?.value !== undefined || settings()[CHIPMATE_SERVER_KEY] !== undefined || Boolean(state())
  const autoInstall = () => settings()[UPDATE_AUTO_INSTALL_KEY] !== false
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
    if (message.type !== "chipmateServerTestResult" || !isCurrentChipmateServerTest(request(), message.requestId))
      return
    setRequest(undefined)
    setResult(message.result)
  })
  onCleanup(unsubscribe)
  vscode.postMessage({ type: "requestChipmateServerSettings" })

  const change = (next: string) => {
    updateSetting(CHIPMATE_SERVER_KEY, next)
    setResult(undefined)
    setRequest(undefined)
  }

  const test = () => {
    if (!ready() || error() || request()) return
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    setRequest(id)
    setResult(undefined)
    vscode.postMessage({ type: "testChipmateServer", baseUrl: value(), requestId: id })
  }

  const status = () => {
    if (error()) return { kind: "error", text: language.t("settings.chipmateServer.status.invalid") }
    if (request()) return { kind: "testing", text: language.t("settings.chipmateServer.status.testing") }
    const tested = result()
    if (tested) return testStatus(tested, language.t)
    if (state()?.source === "invalid") {
      return { kind: "error", text: language.t("settings.chipmateServer.status.savedInvalid") }
    }
    if (state()?.source === "conflict") {
      return { kind: "warning", text: language.t("settings.chipmateServer.status.conflict") }
    }
    if (state()?.source === "migrated") {
      return { kind: "success", text: language.t("settings.chipmateServer.status.migrated") }
    }
    return undefined
  }

  return (
    <div class="chipmate-server-page" data-ui="chipmate-server-page">
      <p class="chipmate-server-intro" data-ui="chipmate-server-description">
        {language.t("settings.chipmateServer.description")}
      </p>
      <Card class="chipmate-server-card" data-ui="chipmate-server-form">
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
            disabled={!ready() || Boolean(error()) || Boolean(request())}
            data-ui="chipmate-server-test"
          >
            {request()
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
                  <Codicon
                    name={
                      item().kind === "success"
                        ? "check"
                        : item().kind === "testing"
                          ? "sync"
                          : item().kind === "error"
                            ? "error"
                            : "warning"
                    }
                    spin={item().kind === "testing"}
                  />
                  <span>{item().text}</span>
                </div>
              )}
            </Show>
          </div>
        </div>
      </Card>
      <Card class="chipmate-server-card" data-ui="chipmate-server-update">
        <SettingsRow
          title={language.t("settings.chipmateServer.autoUpdate.title")}
          description={language.t("settings.chipmateServer.autoUpdate.description")}
          last
        >
          <Switch
            checked={autoInstall()}
            onChange={(checked: boolean) => updateSetting(UPDATE_AUTO_INSTALL_KEY, checked)}
            hideLabel
          >
            {language.t("settings.chipmateServer.autoUpdate.title")}
          </Switch>
        </SettingsRow>
      </Card>
      <div id="chipmate-server-reload" class="chipmate-server-reload" data-ui="chipmate-server-hint">
        <Codicon name="window" />
        <span>{language.t("settings.chipmateServer.reloadHint")}</span>
      </div>
    </div>
  )
}

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

export default ChipmateServerTab
