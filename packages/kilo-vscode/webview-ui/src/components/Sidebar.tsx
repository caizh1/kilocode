import { For } from "solid-js"
import type { Component } from "solid-js"

type View = "newTask" | "history" | "profile" | "settings" | "subAgentViewer" | "codeGraph"
type Action =
  | "plusButtonClicked"
  | "historyButtonClicked"
  | "profileButtonClicked"
  | "settingsButtonClicked"
  | "codeGraphButtonClicked"

type Item = {
  label: string
  action: Action
  view: View
  icon: string
}

const items: Item[] = [
  { label: "Chat", action: "plusButtonClicked", view: "newTask", icon: "comment-discussion" },
  { label: "CodeGraph", action: "codeGraphButtonClicked", view: "codeGraph", icon: "type-hierarchy" },
  { label: "History", action: "historyButtonClicked", view: "history", icon: "history" },
  { label: "Profile", action: "profileButtonClicked", view: "profile", icon: "account" },
]

const Sidebar: Component<{ currentView: View; onAction: (action: Action) => void }> = (props) => {
  const active = (item: Item) => {
    if (item.view === "newTask") return props.currentView === "newTask" || props.currentView === "subAgentViewer"
    return props.currentView === item.view
  }

  return (
    <aside class="cm-sidebar" aria-label="ChipMate navigation">
      <button
        class="cm-sidebar__brand"
        title="New Task"
        aria-label="New Task"
        type="button"
        onClick={() => props.onAction("plusButtonClicked")}
      >
        <span class="codicon codicon-plus" />
      </button>

      <nav class="cm-sidebar__nav">
        <For each={items}>
          {(item) => (
            <button
              classList={{
                "cm-sidebar__button": true,
                "cm-sidebar__button--active": active(item),
              }}
              title={item.label}
              aria-label={item.label}
              aria-pressed={active(item)}
              type="button"
              onClick={() => props.onAction(item.action)}
            >
              <span class={`codicon codicon-${item.icon}`} />
            </button>
          )}
        </For>
      </nav>

      <div class="cm-sidebar__spacer" />

      <button
        classList={{
          "cm-sidebar__button": true,
          "cm-sidebar__button--active": props.currentView === "settings",
        }}
        title="Settings"
        aria-label="Settings"
        aria-pressed={props.currentView === "settings"}
        type="button"
        onClick={() => props.onAction("settingsButtonClicked")}
      >
        <span class="codicon codicon-gear" />
      </button>
    </aside>
  )
}

export default Sidebar
