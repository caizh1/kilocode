import { createEffect, createMemo, createSignal, createUniqueId, Show } from "solid-js"
import { Spinner } from "@chipmate/chipmate-ui/dynamic-spinner"
import { useSession } from "../../context/session"
import { pendingChanges, useTurnChanges } from "../../context/turn-changes"
import "../../styles/turn-changes-dock.css"

/** 只在用户主动展开时占用记录栏高度；关闭时仅保留输入框上方的小三角。 */
export function TurnChangesDock() {
  const changes = useTurnChanges()
  const session = useSession()
  const [expanded, setExpanded] = createSignal(false)
  const id = createUniqueId()
  const target = changes.active
  const record = createMemo(() => {
    const value = target()
    return value ? changes.record(value.sessionID, value.messageID) : undefined
  })
  const summary = () => record()?.summary()
  const visible = () => session.submitting() || session.status() !== "idle" || pendingChanges(summary())
  createEffect(() => {
    const key = target()
    key?.sessionID
    key?.messageID
    setExpanded(false)
  })
  createEffect(() => {
    if (!visible()) setExpanded(false)
  })
  const label = () => {
    const info = session.statusInfo()
    if (summary()?.phase === "stopping") return "正在停止"
    if (summary()?.phase === "settling") return "正在整理修改"
    if (info.type === "retry") return info.message || "正在等待重试"
    if (info.type === "offline") return info.message || "连接已断开"
    if (record()?.error()) return "修改记录暂不可用"
    return summary() ? "正在记录修改" : "正在准备修改记录"
  }
  const reason = () => record()?.error() ?? summary()?.reason
  const description = () =>
    [label(), summary() ? `${summary()!.files.length} 个文件` : undefined, reason()].filter(Boolean).join(" · ")
  return (
    <Show when={visible()}>
      <div data-component="turn-changes-dock" data-expanded={expanded() ? "true" : "false"}>
        <div id={id} data-slot="turn-changes-drawer" aria-hidden={!expanded()} inert={!expanded()}>
          <div data-slot="turn-changes-drawer-clip">
            <div data-slot="turn-changes-drawer-content" title={description()}>
              <div data-slot="turn-changes-drawer-line">
                <Spinner variant="orbital" class="turn-changes-spinner" />
                <span>{label()}</span>
                <Show when={summary()}>
                  <span data-slot="turn-changes-drawer-count">{summary()!.files.length} 个文件</span>
                </Show>
              </div>
              <Show when={reason()}>
                <div data-slot="turn-changes-drawer-reason">{reason()}</div>
              </Show>
            </div>
          </div>
        </div>
        <button
          type="button"
          data-slot="turn-changes-toggle"
          aria-label={`${expanded() ? "收起" : "展开"}修改记录：${description()}`}
          aria-expanded={expanded()}
          aria-controls={id}
          title={`${expanded() ? "收起" : "展开"}修改记录 · ${description()}`}
          onPointerDown={(event) => {
            if (event.button === 0) event.preventDefault()
          }}
          onClick={() => setExpanded(!expanded())}
        >
          <span class={`codicon codicon-triangle-${expanded() ? "down" : "up"}`} aria-hidden="true" />
        </button>
      </div>
    </Show>
  )
}
