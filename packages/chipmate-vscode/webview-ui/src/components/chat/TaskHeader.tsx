/**
 * TaskHeader component
 * Sticky header above the chat messages showing session title,
 * cost, context usage, and a compact button.
 * Also shows todo progress when the session has todos.
 *
 * When expanded, shows the task timeline (colored bars representing
 * session activity) and a context window progress bar.
 */

import {
  Component,
  For,
  Show,
  createMemo,
  createSignal,
  createEffect,
  on,
  onMount,
  onCleanup,
  type JSX,
} from "solid-js"
import { IconButton } from "@chipmate/chipmate-ui/icon-button"
import { Tooltip } from "@chipmate/chipmate-ui/tooltip"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { Checkbox } from "@chipmate/chipmate-ui/checkbox"
import { Popover } from "@chipmate/chipmate-ui/popover"
import { useSession } from "../../context/session"
import { calcTokenUsage, collapseCostBreakdown } from "../../context/session-utils"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { TaskTimeline } from "./TaskTimeline"
import { ContextProgress } from "./ContextProgress"
import { TaskUsage } from "./TaskUsage"
import { TranscriptSearch } from "./TranscriptSearch"
import { useTranscriptSearch } from "../../context/transcript-search"
import { useManualCompaction } from "../../context/manual-compaction"
import { ConversationNavigator } from "./ConversationNavigator"
import type { ConversationNavigationMode } from "./conversation-navigation"
import { formatCNY, formatUSD, hasModelUsage, tokenSummary, usageBilling } from "../../context/model-usage"
import { SessionRenameEditor } from "../shared/SessionRenameEditor"
import { target as todoTarget } from "../../context/todo-revert"
import type { Part, TodoItem, ExtensionMessage } from "../../types/messages"

interface TaskHeaderProps {
  readonly?: boolean
  navigation?: boolean
}

const ConversationNavigatorTrigger: Component<JSX.ButtonHTMLAttributes<HTMLButtonElement>> = (props) => (
  <button {...props} data-slot="conversation-navigator-trigger" />
)

export const TaskHeader: Component<TaskHeaderProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const search = useTranscriptSearch()
  const manualCompaction = useManualCompaction()

  const title = createMemo(() => session.currentSession()?.title ?? language.t("command.session.new"))
  const canRename = createMemo(() => !props.readonly && !!session.currentSession())
  const hasMessages = createMemo(() => session.messages().length > 0)

  const fmt = (n: number) => new Intl.NumberFormat(language.locale(), { style: "currency", currency: "USD" }).format(n)

  const breakdown = () => session.costBreakdown()

  const cost = createMemo(() => {
    const total = breakdown().reduce((sum, e) => sum + e.cost, 0)
    if (total === 0) return undefined
    return fmt(total)
  })

  const costTooltip = createMemo(() => {
    const items = breakdown()
    if (items.length <= 1) return <span>{language.t("context.usage.sessionCost")}</span>
    const collapsed = collapseCostBreakdown(items, (n) =>
      language.t("context.usage.olderSessions", { count: String(n) }),
    )
    return (
      <div style={{ "text-align": "left", "white-space": "nowrap" }}>
        <For each={collapsed}>{(e) => <div>{`${e.label}: ${fmt(e.cost)}`}</div>}</For>
      </div>
    )
  })

  const context = createMemo(() => {
    const usage = session.contextUsage()
    if (!usage) return undefined
    const tokens = usage.tokens.toLocaleString(language.locale())
    const pct = usage.percentage !== null ? `${usage.percentage}%` : undefined
    return { tokens, pct }
  })

  const tokens = createMemo(() => {
    const usage = session.modelUsage()
    return hasModelUsage(usage) ? tokenSummary(usage) : calcTokenUsage(session.visibleMessages())
  })

  const hasTimeline = createMemo(() => {
    for (const m of session.visibleMessages()) {
      if (m.role !== "assistant") continue
      if (session.getParts(m.id).some((p) => p.type !== "step-start")) return true
    }
    return false
  })

  const vscode = useVSCode()
  const [expanded, setExpanded] = createSignal(true)
  const [navigationMode, setNavigationMode] = createSignal<ConversationNavigationMode>("closed")
  const [selectedNavigationMessageID, setSelectedNavigationMessageID] = createSignal<string>()
  let restorePromptFrame = 0
  let restoreNavigationTriggerFrame = 0
  let triggerRequestedClose = false

  const compactCost = createMemo(() => {
    const totals = session.modelUsage()?.totals
    if (!totals) return cost()
    const billing = usageBilling(totals)
    const values: string[] = []
    if (billing.settledSteps > 0) values.push(formatCNY(billing.amountCNY, language.locale()))
    if (billing.otherCostUSD > 0) values.push(formatUSD(billing.otherCostUSD, language.locale()))
    if (billing.pendingSteps > 0) values.push(language.t("context.usage.billing.pending"))
    if (billing.unavailableSteps > 0) values.push(language.t("context.usage.billing.unavailable"))
    return values.join(" · ") || undefined
  })
  const compactCostTooltip = createMemo(() =>
    session.modelUsage() ? <span>{language.t("context.usage.sessionCost")}</span> : costTooltip(),
  )

  // Read initial value from VS Code settings
  onMount(() => vscode.postMessage({ type: "requestTimelineSetting" }))
  const handler = (e: MessageEvent<ExtensionMessage>) => {
    if (e.data.type === "timelineSettingLoaded") setExpanded(e.data.visible)
  }
  window.addEventListener("message", handler)
  onCleanup(() => window.removeEventListener("message", handler))

  // "ChipMate: Toggle Chat Search" (Command Palette) toggles the search
  // bar from here rather than TranscriptSearch.tsx itself: that component
  // only mounts once search.active() is already true (it's behind a
  // <Show>), so it can never be what turns search on in the first place —
  // and it also wouldn't exist anymore to react to a request to close it.
  // TaskHeader is mounted the whole time there's an active chat, so it's
  // the right place to react to the external toggle request.
  const resetSearch = () => {
    search.setQuery("")
    search.setCount(0)
    search.setIndex(0)
  }
  const restorePromptFocus = () => {
    if (restorePromptFrame) cancelAnimationFrame(restorePromptFrame)
    restorePromptFrame = requestAnimationFrame(() => {
      restorePromptFrame = 0
      window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } }))
    })
  }
  const closeNavigation = (restoreFocus = true) => {
    const wasSearch = search.active()
    setNavigationMode("closed")
    if (wasSearch && restoreFocus) search.closeSearch()
    else search.setActive(false)
    if (!wasSearch && restoreFocus) restorePromptFocus()
    resetSearch()
  }
  const selectNavigationMode = (mode: Exclude<ConversationNavigationMode, "closed">) => {
    setNavigationMode(mode)
    search.setActive(mode === "search")
  }
  const openSearch = () => {
    if (props.navigation === false) {
      if (search.active()) search.closeSearch()
      else search.setActive(true)
      return
    }
    if (navigationMode() === "search") {
      closeNavigation()
      return
    }
    selectNavigationMode("search")
  }
  window.addEventListener("focusTranscriptSearch", openSearch)
  onCleanup(() => window.removeEventListener("focusTranscriptSearch", openSearch))

  const closeNavigationOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || navigationMode() === "closed") return
    event.preventDefault()
    event.stopImmediatePropagation()
    closeNavigation()
  }
  window.addEventListener("keydown", closeNavigationOnEscape, { capture: true })
  onCleanup(() => window.removeEventListener("keydown", closeNavigationOnEscape, { capture: true }))

  const changeNavigationOpen = (open: boolean) => {
    if (open) {
      if (navigationMode() === "closed") selectNavigationMode("inputs")
      return
    }
    if (navigationMode() !== "closed") closeNavigation(false)
    if (!triggerRequestedClose) return
    triggerRequestedClose = false
    if (restoreNavigationTriggerFrame) cancelAnimationFrame(restoreNavigationTriggerFrame)
    restoreNavigationTriggerFrame = requestAnimationFrame(() => {
      restoreNavigationTriggerFrame = 0
      document.querySelector<HTMLElement>('[data-slot="conversation-navigator-trigger"]')?.focus()
    })
  }

  createEffect(() => {
    if (props.navigation === false || navigationMode() !== "inputs") return
    if (!session.hasOlderMessages() || session.loadingOlderMessages()) return
    session.loadOlderMessages()
  })

  createEffect(
    on(
      session.currentSessionID,
      () => {
        setNavigationMode("closed")
        setSelectedNavigationMessageID(undefined)
        search.setActive(false)
        resetSearch()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.navigation !== false,
      (eligible) => {
        if (eligible) return
        setNavigationMode("closed")
        setSelectedNavigationMessageID(undefined)
        search.setActive(false)
        resetSearch()
      },
      { defer: true },
    ),
  )

  // Whenever search closes via an explicit user action — the header toggle
  // button, the command palette toggle above, the search bar's own "X", or
  // Escape — send focus back to the chat input rather than leaving it
  // stranded on whatever control was just clicked/removed. Watches
  // `closeSignal` rather than `active()` transitions so that MessageList
  // silently resetting the widget on a session/tab change (which also
  // flips `active()` false) can't trigger this same aggressive restore and
  // steal focus back from the tab strip's own focus handling. `defer: true`
  // skips the initial run so mounting doesn't immediately steal focus.
  createEffect(
    on(
      () => search.closeSignal(),
      () => {
        restorePromptFocus()
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (restorePromptFrame) cancelAnimationFrame(restorePromptFrame)
    if (restoreNavigationTriggerFrame) cancelAnimationFrame(restoreNavigationTriggerFrame)
  })

  const toggle = () => {
    const next = !expanded()
    setExpanded(next)
    vscode.postMessage({ type: "updateSetting", key: "showTaskTimeline", value: next })
  }

  const todos = createMemo(() => session.todos())
  const hasTodos = createMemo(() => todos().length > 0)
  const doneCount = createMemo(() => todos().filter((t: TodoItem) => t.status === "completed").length)
  const totalCount = createMemo(() => todos().length)
  const allDone = createMemo(() => doneCount() === totalCount() && totalCount() > 0)

  const todoSummary = createMemo(() => {
    const done = doneCount()
    const total = totalCount()
    if (total === 0) return ""
    if (done === total) return language.t("task.todos.allDone", { count: String(total) })
    return language.t("task.todos.progress", { done: String(done), total: String(total) })
  })

  const [todosOpen, setTodosOpen] = createSignal(false)
  const [renaming, setRenaming] = createSignal<{ id: string; title: string }>()

  const startRename = () => {
    if (props.readonly) return
    const info = session.currentSession()
    if (!info) return
    setRenaming({ id: info.id, title: info.title ?? "" })
  }

  const commitRename = (title: string) => {
    const info = renaming()
    if (!info) return
    setRenaming(undefined)
    if (title === info.title) return
    session.renameSession(info.id, title)
  }

  const cancelRename = () => {
    setRenaming(undefined)
  }

  createEffect(() => {
    const info = renaming()
    if (info && session.currentSession()?.id !== info.id) setRenaming(undefined)
  })

  const donePart = (idx: number): Part | undefined =>
    todoTarget({ messages: session.messages(), parts: session.allParts() }, idx)

  const revertTodo = (part: Part | undefined) => {
    if (session.status() !== "idle") return
    if (part?.type !== "tool") return
    if (!part.messageID) return
    session.revertSession(part.messageID, part.id)
  }

  return (
    <Show when={hasMessages()}>
      <div data-component="task-header" data-qa-navigation-compact={props.navigation !== false ? "" : undefined}>
        <div data-slot="task-header-title">
          <Show
            when={!renaming()}
            fallback={
              <SessionRenameEditor
                title={renaming()?.title ?? ""}
                autosize
                onSave={commitRename}
                onCancel={cancelRename}
              />
            }
          >
            <span
              data-slot="task-header-title-trigger"
              data-renamable={canRename() ? "" : undefined}
              title={canRename() ? language.t("agentManager.worktree.doubleClickRename") : title()}
              tabIndex={canRename() ? 0 : undefined}
              role={canRename() ? "button" : undefined}
              onDblClick={startRename}
              onKeyDown={(e) => {
                if (!canRename() || (e.key !== "Enter" && e.key !== " ")) return
                e.preventDefault()
                startRename()
              }}
            >
              <span data-slot="task-header-title-label" dir="auto">
                {title()}
              </span>
            </span>
          </Show>
        </div>
        <div data-slot="task-header-stats">
          <Show when={(!expanded() || !hasTimeline()) && compactCost()}>
            {(c) => (
              <Tooltip value={compactCostTooltip()} placement="bottom">
                <span>{c()}</span>
              </Tooltip>
            )}
          </Show>
          <Show when={context()}>
            {(ctx) => (
              <Tooltip
                value={ctx().pct ? `${ctx().tokens} tokens (${ctx().pct} of context)` : `${ctx().tokens} tokens`}
                placement="bottom"
              >
                <span>{ctx().pct ?? ctx().tokens}</span>
              </Tooltip>
            )}
          </Show>
          <Show when={!props.readonly}>
            <Tooltip value={language.t("command.session.compact")} placement="bottom">
              <IconButton
                icon="compress"
                size="small"
                variant="ghost"
                disabled={!manualCompaction.available()}
                onClick={manualCompaction.request}
                aria-label={language.t("command.session.compact")}
              />
            </Tooltip>
          </Show>
          <Show when={hasMessages()}>
            <Show when={props.navigation !== false}>
              <Popover
                placement="bottom-end"
                gutter={6}
                slide
                fitViewport
                overflowPadding={8}
                open={navigationMode() !== "closed"}
                onOpenChange={changeNavigationOpen}
                modal={false}
                contentLabel={language.t("chat.navigation.title")}
                class={`conversation-navigator-popover conversation-navigator-popover--${navigationMode()}`}
                triggerAs={ConversationNavigatorTrigger}
                triggerProps={{
                  type: "button",
                  "aria-label": language.t("chat.navigation.title"),
                  onClick: () => {
                    triggerRequestedClose = navigationMode() !== "closed"
                  },
                }}
                trigger={
                  <>
                    <Icon name="checklist" size="small" />
                    <span>{language.t("chat.navigation.title")}</span>
                    <Icon
                      name="chevron-down"
                      size="small"
                      style={navigationMode() !== "closed" ? { transform: "rotate(180deg)" } : undefined}
                    />
                  </>
                }
              >
                <ConversationNavigator
                  mode={navigationMode() as Exclude<ConversationNavigationMode, "closed">}
                  selectedMessageID={selectedNavigationMessageID()}
                  onSelect={setSelectedNavigationMessageID}
                  onModeChange={selectNavigationMode}
                  onClose={closeNavigation}
                />
              </Popover>
            </Show>
            <Show when={props.navigation === false}>
              <Tooltip value={language.t("chat.search.toggle")} placement="bottom">
                <IconButton
                  icon="magnifying-glass"
                  size="small"
                  variant="ghost"
                  class="task-header-search-toggle"
                  data-active={search.active() ? "" : undefined}
                  onClick={openSearch}
                  aria-label={language.t("chat.search.toggle")}
                  aria-pressed={search.active()}
                />
              </Tooltip>
            </Show>
            <button
              data-slot="task-header-expand"
              onClick={toggle}
              aria-expanded={expanded()}
              aria-label="Toggle timeline"
            >
              <Icon name="chevron-down" size="small" style={expanded() ? { transform: "rotate(180deg)" } : undefined} />
            </button>
          </Show>
        </div>
      </div>
      <Show when={props.navigation === false && search.active()}>
        <TranscriptSearch />
      </Show>
      {/* Expanded graph section: timeline + context bar + token breakdown */}
      <Show when={expanded() && hasTimeline()}>
        <div data-component="task-header-graph">
          <TaskTimeline />
          <div data-slot="task-header-graph-row">
            <ContextProgress />
          </div>
          <Show when={tokens()}>{(tk) => <TaskUsage tokens={tk()} usage={session.modelUsage()} />}</Show>
        </div>
      </Show>
      <Show when={hasTodos()}>
        <div
          data-component="task-header-todos"
          data-qa-navigation-compact={props.navigation !== false ? "" : undefined}
        >
          <button
            data-slot="task-header-todos-trigger"
            onClick={() => setTodosOpen((v) => !v)}
            aria-expanded={todosOpen()}
          >
            <Icon name="checklist" size="small" />
            <span data-slot="task-header-todos-summary" data-all-done={allDone() ? "" : undefined}>
              {todoSummary()}
            </span>
            <Icon
              name="chevron-down"
              size="small"
              data-slot="task-header-todos-arrow"
              data-open={todosOpen() ? "" : undefined}
            />
          </button>
          <Show when={todosOpen()}>
            <div data-slot="task-header-todos-list">
              <For each={todos()}>
                {(todo: TodoItem, idx) => {
                  const part = createMemo(() => (todo.status === "completed" ? donePart(idx()) : undefined))
                  return (
                    <Tooltip value={part() ? language.t("settings.checkpoints.title") : undefined} placement="bottom">
                      <Checkbox readOnly checked={todo.status === "completed"} onClick={() => revertTodo(part())}>
                        <span
                          data-slot="task-header-todo-content"
                          data-completed={todo.status === "completed" ? "" : undefined}
                        >
                          {todo.content}
                        </span>
                      </Checkbox>
                    </Tooltip>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </Show>
  )
}
