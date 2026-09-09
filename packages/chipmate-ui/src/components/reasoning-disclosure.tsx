import { Show, createEffect, createMemo, createSignal, onCleanup, type Component } from "solid-js"
import { useI18n } from "../context/i18n"
import { Collapsible } from "./collapsible"
import { Icon } from "./icon"
import { Markdown } from "./markdown"
import { reasoningHeading } from "./reasoning-heading"
import { createThrottledValue } from "./tool-utils"

export interface ReasoningDisclosureProps {
  id: string
  text: string
  running: boolean
  autoCollapse: boolean
  forceOpen?: boolean
}

// 展开模式记录用户主动折叠，避免响应式刷新或虚拟列表重新挂载后擅自展开。
const userCollapsed = new Set<string>()
// 自动折叠模式保持原有行为：流式时展开，完成后折叠一次，并保留用户手动展开状态。
const streamed = new Set<string>()
const autocollapsed = new Set<string>()
const userOpened = new Set<string>()
const MAX_REASONING_STATE = 1000

function rememberReasoningState(set: Set<string>, id: string) {
  if (set.has(id)) set.delete(id)
  set.add(id)
  if (set.size <= MAX_REASONING_STATE) return
  const first = set.values().next().value
  if (first !== undefined) set.delete(first)
}

/**
 * 普通 QA 与外部会话源共用的纯展示思考组件，不持有消息、会话、Agent 或工具状态。
 */
export const ReasoningDisclosure: Component<ReasoningDisclosureProps> = (props) => {
  const i18n = useI18n()
  const text = () => props.text.replace("[REDACTED]", "").trim()
  const display = createThrottledValue(text)
  const view = createMemo(() => reasoningHeading(display()))
  const done = () => !props.running
  const was = streamed.has(props.id)

  if (props.running) rememberReasoningState(streamed, props.id)

  const initial = props.autoCollapse
    ? props.running || was || userOpened.has(props.id)
    : !userCollapsed.has(props.id)
  const [open, setOpen] = createSignal(initial)

  const track = (value: boolean) => {
    if (props.autoCollapse) {
      if (value) rememberReasoningState(userOpened, props.id)
      else userOpened.delete(props.id)
      setOpen(value)
      return
    }

    if (value) userCollapsed.delete(props.id)
    else rememberReasoningState(userCollapsed, props.id)
    setOpen(value)
  }

  createEffect(() => {
    if (!props.forceOpen || open()) return
    if (props.autoCollapse) rememberReasoningState(userOpened, props.id)
    else userCollapsed.delete(props.id)
    setOpen(true)
  })

  createEffect(() => {
    if (!props.autoCollapse) return
    if (done() && open() && !autocollapsed.has(props.id) && !userOpened.has(props.id)) {
      rememberReasoningState(autocollapsed, props.id)
      setOpen(false)
    }
  })

  onCleanup(() => {
    if (done()) streamed.delete(props.id)
  })

  let ref: HTMLDivElement | undefined
  let scrolled = false

  const onScroll = (event: Event) => {
    const element = event.currentTarget as HTMLDivElement
    if (element.scrollHeight - element.clientHeight - element.scrollTop < 10) scrolled = false
  }

  const onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) scrolled = true
  }

  createEffect(() => {
    display()
    if (props.running && ref && !scrolled) ref.scrollTop = ref.scrollHeight
  })

  const Header = () => (
    <div data-slot="reasoning-header">
      <Icon name="brain" size="small" />
      <span data-slot="reasoning-label">{i18n.t("ui.reasoning.label" as never)}</span>
      <Show when={view().title}>{(title) => <span data-slot="reasoning-title">{title()}</span>}</Show>
    </div>
  )

  return (
    <Show when={view().title || view().body}>
      <div
        data-component="reasoning-part"
        data-streaming={props.running ? "" : undefined}
        data-auto-collapse={props.autoCollapse ? "" : undefined}
      >
        <Show
          when={view().body}
          fallback={
            <div data-slot="collapsible-trigger" data-static="">
              <Header />
            </div>
          }
        >
          <Collapsible open={open()} onOpenChange={track} class="tool-collapsible">
            <Collapsible.Trigger>
              <Header />
              <Collapsible.Arrow />
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div data-slot="reasoning-details">
                <div data-slot="reasoning-content" ref={ref} onScroll={onScroll} onWheel={onWheel}>
                  <Markdown text={view().body} cacheKey={props.id} streaming={props.running} />
                </div>
              </div>
            </Collapsible.Content>
          </Collapsible>
        </Show>
      </div>
    </Show>
  )
}
