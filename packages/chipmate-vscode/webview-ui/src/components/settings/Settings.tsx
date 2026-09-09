import { Component, For, ParentComponent, createMemo, createSignal, createEffect, on, Show, type JSX } from "solid-js"
import { Tabs } from "@chipmate/chipmate-ui/tabs"
import { Button } from "@chipmate/chipmate-ui/button"
import { TextField } from "@chipmate/chipmate-ui/text-field"
import { showToast } from "@chipmate/chipmate-ui/toast"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useConfig } from "../../context/config"
import { useFutureSkin } from "../../hooks/useFutureSkin"
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
import AboutChipMateTab from "./AboutChipMateTab"
import IndexingTab from "./IndexingTab"
import PatentCenterTab from "./PatentCenterTab"
import SandboxingTab from "./SandboxingTab"
import * as Sandboxing from "./sandboxing"
import { useServer } from "../../context/server"
import { isInternalOfflineBuild } from "../../../../src/shared/internal-offline"
import { ChipMateLogo } from "../shared/ChipMateLogo"
import { PopupSelector } from "../shared/PopupSelector"
import { fields, match, type SettingSearchItem } from "./settings-search"

export interface SettingsProps {
  tab?: string
  onTabChange?: (tab: string) => void
  onClose?: () => void
  chipmatePreview?: ChipmateServerTabProps["preview"]
  navPreview?: string
}

type Item = {
  id: string
  key: string
  show?: "public" | "indexing" | "sandboxing"
}

type Group = {
  id: string
  key: string
  items: readonly Item[]
}

const groups: readonly Group[] = [
  {
    id: "connection",
    key: "settings.navigation.groups.connection",
    items: [
      { id: "models", key: "settings.models.title" },
      { id: "providers", key: "settings.providers.title" },
      { id: "chipmateServer", key: "settings.chipmateServer.title" },
      { id: "autocomplete", key: "settings.autocomplete.title" },
    ],
  },
  {
    id: "knowledge",
    key: "settings.navigation.groups.knowledge",
    items: [
      { id: "context", key: "settings.context.title" },
      { id: "indexing", key: "settings.indexing.title", show: "indexing" },
      { id: "patentCenter", key: "settings.patentCenter.title" },
      { id: "checkpoints", key: "settings.checkpoints.title" },
    ],
  },
  {
    id: "automation",
    key: "settings.navigation.groups.automation",
    items: [
      { id: "agentBehaviour", key: "settings.agentBehaviour.title" },
      { id: "autoApprove", key: "settings.autoApprove.title" },
      { id: "browser", key: "settings.browser.title" },
      { id: "sandboxing", key: "settings.sandboxing.title", show: "sandboxing" },
      { id: "commitMessage", key: "settings.commitMessage.title" },
      { id: "experimental", key: "settings.experimental.title" },
    ],
  },
  {
    id: "experience",
    key: "settings.navigation.groups.experience",
    items: [
      { id: "display", key: "settings.display.title" },
      { id: "notifications", key: "settings.notifications.title", show: "public" },
      { id: "language", key: "settings.language.title" },
      { id: "aboutChipMate", key: "settings.aboutChipMate.title" },
    ],
  },
]

const tabs = groups.flatMap((group) => group.items)
const optionId = (surface: "desktop" | "mobile", id: string) =>
  `settings-${surface}-option-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`

const Codicon: Component<{ name: string }> = (props) => <i class={`codicon codicon-${props.name}`} aria-hidden="true" />

const Panel: ParentComponent<{ title: string; description?: string; brand?: boolean }> = (props) => (
  <>
    <div
      class={`settings-page-header${props.brand ? " settings-page-header-brand" : ""}`}
      data-ui="settings-page-title"
    >
      <Show when={props.brand}>
        <ChipMateLogo class="settings-page-brand-icon" welcome />
      </Show>
      <div class="settings-page-header-copy">
        <h3>{props.title}</h3>
        <Show when={props.description}>{(description) => <p>{description()}</p>}</Show>
      </div>
    </div>
    <div class="settings-page-groups" data-ui="settings-groups">
      {props.children}
    </div>
  </>
)

const Settings: Component<SettingsProps> = (props) => {
  const night = useFutureSkin()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const { loading, isDirty, appearanceOnly, saving, canSave, saveError, saveConfig, discardConfig, features } =
    useConfig()
  const session = useSession()
  const [active, setActive] = createSignal(props.tab ?? "models")
  const [errorExpanded, setErrorExpanded] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [openNav, setOpenNav] = createSignal(false)
  const [focused, setFocused] = createSignal<string>()
  const [target, setTarget] = createSignal<SettingSearchItem>()
  const [notice, setNotice] = createSignal("")
  const internal = isInternalOfflineBuild()
  const sandboxing = createMemo(() => Sandboxing.visible(features()))
  const visible = createMemo(() =>
    tabs.filter((item) => {
      if (item.show === "public") return !internal
      if (item.show === "indexing") return features().indexing
      if (item.show === "sandboxing") return sandboxing()
      return true
    }),
  )
  const sections = createMemo(() => {
    const ids = new Set(visible().map((item) => item.id))
    return groups
      .map((group) => {
        const items = group.items.filter((item) => ids.has(item.id))
        return { ...group, items }
      })
      .filter((group) => group.items.length > 0)
  })
  const label = (id: string) => language.t(tabs.find((item) => item.id === id)?.key ?? "settings.models.title")
  const copy = (key: string | undefined, locale = language.locale()) => {
    if (!key) return ""
    const value = language.text(locale, key)
    return value === key ? "" : value
  }
  const group = (page: string) => groups.find((item) => item.items.some((entry) => entry.id === page))
  const page = (id: string) => tabs.find((item) => item.id === id)
  const pages = createMemo<SettingSearchItem[]>(() =>
    visible().map((item) => {
      const parent = group(item.id)
      const title = language.t(item.key)
      const heading = parent ? language.t(parent.key) : ""
      return {
        id: `page:${item.id}`,
        kind: "page",
        page: item.id,
        title,
        path: heading,
        description: undefined,
        aliases: [
          language.text("en", item.key),
          language.text("zh", item.key),
          ...(parent ? [language.text("en", parent.key), language.text("zh", parent.key)] : []),
        ],
        keys: [item.id, item.key],
      }
    }),
  )
  const sources = createMemo<SettingSearchItem[]>(() => {
    const ids = new Set(visible().map((item) => item.id))
    const rows = fields
      .filter((item) => ids.has(item.page))
      .map((item) => {
        const tab = page(item.page)
        const parent = group(item.page)
        const title = language.t(item.title)
        const description = copy(item.description) || undefined
        const terms = item.terms ?? []
        const keys = terms.filter((term) => /[._]/.test(term))
        const aliases = terms.filter((term) => !/[._]/.test(term))
        return {
          id: `field:${item.id}`,
          kind: "field" as const,
          page: item.page,
          title,
          description,
          path: [parent ? language.t(parent.key) : "", tab ? language.t(tab.key) : ""].filter(Boolean).join(" › "),
          aliases: [
            language.text("en", item.title),
            language.text("zh", item.title),
            copy(item.description, "en"),
            copy(item.description, "zh"),
            ...aliases,
          ].filter(Boolean),
          keys: [item.title, ...keys],
        }
      })
    return [...pages(), ...rows]
  })
  const results = createMemo(() => match(query(), sources()))
  const choices = createMemo(() => (query().trim() ? results() : pages()))

  const busyCount = () => Object.values(session.allStatusMap()).filter((s) => s.type === "busy").length

  const handleSave = () => {
    const busy = busyCount()
    if (busy === 0 || appearanceOnly()) {
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
        sourceHomeChipMate: language.t("settings.config.source.homeChipMate"),
        sourceHomeOpencode: language.t("settings.config.source.homeOpencode"),
        sourceEnvFile: language.t("settings.config.source.envFile"),
        sourceEnvDir: language.t("settings.config.source.envDir"),
        sourceEnvContent: language.t("settings.config.source.envContent"),
        sourceProjectChipMate: language.t("settings.config.source.projectChipMate"),
        sourceProjectRoot: language.t("settings.config.source.projectRoot"),
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
    if (loading() || sandboxing() || active() !== "sandboxing") return
    onTabChange("experimental")
  })

  const clearTarget = () => {
    setTarget(undefined)
    setNotice("")
    for (const item of document.querySelectorAll<HTMLElement>("[data-search-target]")) {
      item.removeAttribute("data-search-target")
    }
  }

  const onTabChange = (tab: string) => {
    if (target()?.page !== tab) clearTarget()
    setActive(tab)
    props.onTabChange?.(tab)
    vscode.postMessage({ type: "settingsTabChanged", tab })
  }

  const change = (value: string) => {
    clearTarget()
    setQuery(value)
  }

  const pick = (item: SettingSearchItem) => {
    onTabChange(item.page)
    setOpenNav(false)
    if (item.kind === "page") {
      clearTarget()
      setQuery("")
      return
    }
    setTarget(item)
  }

  const focus = (id: string) => {
    setFocused(id)
    const surface = openNav() ? "mobile" : "desktop"
    queueMicrotask(() => document.getElementById(optionId(surface, id))?.focus())
  }

  const move = (step: number) => {
    const items = choices()
    if (items.length === 0) return
    const index = items.findIndex((item) => item.id === focused())
    const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length
    focus(items[next].id)
  }

  const onPickerKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      move(1)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      move(-1)
      return
    }
    if (event.key === "Home" && choices().length > 0) {
      event.preventDefault()
      focus(choices()[0].id)
      return
    }
    if (event.key === "End" && choices().length > 0) {
      event.preventDefault()
      focus(choices()[choices().length - 1].id)
      return
    }
    if (event.key === "Enter") {
      const id = focused() ?? choices()[0]?.id
      if (!id) return
      const item = choices().find((entry) => entry.id === id)
      if (!item) return
      event.preventDefault()
      pick(item)
      return
    }
    if (event.key !== "Escape") return
    event.preventDefault()
    if (query()) {
      change("")
      return
    }
    setOpenNav(false)
  }

  const onSearchKeyDown: JSX.EventHandlerUnion<HTMLInputElement, KeyboardEvent> = (event) => {
    if (event.key === "Escape") {
      if (!query()) return
      event.preventDefault()
      event.stopPropagation()
      change("")
      return
    }
    if (event.key !== "Enter") return
    const item = choices()[0]
    if (!item) return
    event.preventDefault()
    event.stopPropagation()
    pick(item)
  }

  createEffect(() => {
    const items = choices()
    if (items.some((item) => item.id === focused())) return
    setFocused(items.find((item) => item.page === active())?.id ?? items[0]?.id)
  })

  createEffect(() => {
    const item = target()
    if (item && active() !== item.page) clearTarget()
  })

  createEffect(() => {
    const item = target()
    if (!item || active() !== item.page) return
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-setting-search-title]"))
        const row = rows.find(
          (entry) => entry.dataset.settingSearchTitle === item.title && entry.getClientRects().length > 0,
        )
        if (!row) return
        for (const entry of document.querySelectorAll<HTMLElement>("[data-search-target]")) {
          entry.removeAttribute("data-search-target")
        }
        row.setAttribute("data-search-target", "true")
        const panel = row.closest<HTMLElement>("[data-ui='settings-content']")
        const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
        if (panel) {
          const box = panel.getBoundingClientRect()
          const target = row.getBoundingClientRect()
          panel.scrollTo({
            behavior,
            top: Math.max(0, panel.scrollTop + target.top - box.top - (panel.clientHeight - target.height) / 2),
          })
        } else {
          row.scrollIntoView({ behavior, block: "center", inline: "nearest" })
        }
        setNotice(language.t("settings.navigation.located", { setting: item.title }))
      })
    })
  })

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
            <aside class="settings-navigation" data-ui="settings-navigation">
              <TextField
                class="settings-nav-search"
                value={query()}
                onChange={change}
                onKeyDown={onSearchKeyDown}
                label={language.t("settings.navigation.search")}
                hideLabel
                placeholder={language.t("settings.navigation.search")}
                autocomplete="off"
                spellcheck={false}
                data-ui="settings-search"
                role="combobox"
                aria-expanded={Boolean(query().trim())}
                aria-controls="settings-desktop-options"
                aria-activedescendant={
                  !query().trim() || focused() === undefined ? undefined : optionId("desktop", focused()!)
                }
              />
              <Show
                when={query().trim()}
                fallback={
                  <Tabs.List class="settings-nav-list" aria-label={language.t("sidebar.settings")}>
                    <For each={sections()}>
                      {(group) => (
                        <div class="settings-nav-group" data-ui="settings-nav-group" data-group={group.id}>
                          <div class="settings-nav-heading" id={`settings-nav-group-${group.id}`}>
                            {language.t(group.key)}
                          </div>
                          <For each={group.items}>
                            {(item) => {
                              const text = () => language.t(item.key)
                              return (
                                <Tabs.Trigger
                                  value={item.id}
                                  title={text()}
                                  aria-label={text()}
                                  aria-describedby={`settings-nav-group-${group.id}`}
                                  data-ui="settings-nav-item"
                                >
                                  <span class="label">{text()}</span>
                                </Tabs.Trigger>
                              )
                            }}
                          </For>
                        </div>
                      )}
                    </For>
                  </Tabs.List>
                }
              >
                <div
                  class="settings-search-results"
                  id="settings-desktop-options"
                  role="listbox"
                  aria-label={language.t("sidebar.settings")}
                >
                  <div class="settings-search-count">
                    {language.t("settings.navigation.results", { count: results().length })}
                  </div>
                  <For each={results()}>
                    {(item) => (
                      <button
                        id={optionId("desktop", item.id)}
                        type="button"
                        class={`settings-search-option${target()?.id === item.id ? " selected" : ""}`}
                        role="option"
                        aria-selected={target()?.id === item.id}
                        tabindex={focused() === item.id ? 0 : -1}
                        data-ui="settings-search-option"
                        data-kind={item.kind}
                        onFocus={() => setFocused(item.id)}
                        onMouseEnter={() => setFocused(item.id)}
                        onClick={() => pick(item)}
                      >
                        <span class="settings-search-option-title">{item.title}</span>
                        <Show when={item.path}>
                          <span class="settings-search-option-path">{item.path}</span>
                        </Show>
                        <Show when={item.description}>
                          {(description) => <span class="settings-search-option-description">{description()}</span>}
                        </Show>
                      </button>
                    )}
                  </For>
                  <Show when={results().length === 0}>
                    <div class="settings-nav-empty" data-ui="settings-search-empty" role="status">
                      {language.t("settings.navigation.noResults")}
                    </div>
                  </Show>
                </div>
              </Show>
            </aside>

            <div class="settings-mobile-navigation" data-ui="settings-mobile-navigation">
              <PopupSelector
                expanded={false}
                placement="bottom-start"
                open={openNav()}
                onOpenChange={(open) => {
                  setOpenNav(open)
                  if (!open) return
                  setFocused(choices().find((item) => item.page === active())?.id ?? choices()[0]?.id)
                }}
                preferredWidth={night() ? 320 : 520}
                preferredHeight={night() ? Math.min(360, window.innerHeight / 2) : 560}
                minWidth={260}
                minHeight={night() ? 80 : 180}
                padding={8}
                class="settings-nav-popup"
                triggerAs={Button}
                triggerProps={{
                  variant: "secondary",
                  class: "settings-mobile-trigger",
                  "data-ui": "settings-mobile-trigger",
                  "aria-haspopup": "listbox",
                  get ["aria-label"]() {
                    return language.t("settings.navigation.currentPage", { page: label(active()) })
                  },
                }}
                trigger={
                  <>
                    <span class="settings-mobile-trigger-label">{label(active())}</span>
                    <Codicon name={openNav() ? "chevron-up" : "chevron-down"} />
                  </>
                }
              >
                {(height) => (
                  <div
                    class="settings-mobile-menu"
                    data-ui="settings-mobile-menu"
                    onKeyDown={onPickerKeyDown}
                    style={height() !== undefined ? { "max-height": `${height()}px` } : {}}
                  >
                    <TextField
                      class="settings-mobile-search"
                      value={query()}
                      onChange={change}
                      onKeyDown={onSearchKeyDown}
                      label={language.t("settings.navigation.search")}
                      hideLabel
                      placeholder={language.t("settings.navigation.search")}
                      autocomplete="off"
                      spellcheck={false}
                      data-autofocus
                      data-ui="settings-mobile-search"
                      role="combobox"
                      aria-expanded="true"
                      aria-controls="settings-mobile-options"
                      aria-activedescendant={focused() === undefined ? undefined : optionId("mobile", focused()!)}
                    />
                    <div
                      class="settings-mobile-options"
                      id="settings-mobile-options"
                      role="listbox"
                      aria-label={language.t("sidebar.settings")}
                    >
                      <Show
                        when={query().trim()}
                        fallback={
                          <For each={sections()}>
                            {(group) => (
                              <div class="settings-mobile-group" data-group={group.id} role="presentation">
                                <div class="settings-mobile-heading">{language.t(group.key)}</div>
                                <For each={group.items}>
                                  {(item) => {
                                    const choice = () => pages().find((entry) => entry.page === item.id)!
                                    return (
                                      <button
                                        id={optionId("mobile", choice().id)}
                                        type="button"
                                        class={`settings-mobile-option${item.id === active() ? " selected" : ""}`}
                                        role="option"
                                        aria-selected={item.id === active()}
                                        tabindex={focused() === choice().id ? 0 : -1}
                                        data-value={item.id}
                                        data-ui="settings-mobile-option"
                                        onFocus={() => setFocused(choice().id)}
                                        onMouseEnter={() => setFocused(choice().id)}
                                        onClick={() => pick(choice())}
                                      >
                                        <span>{language.t(item.key)}</span>
                                        <Show when={item.id === active()}>
                                          <Codicon name="check" />
                                        </Show>
                                      </button>
                                    )
                                  }}
                                </For>
                              </div>
                            )}
                          </For>
                        }
                      >
                        <div class="settings-mobile-results">
                          <div class="settings-search-count">
                            {language.t("settings.navigation.results", { count: results().length })}
                          </div>
                          <For each={results()}>
                            {(item) => (
                              <button
                                id={optionId("mobile", item.id)}
                                type="button"
                                class={`settings-search-option${target()?.id === item.id ? " selected" : ""}`}
                                role="option"
                                aria-selected={target()?.id === item.id}
                                tabindex={focused() === item.id ? 0 : -1}
                                data-ui="settings-mobile-search-option"
                                data-kind={item.kind}
                                onFocus={() => setFocused(item.id)}
                                onMouseEnter={() => setFocused(item.id)}
                                onClick={() => pick(item)}
                              >
                                <span class="settings-search-option-title">{item.title}</span>
                                <Show when={item.path}>
                                  <span class="settings-search-option-path">{item.path}</span>
                                </Show>
                                <Show when={item.description}>
                                  {(description) => (
                                    <span class="settings-search-option-description">{description()}</span>
                                  )}
                                </Show>
                              </button>
                            )}
                          </For>
                          <Show when={results().length === 0}>
                            <div class="settings-nav-empty" data-ui="settings-search-empty" role="status">
                              {language.t("settings.navigation.noResults")}
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </div>
                )}
              </PopupSelector>
            </div>

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
              <Panel
                title={language.t("settings.chipmateServer.title")}
                description={language.t("settings.chipmateServer.description")}
                brand
              >
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
                <Panel
                  title={language.t("settings.indexing.title")}
                  description={language.t("settings.indexing.description")}
                >
                  <IndexingTab />
                </Panel>
              </Tabs.Content>
            </Show>
            <Tabs.Content value="patentCenter" data-ui="settings-content">
              <Panel
                title={language.t("settings.patentCenter.title")}
                description={language.t("settings.patentCenter.description")}
              >
                <PatentCenterTab />
              </Panel>
            </Tabs.Content>
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
            <Tabs.Content value="aboutChipMate" data-ui="settings-content">
              <Panel title={language.t("settings.aboutChipMate.title")}>
                <AboutChipMateTab
                  port={server.serverInfo()?.port ?? null}
                  connectionState={server.connectionState()}
                  extensionVersion={server.extensionVersion()}
                />
              </Panel>
            </Tabs.Content>
          </Tabs>
        </div>
        <div class="settings-search-status" role="status" aria-live="polite">
          {notice()}
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
              <span
                class={`settings-save-status${saving() ? " settings-save-status-saving" : ""}${saveError() ? " settings-save-status-error" : ""}`}
                aria-hidden="true"
              />
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
