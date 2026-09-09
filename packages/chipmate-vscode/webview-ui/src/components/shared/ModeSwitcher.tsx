/**
 * ModeSwitcher component
 * Popover-based selector for choosing an agent/mode in the chat prompt area.
 * Uses chipmate-ui Popover component (Phase 4.5 of UI implementation plan).
 *
 * ModeSwitcherBase — reusable core that accepts agents/value/onSelect props.
 * ModeSwitcher     — thin wrapper wired to session context for chat usage.
 */

import { type Accessor, Component, createEffect, createSignal, on, onCleanup, onMount, For, Show } from "solid-js"
import { PopupSelector } from "./PopupSelector"
import { Button } from "@chipmate/chipmate-ui/button"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { AgentInfo } from "../../types/messages"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { UltraModeDialog } from "./UltraModeDialog"
import { DocumentModeDialog } from "./DocumentModeDialog"
import { DeepSeekHarnessDialog } from "./DeepSeekHarnessDialog"
import { useIndexing } from "../../context/indexing"
import { useVSCode } from "../../context/vscode"
import { useDeepSeekHarness } from "../../context/deepseek-harness"
import { DEEPSEEK_HARNESS_AGENT } from "../../../../src/shared/deepseek-harness"

/** Format an agent for display. Uses displayName if available, otherwise title-cases the slug. */
function formatAgentLabel(agent: AgentInfo): string {
  if (agent.displayName) return agent.displayName
  return agent.name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

const icons = {
  architect: "checklist",
  ask: "comment-discussion",
  build: "code",
  code: "code",
  debug: "debug-alt",
  "deepseek-harness": "hubot",
  document: "book",
  plan: "checklist",
  ultra: "sparkle",
  "ufs-reviewer": "shield",
} as const

// ---------------------------------------------------------------------------
// Reusable base component
// ---------------------------------------------------------------------------

export interface ModeSwitcherBaseProps {
  /** Available agents to pick from */
  agents: AgentInfo[]
  /** Currently selected agent name */
  value: string
  /** Called when the user picks an agent */
  onSelect: (name: string) => void
  disabledReason?: (agent: AgentInfo) => string | undefined
  onDisabledSelect?: (agent: AgentInfo, reason: string) => void
  /** Render inline instead of through a portal when nested in a dialog. */
  portal?: boolean
  /** Delay outside dismissal while the popover opens inside a dialog. */
  deferDismiss?: boolean
}

export const ModeSwitcherBase: Component<ModeSwitcherBaseProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [focused, setFocused] = createSignal(-1)
  const language = useLanguage()
  let listRef: HTMLDivElement | undefined
  // True while the picker was opened by the slash command rather than a click,
  // so dismissal returns focus to the prompt like the model/variant pickers.
  let slash = false

  // Listen for slash command trigger
  const onTrigger = () => {
    slash = true
    openSelected()
  }
  window.addEventListener("openModePicker", onTrigger)
  onCleanup(() => window.removeEventListener("openModePicker", onTrigger))

  const hasAgents = () => props.agents.length > 1

  function pick(name: string) {
    const agent = props.agents.find((item) => item.name === name)
    const reason = agent ? props.disabledReason?.(agent) : undefined
    if (agent && reason) {
      props.onDisabledSelect?.(agent, reason)
      setOpen(false)
      return
    }
    props.onSelect(name)
    setOpen(false)
  }

  function focusItem(idx: number) {
    const items = listRef?.querySelectorAll<HTMLElement>("[role=option]")
    if (!items) return
    const clamped = Math.max(0, Math.min(idx, items.length - 1))
    setFocused(clamped)
    items[clamped]?.focus()
  }

  function openSelected() {
    const idx = props.agents.findIndex((a) => a.name === props.value)
    setFocused(idx >= 0 ? idx : 0)
    setOpen(true)
  }

  function onOpen(val: boolean) {
    if (val) {
      // A click on the trigger opens without the slash flag.
      slash = false
      openSelected()
      return
    }
    setOpen(false)
    if (slash) {
      slash = false
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } })))
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const len = props.agents.length
    const cur = focused()
    if (e.key === "ArrowDown") {
      e.preventDefault()
      focusItem((cur + 1) % len)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      focusItem((cur - 1 + len) % len)
    } else if (e.key === "Home") {
      e.preventDefault()
      focusItem(0)
    } else if (e.key === "End") {
      e.preventDefault()
      focusItem(len - 1)
    } else if (e.key === " " || isEnterKeyCommitNotIme(e)) {
      e.preventDefault()
      if (cur >= 0 && cur < len) pick(props.agents[cur].name)
    }
  }

  const triggerLabel = () => {
    const agent = props.agents.find((a) => a.name === props.value)
    if (agent) return formatAgentLabel(agent)
    return props.value || "Code"
  }
  const key = () => props.value.trim().toLowerCase()
  const glyph = () => icons[key() as keyof typeof icons] ?? "comment-discussion"
  const desc = () => `Mode: ${triggerLabel()}`

  return (
    <Show when={hasAgents()}>
      <PopupSelector
        expanded={false}
        placement="top-start"
        minHeight={100}
        portal={props.portal}
        deferDismiss={props.deferDismiss}
        open={open()}
        onOpenChange={onOpen}
        triggerAs={Button}
        triggerProps={{
          variant: "ghost",
          size: "small",
          class: "prompt-selector-trigger prompt-selector-trigger--mode",
          get title() {
            return desc()
          },
          get ["aria-label"]() {
            return desc()
          },
          get ["data-agent"]() {
            return key()
          },
        }}
        trigger={
          <>
            <span class="prompt-selector-icon" aria-hidden="true">
              <span class={`codicon codicon-${glyph()}`} />
            </span>
            <span class="mode-switcher-trigger-label">{triggerLabel()}</span>
            <span class="codicon codicon-chevron-down prompt-selector-chevron" aria-hidden="true" />
          </>
        }
      >
        {(bodyH) => (
          <div
            class="mode-switcher-list"
            role="listbox"
            ref={listRef}
            onKeyDown={onKeyDown}
            style={bodyH() !== undefined ? { "max-height": `${bodyH()}px` } : {}}
          >
            <For each={props.agents}>
              {(agent, i) => (
                <div
                  class={`mode-switcher-item${agent.name === props.value ? " selected" : ""}${props.disabledReason?.(agent) ? " disabled" : ""}`}
                  role="option"
                  aria-selected={agent.name === props.value}
                  aria-disabled={props.disabledReason?.(agent) ? "true" : undefined}
                  tabindex={focused() === i() ? 0 : -1}
                  data-autofocus={focused() === i() ? "" : undefined}
                  data-agent={agent.name.trim().toLowerCase()}
                  onClick={() => pick(agent.name)}
                  onFocus={() => setFocused(i())}
                >
                  <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                    <span class="mode-switcher-item-name">{formatAgentLabel(agent)}</span>
                    <Show when={agent.deprecated}>
                      <span
                        style={{
                          "font-size": "var(--chipmate-font-size-10)",
                          padding: "1px 5px",
                          "border-radius": "3px",
                          background: "var(--vscode-editorWarning-foreground, #cca700)",
                          color: "var(--vscode-editorWarning-foreground-text, #1e1e1e)",
                        }}
                      >
                        {language.t("settings.agentBehaviour.badge.deprecated")}
                      </span>
                    </Show>
                  </div>
                  <Show when={agent.description}>
                    <span class="mode-switcher-item-desc">{agent.description}</span>
                  </Show>
                  <Show when={props.disabledReason?.(agent)} keyed>
                    {(reason) => <span class="mode-switcher-item-disabled-reason">{reason}</span>}
                  </Show>
                </div>
              )}
            </For>
          </div>
        )}
      </PopupSelector>
    </Show>
  )
}

// ---------------------------------------------------------------------------
// Chat-specific wrapper (backwards-compatible)
// ---------------------------------------------------------------------------

interface ModeSwitcherProps {
  sessionID?: Accessor<string | undefined>
}

const agentSelectionRequest = "chipmate:request-agent-selection"

export function requestAgentSelection(name: string): void {
  window.dispatchEvent(new CustomEvent(agentSelectionRequest, { detail: { name } }))
}

export const ModeSwitcher: Component<ModeSwitcherProps> = (props) => {
  const session = useSession()
  const indexing = useIndexing()
  const vscode = useVSCode()
  const language = useLanguage()
  const dsh = useDeepSeekHarness()
  const id = () => props.sessionID?.()
  const [pending, setPending] = createSignal<
    { sessionID: string; agent: "document" | "ultra" | typeof DEEPSEEK_HARNESS_AGENT } | undefined
  >()

  createEffect(
    on(id, (next) => {
      const origin = pending()
      if (origin === undefined || origin.sessionID === next) return
      if (origin.agent === DEEPSEEK_HARNESS_AGENT && !origin.sessionID && next) return
      setPending(undefined)
    }),
  )

  const focus = () => {
    requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))
  }

  const select = (name: string) => {
    if (name === DEEPSEEK_HARNESS_AGENT) {
      if (dsh.active()) {
        focus()
        return
      }
      setPending({ sessionID: id() ?? "", agent: DEEPSEEK_HARNESS_AGENT })
      return
    }
    if (dsh.active()) dsh.deactivate()
    const current = session.selectedAgent(id())
    const target = session.agents().find((agent) => agent.name === name)
    if (
      current !== target?.name &&
      target?.native === true &&
      (target.name === "ultra" || target.name === "document")
    ) {
      setPending({ sessionID: id() ?? "", agent: target.name })
      return
    }
    session.selectAgent(name, id())
    focus()
  }

  onMount(() => {
    const handle = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }>).detail?.name
      if (name) select(name)
    }
    window.addEventListener(agentSelectionRequest, handle)
    const cancelPending = () => setPending(undefined)
    window.addEventListener("newTaskRequest", cancelPending)
    onCleanup(() => {
      window.removeEventListener(agentSelectionRequest, handle)
      window.removeEventListener("newTaskRequest", cancelPending)
    })
  })

  const disabledReason = (agent: AgentInfo): string | undefined => {
    if (agent.name !== "document" || indexing.loading()) return undefined
    if (indexing.pipelines().documents.state !== "Disabled") return undefined
    return language.t("documentAgent.unavailable")
  }

  const confirm = (agent: "document" | "ultra" | typeof DEEPSEEK_HARNESS_AGENT) => {
    const origin = pending()
    if (origin === undefined || origin.agent !== agent) return
    const sid = id() ?? ""
    setPending(undefined)
    if (agent === DEEPSEEK_HARNESS_AGENT) {
      if (origin.sessionID && sid && origin.sessionID !== sid) {
        focus()
        return
      }
      dsh.activate(session.selected(id()))
      focus()
      return
    }
    const target = session.agents().find((item) => item.name === agent)
    if (origin.sessionID !== sid || target?.native !== true) {
      focus()
      return
    }
    session.selectAgent(agent, id())
    focus()
  }

  return (
    <>
      <ModeSwitcherBase
        agents={session.agents()}
        value={dsh.active() ? DEEPSEEK_HARNESS_AGENT : session.selectedAgent(id())}
        onSelect={select}
        disabledReason={disabledReason}
        onDisabledSelect={() => vscode.postMessage({ type: "openSettingsTab", tab: "indexing" })}
      />
      <UltraModeDialog open={pending()?.agent === "ultra"} onConfirm={() => confirm("ultra")} />
      <DocumentModeDialog open={pending()?.agent === "document"} onConfirm={() => confirm("document")} />
      <DeepSeekHarnessDialog
        open={pending()?.agent === DEEPSEEK_HARNESS_AGENT}
        onConfirm={() => confirm(DEEPSEEK_HARNESS_AGENT)}
      />
    </>
  )
}
