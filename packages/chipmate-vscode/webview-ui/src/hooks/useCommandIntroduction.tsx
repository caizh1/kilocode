import { createSignal, createEffect, onCleanup, onMount, untrack, type Accessor } from "solid-js"
import { useDialog } from "@chipmate/chipmate-ui/context/dialog"
import type { ExtensionMessage, WebviewMessage } from "../types/messages"
import type { SlashCommandEntry } from "./useSlashCommand"
import { SpecIntroductionDialog } from "../components/chat/SpecIntroductionDialog"

export function useCommandIntroduction(options: {
  text: Accessor<string>
  context: Accessor<string>
  enabled: Accessor<boolean>
  commands: Accessor<SlashCommandEntry[]>
  textarea: () => HTMLTextAreaElement | undefined
  vscode: {
    postMessage: (message: WebviewMessage) => void
    onMessage: (handler: (message: ExtensionMessage) => void) => () => void
  }
}) {
  const dialog = useDialog()
  let pending: { id: string; context: string; draft: string; manual: boolean; until: number } | undefined
  let opened: string | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let requested: string | undefined
  const [busy, setBusy] = createSignal(false)
  const [notice, setNotice] = createSignal("")
  const [restoration, setRestoration] = createSignal<() => void>()
  const visible = () =>
    /^\/spec(?:\s|$)/.test(options.text()) &&
    options.commands().some((cmd) => cmd.introduction === "spec" && cmd.name === "spec" && !cmd.action)
  const valid = (request: NonNullable<typeof pending>) =>
    !disposed &&
    options.enabled() &&
    visible() &&
    options.context() === request.context &&
    options.text() === request.draft &&
    document.visibilityState !== "hidden"
  const post = (action: "claim" | "release" | "displayed", requestID: string, manual?: boolean) =>
    options.vscode.postMessage({ type: "commandIntroduction", introduction: "spec", action, requestID, manual })
  const cancel = (reason?: string) => {
    const current = pending
    clearTimeout(timeout)
    timeout = undefined
    pending = undefined
    setBusy(false)
    if (reason && current?.manual && valid(current)) setNotice(reason)
    if (current) {
      try {
        post("release", current.id)
      } catch (error) {
        console.warn("[ChipMate New] 释放流程介绍请求失败", error instanceof Error ? error.name : "消息错误")
      }
    }
  }
  const request = (manual = false) => {
    if (pending || opened || !visible() || !options.enabled()) return
    setNotice("")
    if (dialog.active) {
      if (manual) setNotice("请先关闭当前弹框，再重试查看流程图。")
      return
    }
    pending = {
      id: crypto.randomUUID(),
      context: options.context(),
      draft: options.text(),
      manual,
      until: performance.now() + 15000,
    }
    setBusy(true)
    timeout = setTimeout(() => cancel("流程图响应超时，请重试。"), 15000)
    try {
      post("claim", pending.id, manual)
    } catch (error) {
      console.warn("[ChipMate New] 请求流程介绍失败", error instanceof Error ? error.name : "消息错误")
      cancel("无法请求流程图，请重试。")
    }
  }
  const remove = options.vscode.onMessage((message) => {
    if (message.type !== "commandIntroductionResult" || message.requestID !== pending?.id) return
    const current = pending
    if (!message.granted) {
      cancel("其他面板正在请求流程图，请稍后重试。")
      return
    }
    if (!valid(current) || dialog.active || !document.hasFocus() || performance.now() >= current.until) {
      cancel("流程图请求已失效，请保持当前面板可见后重试。")
      return
    }
    const textarea = options.textarea()
    const caret = textarea && ([textarea.selectionStart, textarea.selectionEnd, textarea.selectionDirection] as const)
    const draft = options.text()
    const restore = () => {
      if (
        disposed ||
        options.context() !== current.context ||
        options.text() !== draft ||
        !options.enabled() ||
        dialog.active
      )
        return
      textarea?.focus({ preventScroll: true })
      if (caret) textarea?.setSelectionRange(...caret)
    }
    void dialog
      .show(() => {
        // 弹框创建可能晚于响应；再次核对当前草稿与会话。
        if (pending !== current || !valid(current) || performance.now() >= current.until) {
          // 即使返回空内容，也必须在本次对话层挂载后关闭，避免留下遮罩。
          onMount(() => dialog.close())
          if (pending === current) cancel("流程图请求已过期，请重试。")
          return null
        }
        return (
          <SpecIntroductionDialog
            displayed={() => {
              opened = dialog.active?.id
              if (pending !== current || !valid(current) || performance.now() >= current.until) {
                cancel()
                dialog.close()
                return
              }
              clearTimeout(timeout)
              timeout = undefined
              try {
                post("displayed", current.id)
              } catch (error) {
                console.warn(
                  "[ChipMate New] 保存流程介绍展示通知失败",
                  error instanceof Error ? error.name : "消息错误",
                )
              }
              pending = undefined
              setBusy(false)
            }}
            disposed={() => {
              cancel()
              opened = undefined
              setRestoration(() => restore)
            }}
          />
        )
      })
      .catch(() => {
        if (pending === current) cancel("流程图加载失败，请重试。")
      })
  })
  createEffect(() => {
    // 恢复草稿时只补取命令元数据，不能推断同名命令属于内置 Spec。
    const context = options.context()
    if (
      /^\/spec(?:\s|$)/.test(options.text()) &&
      !options.commands().some((cmd) => cmd.name === "spec") &&
      requested !== context
    ) {
      requested = context
      options.vscode.postMessage({ type: "requestCommands" })
    }
  })
  createEffect(() => {
    options.context()
    options.text()
    options.enabled()
    options.commands()
    setNotice("")
    untrack(() => {
      if (pending && !valid(pending)) cancel()
    })
  })
  createEffect(() => {
    const restore = restoration()
    if (!restore || dialog.active) return
    setRestoration(undefined)
    queueMicrotask(restore)
  })
  const hide = () => {
    if (document.visibilityState === "hidden") {
      setNotice("")
      cancel()
    }
  }
  const blur = () => {
    setNotice("")
    cancel()
  }
  document.addEventListener("visibilitychange", hide)
  window.addEventListener("blur", blur)
  onCleanup(() => {
    disposed = true
    cancel()
    remove()
    document.removeEventListener("visibilitychange", hide)
    window.removeEventListener("blur", blur)
    if (opened && dialog.active?.id === opened) dialog.close()
  })
  return {
    visible,
    busy: () => busy() || !!dialog.active,
    notice,
    open: () => request(true),
    selected: (command: SlashCommandEntry) => {
      if (command.introduction === "spec" && !command.action) request()
    },
  }
}
