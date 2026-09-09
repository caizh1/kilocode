import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { Spinner } from "@chipmate/chipmate-ui/dynamic-spinner"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { TranscriptSearch } from "./TranscriptSearch"
import {
  collectUserInputEntries,
  filterUserInputEntries,
  requestUserInputJump,
  type ConversationNavigationMode,
  type UserInputEntry,
} from "./conversation-navigation"

interface ConversationNavigatorProps {
  mode: Exclude<ConversationNavigationMode, "closed">
  selectedMessageID: string | undefined
  onSelect: (messageID: string) => void
  onModeChange: (mode: Exclude<ConversationNavigationMode, "closed">) => void
  onClose: (restoreFocus?: boolean) => void
}

type NavigationRow = { type: "day"; key: string; label: string } | { type: "entry"; key: string; entry: UserInputEntry }

export const ConversationNavigator = (props: ConversationNavigatorProps) => {
  const session = useSession()
  const language = useLanguage()
  const [query, setQuery] = createSignal("")
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>()
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()

  const entries = createMemo(() =>
    collectUserInputEntries(session.visibleMessages(), session.getParts, language.t("chat.navigation.attachment")),
  )
  const filtered = createMemo(() => filterUserInputEntries(entries(), query(), language.locale()))
  const selectedMessageID = createMemo(() => {
    const selected = props.selectedMessageID
    if (selected && entries().some((entry) => entry.messageID === selected)) return selected
    return entries()[0]?.messageID
  })

  const dayLabel = (value: number) => {
    const current = new Date()
    const date = new Date(value)
    const today = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()
    const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate())
    yesterday.setDate(yesterday.getDate() - 1)
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    if (target === today) return language.t("chat.navigation.today")
    if (target === yesterday.getTime()) return language.t("chat.navigation.yesterday")
    return new Intl.DateTimeFormat(language.locale(), { month: "short", day: "numeric" }).format(date)
  }

  const timeLabel = (value: number) => {
    const age = Date.now() - value
    if (age >= 0 && age < 60_000) return language.t("chat.navigation.justNow")
    const date = new Date(value)
    const today = new Date()
    if (date.toDateString() !== today.toDateString()) return dayLabel(value)
    return new Intl.DateTimeFormat(language.locale(), { hour: "2-digit", minute: "2-digit", hour12: false }).format(
      date,
    )
  }

  const rows = createMemo<NavigationRow[]>(() => {
    const result: NavigationRow[] = []
    let activeDay = ""
    for (const entry of filtered()) {
      const label = dayLabel(entry.timestamp)
      if (label !== activeDay) {
        activeDay = label
        result.push({ type: "day", key: `day:${label}`, label })
      }
      result.push({ type: "entry", key: `entry:${entry.messageID}`, entry })
    }
    return result
  })

  let restoredSelection = false
  createEffect(() => {
    if (restoredSelection || props.mode !== "inputs") return
    const selected = props.selectedMessageID
    const handle = virtualizer()
    if (!selected || !handle) return
    const index = rows().findIndex((row) => row.type === "entry" && row.entry.messageID === selected)
    if (index < 0) return
    restoredSelection = true
    handle.scrollToIndex(index, { align: "center" })
  })

  const jump = (entry: UserInputEntry) => {
    props.onSelect(entry.messageID)
    props.onClose(false)
    requestAnimationFrame(() => requestUserInputJump({ messageID: entry.messageID }))
  }

  return (
    <section
      data-component="conversation-navigator"
      data-mode={props.mode}
      aria-label={language.t("chat.navigation.title")}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return
        event.preventDefault()
        props.onClose()
      }}
    >
      <div data-slot="conversation-navigator-heading">
        <span data-slot="conversation-navigator-title">
          <Icon name="checklist" size="small" />
          <span>{language.t("chat.navigation.title")}</span>
        </span>
        <button
          type="button"
          data-slot="conversation-navigator-collapse"
          onClick={() => props.onClose()}
          aria-label={language.t("chat.navigation.close")}
        >
          <Icon name="chevron-down" size="small" style={{ transform: "rotate(180deg)" }} />
        </button>
      </div>

      <div data-slot="conversation-navigator-tabs" role="tablist" aria-label={language.t("chat.navigation.title")}>
        <button
          type="button"
          role="tab"
          aria-selected={props.mode === "inputs"}
          data-selected={props.mode === "inputs" ? "" : undefined}
          onClick={() => props.onModeChange("inputs")}
        >
          {language.t("chat.navigation.inputs")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={props.mode === "search"}
          data-selected={props.mode === "search" ? "" : undefined}
          onClick={() => props.onModeChange("search")}
        >
          {language.t("chat.navigation.search")}
        </button>
      </div>

      <Show when={props.mode === "inputs"}>
        <div data-slot="conversation-navigator-tools">
          <span data-slot="conversation-navigator-count">
            {language.t("chat.navigation.count", { count: String(entries().length) })}
          </span>
          <label data-slot="conversation-navigator-filter">
            <Icon name="filter" size="small" />
            <input
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder={language.t("chat.navigation.filter")}
              aria-label={language.t("chat.navigation.filter")}
            />
          </label>
        </div>

        <Show
          when={rows().length > 0}
          fallback={
            <div data-slot="conversation-navigator-empty" role="status">
              {query() ? language.t("chat.navigation.noMatches") : language.t("chat.navigation.empty")}
            </div>
          }
        >
          <div ref={setScrollRef} data-slot="conversation-navigator-list">
            <Show when={scrollRef()}>
              <Virtualizer ref={setVirtualizer} data={rows()} scrollRef={scrollRef()} itemSize={56} bufferSize={240}>
                {(row) => (
                  <Show
                    when={row.type === "entry" ? row.entry : undefined}
                    fallback={<div data-slot="conversation-navigator-day">{row.type === "day" ? row.label : ""}</div>}
                  >
                    {(entry) => (
                      <button
                        type="button"
                        data-slot="conversation-navigator-entry"
                        data-selected={entry().messageID === selectedMessageID() ? "" : undefined}
                        aria-current={entry().messageID === selectedMessageID() ? "location" : undefined}
                        onClick={() => jump(entry())}
                        title={entry().filterText}
                      >
                        <span data-slot="conversation-navigator-dot" aria-hidden="true" />
                        <span data-slot="conversation-navigator-excerpt" dir="auto">
                          {entry().preview}
                        </span>
                        <time dateTime={new Date(entry().timestamp).toISOString()}>{timeLabel(entry().timestamp)}</time>
                      </button>
                    )}
                  </Show>
                )}
              </Virtualizer>
            </Show>
          </div>
        </Show>

        <Show when={session.loadingOlderMessages() || session.hasOlderMessages()}>
          <div data-slot="conversation-navigator-loading" role="status">
            <Spinner />
            <span>{language.t("chat.navigation.loadingEarlier")}</span>
          </div>
        </Show>
      </Show>

      <Show when={props.mode === "search"}>
        <div data-slot="conversation-navigator-search">
          <TranscriptSearch onClose={props.onClose} />
        </div>
      </Show>
    </section>
  )
}
