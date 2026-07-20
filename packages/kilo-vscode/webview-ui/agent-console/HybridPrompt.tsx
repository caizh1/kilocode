/** @jsxImportSource solid-js */

import { type Component, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useSession } from "../src/context/session"
import { useVSCode } from "../src/context/vscode"
import { isEnterKeyCommitNotIme } from "../src/utils/ime-enter"

interface Props {
  disabled: () => boolean
  onAgent: (input: string) => void
  onShell: (input: string) => void
  onInterrupt: () => void
}

export const HybridPrompt: Component<Props> = (props) => {
  const vscode = useVSCode()
  const session = useSession()
  const [value, setValue] = createSignal("")
  const [pending, setPending] = createSignal<string>()
  const [history, setHistory] = createSignal<string[]>([])
  const [cursor, setCursor] = createSignal(0)
  let input!: HTMLTextAreaElement

  const submit = () => {
    const text = value().trim()
    if (!text || props.disabled() || pending()) return
    const id = crypto.randomUUID()
    setPending(id)
    vscode.postMessage({ type: "agentConsole.input.route", requestId: id, input: text })
  }

  const remember = (text: string) => {
    setHistory((items) => [...items.filter((item) => item !== text), text].slice(-100))
    setCursor(history().length + 1)
    setValue("")
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
      if (session.status() !== "idle") session.abort()
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
      if (message.type !== "agentConsole.input.routed" || message.requestId !== pending()) return
      setPending(undefined)
      if (!message.input) return
      remember(value().trim())
      if (message.route === "shell") props.onShell(message.input)
      else props.onAgent(message.input)
    })
    const focus = () => input.focus()
    const prefill = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail
      if (typeof detail?.text !== "string") return
      setValue(detail.text)
      requestAnimationFrame(focus)
    }
    window.addEventListener("focusPrompt", focus)
    window.addEventListener("prefillPrompt", prefill)
    onCleanup(() => {
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
    <div data-component="agent-console-prompt" data-pending={pending() ? "" : undefined}>
      <span data-slot="agent-console-prompt-label">{session.status() === "busy" ? "●" : "❯"}</span>
      <textarea
        ref={input}
        class="agent-console-line-input"
        rows={1}
        value={value()}
        disabled={props.disabled()}
        placeholder="输入自然语言或 Linux 命令；! 强制命令，/agent 强制提问"
        aria-label="Agent Console 输入"
        onInput={(event) => setValue(event.currentTarget.value)}
        onKeyDown={key}
      />
    </div>
  )
}
