import { Component, For, ParentComponent, createMemo, createSignal, createEffect, on, Show } from "solid-js"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { Button } from "@kilocode/kilo-ui/button"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useConfig } from "../../context/config"
import { useSession } from "../../context/session"
import ModelsTab from "./ModelsTab"
import ProvidersTab from "./ProvidersTab"
import ChipmateServerTab, { type ChipmateServerTabProps } from "./ChipmateServerTab"
import AgentBehaviourTab from "./AgentBehaviourTab"
import AutoApproveTab from "./AutoApproveTab"
import BrowserTab from "./BrowserTab"
import CheckpointsTab from "./CheckpointsTab"
import DisplayTab from "./DisplayTab"
import AutocompleteTab from "./AutocompleteTab"
import NotificationsTab from "./NotificationsTab"
import ContextTab from "./ContextTab"

import CommitMessageTab from "./CommitMessageTab"
import ExperimentalTab from "./ExperimentalTab"
import LanguageTab from "./LanguageTab"
import AboutKiloCodeTab from "./AboutKiloCodeTab"
import IndexingTab from "./IndexingTab"
import SandboxingTab from "./SandboxingTab"
import * as Sandboxing from "./sandboxing"
import { useServer } from "../../context/server"
import { isInternalOfflineBuild } from "../../../../src/shared/internal-offline"
import { ChipMateLogo } from "../shared/ChipMateLogo"
import type { MigrationSource } from "../../types/messages"

export interface SettingsProps {
  tab?: string
  onTabChange?: (tab: string) => void
  onClose?: () => void
  onMigrationClick?: (source: MigrationSource) => void // legacy-migration
  chipmatePreview?: ChipmateServerTabProps["preview"]
  navPreview?: string
}

type Item = {
  id: string
  key: string
  icon: string
  show?: "public" | "indexing" | "sandboxing"
}

const tabs: readonly Item[] = [
  { id: "models", key: "settings.models.title", icon: "package" },
  { id: "providers", key: "settings.providers.title", icon: "plug" },
  { id: "chipmateServer", key: "settings.chipmateServer.title", icon: "server" },
  { id: "agentBehaviour", key: "settings.agentBehaviour.title", icon: "hubot" },
  { id: "autoApprove", key: "settings.autoApprove.title", icon: "shield" },
  { id: "browser", key: "settings.browser.title", icon: "globe" },
  { id: "checkpoints", key: "settings.checkpoints.title", icon: "bookmark" },
  { id: "display", key: "settings.display.title", icon: "device-desktop" },
  { id: "autocomplete", key: "settings.autocomplete.title", icon: "code" },
  { id: "notifications", key: "settings.notifications.title", icon: "bell", show: "public" },
  { id: "context", key: "settings.context.title", icon: "notebook" },
  { id: "commitMessage", key: "settings.commitMessage.title", icon: "comment" },
  { id: "indexing", key: "settings.indexing.title", icon: "database", show: "indexing" },
  { id: "experimental", key: "settings.experimental.title", icon: "beaker" },
  { id: "sandboxing", key: "settings.sandboxing.title", icon: "shield", show: "sandboxing" },
  { id: "language", key: "settings.language.title", icon: "symbol-text" },
  { id: "aboutKiloCode", key: "settings.aboutKiloCode.title", icon: "info" },
]

const Codicon: Component<{ name: string }> = (props) => <i class={`codicon codicon-${props.name}`} aria-hidden="true" />

const Panel: ParentComponent<{ title: string }> = (props) => (
  <>
    <div class="settings-page-header" data-ui="settings-page-title">
      <h3>{props.title}</h3>
    </div>
    <div class="settings-page-groups" data-ui="settings-groups">
      {props.children}
    </div>
  </>
)

const Settings: Component<SettingsProps> = (props) => {
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const { isDirty, saving, canSave, saveError, saveConfig, discardConfig, features } = useConfig()
  const session = useSession()
  const [active, setActive] = createSignal(props.tab ?? "models")
  const [errorExpanded, setErrorExpanded] = createSignal(false)
  const internal = isInternalOfflineBuild()
  const sandboxing = createMemo(() => Sandboxing.visible(features()))
  const visible = () =>
    tabs.filter((item) => {
      if (item.show === "public") return !internal
      if (item.show === "indexing") return features().indexing
      if (item.show === "sandboxing") return sandboxing()
      return true
    })

  const busyCount = () => Object.values(session.allStatusMap()).filter((s) => s.type === "busy").length

  const handleSave = () => {
    const busy = busyCount()
    if (busy === 0) {
      saveConfig()
      return
    }
    const msg = busy === 1 ? language.t("settings.saveBar.warning.one") : language.t("settings.saveBar.warning.many")
    showToast({
      variant: "error",
      title: msg,
      persistent: true,
      actions: [
        { label: language.t("settings.saveBar.saveAnyway"), onClick: saveConfig },
        { label: language.t("settings.saveBar.cancel"), onClick: "dismiss" },
      ],
    })
  }

  const open = (scope: "local" | "global") => {
    const label =
      scope === "global" ? language.t("settings.config.scope.global") : language.t("settings.config.scope.local")
    vscode.postMessage({
      type: "openConfigFile",
      scope,
      labels: {
        scope: label,
        statusLoaded: language.t("settings.config.status.loaded"),
        statusLoadedLegacy: language.t("settings.config.status.loadedLegacy"),
        statusNotLoaded: language.t("settings.config.status.notLoaded"),
        statusCreate: language.t("settings.config.status.create"),
        title: language.t("settings.config.title", { scope: label }),
        placeholder: language.t("settings.config.placeholder"),
        noWorkspace: language.t("settings.config.noWorkspace"),
        openFailed: language.t("settings.config.openFailed", { scope: label, message: "{{message}}" }),
        sourceXdg: language.t("settings.config.source.xdg"),
        sourceHomeKilo: language.t("settings.config.source.homeKilo"),
        sourceHomeKilocode: language.t("settings.config.source.homeKilocode"),
        sourceHomeOpencode: language.t("settings.config.source.homeOpencode"),
        sourceEnvFile: language.t("settings.config.source.envFile"),
        sourceEnvDir: language.t("settings.config.source.envDir"),
        sourceEnvContent: language.t("settings.config.source.envContent"),
        sourceProjectKilo: language.t("settings.config.source.projectKilo"),
        sourceProjectRoot: language.t("settings.config.source.projectRoot"),
        sourceProjectKilocode: language.t("settings.config.source.projectKilocode"),
        sourceProjectOpencode: language.t("settings.config.source.projectOpencode"),
      },
    })
  }

  // Sync when the parent changes the tab prop (e.g. via navigate message)
  createEffect(
    on(
      () => props.tab,
      (tab) => {
        if (tab) setActive(tab)
      },
    ),
  )

  createEffect(() => {
    if (features().indexing || active() !== "indexing") return
    onTabChange("providers")
  })

  createEffect(() => {
    if (!internal || active() !== "notifications") return
    onTabChange("providers")
  })

  createEffect(() => {
    if (sandboxing() || active() !== "sandboxing") return
    onTabChange("experimental")
  })

  const onTabChange = (tab: string) => {
    setActive(tab)
    props.onTabChange?.(tab)
    vscode.postMessage({ type: "settingsTabChanged", tab })
  }

  return (
    <div class="settings-frame" data-ui="settings-frame">
      <div class="settings-shell" data-ui="settings-shell" data-preview-nav={props.navPreview}>
        <header class="settings-header" data-ui="settings-header">
          <div class="settings-brand">
            <ChipMateLogo class="settings-brand-icon" welcome />
            <h2>{language.t("sidebar.settings")}</h2>
          </div>
          <div class="settings-header-actions">
            <Button variant="secondary" size="small" onClick={() => open("local")}>
              {language.t("settings.openLocalConfig")}
            </Button>
            <Button variant="secondary" size="small" onClick={() => open("global")}>
              {language.t("settings.openGlobalConfig")}
            </Button>
            <Button
              variant="secondary"
              size="small"
              class="settings-close-button"
              onClick={() => props.onClose?.()}
              aria-label={language.t("settings.close")}
              title={language.t("settings.close")}
            >
              <Codicon name="close" />
            </Button>
          </div>
        </header>

        <div class="settings-main" data-ui="settings-main">
          <Tabs
            orientation="vertical"
            variant="settings"
            value={active()}
            onChange={onTabChange}
            class="settings-tabs"
            data-ui="settings-layout"
          >
            <Tabs.List data-ui="settings-navigation" aria-label={language.t("sidebar.settings")}>
              <For each={visible()}>
                {(item) => {
                  const label = () => language.t(item.key)
                  return (
                    <Tabs.Trigger value={item.id} title={label()} aria-label={label()} data-ui="settings-nav-item">
                      <span class="settings-nav-icon" data-ui="settings-nav-icon">
                        <Codicon name={item.icon} />
                      </span>
                      <span class="label">{label()}</span>
                    </Tabs.Trigger>
                  )
                }}
              </For>
            </Tabs.List>

            <Tabs.Content value="models" data-ui="settings-content">
              <Panel title={language.t("settings.models.title")}>
                <ModelsTab />
              </Panel>
            </Tabs.Content>
            <Tabs.Content value="providers" data-ui="settings-content">
              <Panel title={language.t("settings.providers.title")}>
                <ProvidersTab />
              </Panel>
            </Tabs.Content>
            <Tabs.Content value="chipmateServer" data-ui="settings-content">
              <Panel title={language.t("settings.chipmateServer.title")}>
                <ChipmateServerTab preview={props.chipmatePreview} />
              </Panel>
            </Tabs.Content>
            <Tabs.Content value="agentBehaviour" data-ui="settings-content">
              <Panel title={language.t("settings.agentBehaviour.title")}>
                <AgentBehaviourTab />
              </Panel>
            </Tabs.Content>
            <Tabs.Content value="autoApprove" data-ui="settings-content">
              <Panel title={language.t("settings.autoApprove.title")}>
                <AutoApproveTab />
              </Panel>
            </Tabs.Content>
            <Tabs.Content value="browser" data-ui="settings-content">
              <Panel title={language.t("settings.browser.title")}>
                <BrowserTab />
              </Panel>
            </Tabs.Content>
            <Tabs.Content value="checkpoints" data-ui="settings-content">
              <Panel title={language.t("settings.checkpoints.title")}>
                <CheckpointsTab />
              </Panel>
            </Tabs.Content>
            <Tabs.Content value="display" data-ui="settings-content">
              <Panel title={language.t("settings.display.title")}>
                <DisplayTab />
              </Panel>
            </Tabs.Content>
            <Tabs.Content value="autocomplete" data-ui="settings-content">
              <Panel title={language.t("settings.autocomplete.title")}>
                <AutocompleteTab onNavigateToModels={() => onTabChange("models")} />
              </Panel>
            </Tabs.Content>
            <Show when={!internal}>
              <Tabs.Content value="notifications" data-ui="settings-content">
                <Panel title={language.t("settings.notifications.title")}>
                  <NotificationsTab />
                </Panel>
              </Tabs.Content>
            </Show>
            <Tabs.Content value="context" data-ui="settings-content">
              <Panel title={language.t("settings.context.title")}>
                <ContextTab />
              </Panel>
            </Tabs.Content>
            <Tabs.Content value="commitMessage" data-ui="settings-content">
              <Panel title={language.t("settings.commitMessage.title")}>
                <CommitMessageTab />
              </Panel>
            </Tabs.Content>
            <Show when={features().indexing}>
              <Tabs.Content value="indexing" data-ui="settings-content">
                <Panel title={language.t("settings.indexing.title")}>
                  <IndexingTab />
                </Panel>
              </Tabs.Content>
            </Show>
            <Tabs.Content value="experimental" data-ui="settings-content">
              <Panel title={language.t("settings.experimental.title")}>
                <ExperimentalTab />
              </Panel>
            </Tabs.Content>
            <Show when={sandboxing()}>
              <Tabs.Content value="sandboxing" data-ui="settings-content">
                <Panel title={language.t("settings.sandboxing.title")}>
                  <SandboxingTab />
                </Panel>
              </Tabs.Content>
            </Show>
            <Tabs.Content value="language" data-ui="settings-content">
              <Panel title={language.t("settings.language.title")}>
                <LanguageTab />
              </Panel>
            </Tabs.Content>
            <Tabs.Content value="aboutKiloCode" data-ui="settings-content">
              <Panel title={language.t("settings.aboutKiloCode.title")}>
                <AboutKiloCodeTab
                  port={server.serverInfo()?.port ?? null}
                  connectionState={server.connectionState()}
                  extensionVersion={server.extensionVersion()}
                  onMigrationClick={props.onMigrationClick}
                />
              </Panel>
            </Tabs.Content>
          </Tabs>
        </div>

        <Show when={isDirty()}>
          <div class="settings-save-bar-wrap" data-ui="settings-save-bar">
            <Show when={saveError()}>
              {(err) => (
                <div class="settings-save-bar-error">
                  <div
                    class="settings-save-bar-error-header"
                    onClick={() => setErrorExpanded((v) => !v)}
                    role="button"
                    aria-expanded={errorExpanded()}
                  >
                    <span
                      class={`settings-save-bar-error-chevron${
                        errorExpanded() ? " settings-save-bar-error-chevron-expanded" : ""
                      }`}
                    >
                      <Codicon name="chevron-right" />
                    </span>
                    <span class="settings-save-bar-error-title">
                      {language.t("settings.saveBar.saveFailed")}:{" "}
                      <span class="settings-save-bar-error-firstline">{err().message}</span>
                    </span>
                  </div>
                  <Show when={errorExpanded()}>
                    <pre class="settings-save-bar-error-details">{err().details ?? err().message}</pre>
                  </Show>
                </div>
              )}
            </Show>
            <div class="settings-save-bar">
              <span class="settings-save-bar-label">{language.t("settings.saveBar.unsavedChanges")}</span>
              <Button
                class="settings-discard-button"
                variant="secondary"
                size="small"
                onClick={discardConfig}
                disabled={saving()}
              >
                {language.t("settings.saveBar.discard")}
              </Button>
              <Button
                class="settings-save-button"
                variant="primary"
                size="small"
                onClick={handleSave}
                disabled={saving() || !canSave()}
              >
                {saving() ? language.t("settings.saveBar.saving") : language.t("settings.saveBar.save")}
              </Button>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}

export default Settings
