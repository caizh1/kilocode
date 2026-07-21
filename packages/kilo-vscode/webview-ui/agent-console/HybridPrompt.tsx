/** @jsxImportSource solid-js */

import { type Component, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useSession } from "../src/context/session"
import { useVSCode } from "../src/context/vscode"
import { isEnterKeyCommitNotIme } from "../src/utils/ime-enter"

interface Props {
  canSubmit: () => boolean
  busy: () => boolean
  cwd: () => string | undefined
  status: () => string | undefined
  action: () => "recover" | "restart" | undefined
  onAgent: (input: string) => void
  onShell: (input: string) => void
  onInterrupt: () => void
  onRecover: () => void
  onRestart: () => void
  onError: (message: string) => void
  timeout?: number
}

interface Pending {
  id: string
  input: string
}

const ROUTE_TIMEOUT_MS = 10_000

export const HybridPrompt: Component<Props> = (props) => {
  const vscode = useVSCode()
  const session = useSession()
  const [value, setValue] = createSignal("")
  const [pending, setPending] = createSignal<Pending>()
  const [forced, setForced] = createSignal(false)
  const [history, setHistory] = createSignal<string[]>([])
  const [cursor, setCursor] = createSignal(0)
  let timer: ReturnType<typeof setTimeout> | undefined
  let input!: HTMLTextAreaElement

  const submit = () => {
    const text = value().trim()
    if (!text || !props.canSubmit() || pending()) return
    if (forced()) {
      setForced(false)
      remember(text)
      props.onAgent(text)
      return
    }
    const id = crypto.randomUUID()
    setPending({ id, input: text })
    timer = setTimeout(() => {
      if (pending()?.id !== id) return
      setPending(undefined)
      props.onError("输入分流超时，内容已保留，请重试。")
    }, props.timeout ?? ROUTE_TIMEOUT_MS)
    vscode.postMessage({ type: "agentConsole.input.route", requestId: id, input: text })
  }

  const remember = (text: string) => {
    setHistory((items) => [...items.filter((item) => item !== text), text].slice(-100))
    setCursor(history().length + 1)
    if (value().trim() === text) setValue("")
  }

  const move = (delta: number) => {
    const items = history()
    const next = Math.max(0, Math.min(items.length, cursor() + delta))
    setCursor(next)
    setValue(next === items.length ? "" : (items[next] ?? ""))
    requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length))
  }

  const key = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && !value()) {
      event.preventDefault()
      props.onInterrupt()
      return
    }
    if (event.key === "ArrowUp" && !event.shiftKey && input.selectionStart === 0) {
      event.preventDefault()
      move(-1)
      return
    }
    if (event.key === "ArrowDown" && !event.shiftKey && input.selectionEnd === value().length) {
      event.preventDefault()
      move(1)
      return
    }
    if (!isEnterKeyCommitNotIme(event) || event.shiftKey) return
    event.preventDefault()
    submit()
  }

  onMount(() => {
    const dispose = vscode.onMessage((message) => {
      const request = pending()
      if (message.type !== "agentConsole.input.routed" || message.requestId !== request?.id) return
      if (timer) clearTimeout(timer)
      timer = undefined
      setPending(undefined)
      if (!message.input) return
      remember(request.input)
      if (message.route === "shell") props.onShell(message.input)
      else props.onAgent(message.input)
    })
    const focus = () => input.focus()
    const prefill = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; route?: "agent" }>).detail
      if (typeof detail?.text !== "string") return
      setValue(detail.text)
      setForced(detail.route === "agent")
      requestAnimationFrame(focus)
    }
    window.addEventListener("focusPrompt", focus)
    window.addEventListener("prefillPrompt", prefill)
    onCleanup(() => {
      if (timer) clearTimeout(timer)
      dispose()
      window.removeEventListener("focusPrompt", focus)
      window.removeEventListener("prefillPrompt", prefill)
    })
    requestAnimationFrame(focus)
  })

  createEffect(() => {
    value()
    input.style.height = "0px"
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`
  })

  return (
    <div
      data-component="agent-console-prompt"
      data-pending={pending() ? "" : undefined}
      data-submit={props.canSubmit() ? "ready" : "blocked"}
    >
      <span data-slot="agent-console-prompt-cwd" title={props.cwd()}>
        {props.cwd() ?? "shell"}
      </span>
      <span data-slot="agent-console-prompt-label">{props.busy() || session.status() === "busy" ? "●" : "❯"}</span>
      <textarea
        ref={input}
        class="agent-console-line-input"
        rows={1}
        value={value()}
        placeholder="输入自然语言或 Linux 命令；! 强制命令，/agent 强制提问"
        aria-label="Agent Console 输入"
        onInput={(event) => {
          setValue(event.currentTarget.value)
          if (!event.currentTarget.value) setForced(false)
        }}
        onKeyDown={key}
      />
      <Show when={pending() || props.status()}>
        <span data-slot="agent-console-prompt-status">{pending() ? "正在识别…" : props.status()}</span>
      </Show>
      <Show when={props.action()}>
        {(action) => (
          <button
            type="button"
            data-slot="agent-console-recover"
            onClick={() => (action() === "recover" ? props.onRecover() : props.onRestart())}
          >
            {action() === "recover" ? "恢复 Shell" : "重启 Shell"}
          </button>
        )}
      </Show>
    </div>
  )
}
