import { For, Show, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { Button } from "@chipmate/chipmate-ui/button"
import "@vscode/codicons/dist/codicon.css"
import { acquireAppearanceApi } from "./api"
import {
  resolveAppearance,
  validAppearance,
  type Appearance,
  type APPEARANCE_ACTIONS,
} from "../../src/shared/appearance"
import "../../../chipmate-ui/src/styles/night-city.css"

// 入口在业务组件之前执行；只变更外观属性，不重建业务组件或会话。
export function mountAppearance(api = acquireAppearanceApi()) {
  const root = document.documentElement
  const nativeNavigation = root.dataset.chipmateNativeNavigation === "true"
  const initial = resolveAppearance({
    skin: root.dataset.chipmateSkin as Appearance["skin"],
    motion: root.dataset.chipmateMotion as Appearance["motion"],
  })
  const [appearance, setAppearance] = createSignal(initial)
  const apply = (value: Appearance) => {
    root.dataset.chipmateSkin = value.skin
    root.dataset.chipmateMotion = value.motion
    root.dataset.colorScheme =
      value.skin === "night-city"
        ? "dark"
        : document.body.matches(".vscode-light, .vscode-high-contrast-light")
          ? "light"
          : "dark"
    setAppearance(value)
    window.dispatchEvent(new CustomEvent("chipmate:appearance-changed", { detail: value }))
  }
  let hostVisible = true
  const receive = (event: MessageEvent) => {
    if (event.data?.type === "appearanceVisibility" && typeof event.data.visible === "boolean") {
      hostVisible = event.data.visible
      visibility()
    }
    if (event.data?.type === "appearanceChanged" && validAppearance(event.data.appearance)) apply(event.data.appearance)
  }
  const visibility = () => {
    root.dataset.chipmateVisible = String(hostVisible && !document.hidden)
  }
  window.addEventListener("message", receive)
  document.addEventListener("visibilitychange", visibility)
  visibility()
  const header = document.createElement("div")
  header.id = "chipmate-appearance-header"
  // 侧栏的原生标题栏已提供导航；隐藏整个容器，连同装饰留白一起移除。
  header.hidden = nativeNavigation
  document.body.prepend(header)
  const actions: { action: keyof typeof APPEARANCE_ACTIONS; icon: string; label: string }[] = [
    { action: "new", icon: "add", label: "新会话" },
    { action: "history", icon: "history", label: "历史" },
    { action: "manager", icon: "organization", label: "Agent Manager" },
    { action: "marketplace", icon: "extensions", label: "市场" },
    { action: "profile", icon: "account", label: "账号" },
    { action: "settings", icon: "settings-gear", label: "设置" },
  ]
  const dispose = render(
    () => (
      <Show when={!nativeNavigation && appearance().skin === "night-city"}>
        <header class="night-city-header">
          <div class="night-city-brand">
            <span class="codicon codicon-circuit-board" aria-hidden="true" />
            <span>CHIPMATE</span>
          </div>
          <nav aria-label="ChipMate 导航">
            <For each={actions}>
              {(item) => (
                <Button
                  variant="ghost"
                  size="small"
                  title={item.label}
                  aria-label={item.label}
                  data-appearance-action={item.action}
                  onClick={() => api.postMessage({ type: "appearanceAction", action: item.action })}
                >
                  <span class={`codicon codicon-${item.icon}`} aria-hidden="true" />
                  <span class="night-city-nav-label">{item.label}</span>
                </Button>
              )}
            </For>
          </nav>
        </header>
      </Show>
    ),
    header,
  )
  apply(initial)
  api.postMessage({ type: "requestAppearance" })
  const cleanup = () => {
    window.removeEventListener("message", receive)
    document.removeEventListener("visibilitychange", visibility)
    window.removeEventListener("pagehide", cleanup)
    dispose()
    header.remove()
  }
  window.addEventListener("pagehide", cleanup)
  return cleanup
}

if (typeof acquireVsCodeApi === "function") mountAppearance()
