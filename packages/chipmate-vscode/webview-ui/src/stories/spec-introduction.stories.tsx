import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal, For, Show } from "solid-js"
import { DialogProvider } from "@chipmate/chipmate-ui/context/dialog"
import { I18nProvider } from "@chipmate/chipmate-ui/context/i18n"
import { dict } from "@chipmate/chipmate-ui/i18n/zh"
import { Button } from "@chipmate/chipmate-ui/button"
import { useSlashCommand } from "../hooks/useSlashCommand"
import { useCommandIntroduction } from "../hooks/useCommandIntroduction"
import { CommandIntroductionStore } from "../../../src/chipmate-provider/command-introduction"
import type { ExtensionMessage, WebviewMessage } from "../types/messages"

function Harness() {
  const [text, setText] = createSignal("")
  const [context, setContext] = createSignal("会话一")
  const [messages, setMessages] = createSignal<string[]>([])
  const [deferred, setDeferred] = createSignal(false)
  const [custom, setCustom] = createSignal(false)
  const [failure, setFailure] = createSignal(false)
  const handlers = new Set<(message: ExtensionMessage) => void>()
  const queue: (() => void)[] = []
  const owner = {}
  const store = new CommandIntroductionStore({
    get: <T,>() => (sessionStorage.getItem("spec-introduction-test-seen") === "true") as T,
    update: async () => {
      if (failure()) throw new Error("测试保存失败")
      sessionStorage.setItem("spec-introduction-test-seen", "true")
    },
  })
  const emit = (message: ExtensionMessage) => handlers.forEach((handler) => handler(message))
  const commands = () =>
    emit({
      type: "commandsLoaded",
      commands: [
        {
          name: "spec",
          source: custom() ? "skill" : "command",
          introduction: custom() ? undefined : "spec",
          description: "文档驱动开发",
          hints: [],
        },
        { name: "other", source: "command", hints: [] },
      ],
    })
  const vscode = {
    postMessage: (message: WebviewMessage) => {
      setMessages((items) => [...items, message.type === "commandIntroduction" ? message.action : message.type])
      if (message.type === "requestCommands") {
        commands()
        return
      }
      if (message.type !== "commandIntroduction") return
      void store.handle(owner, message).then((response) => {
        if (!response) return
        const clock = new URLSearchParams(location.search).get("remoteClock")
        if (clock === "omit") delete response.expiresAt
        else if (clock) response.expiresAt = Date.now() + Number(clock)
        if (deferred()) queue.push(() => emit(response))
        else emit(response)
      })
    },
    onMessage: (handler: (message: ExtensionMessage) => void) => {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }
  let textarea: HTMLTextAreaElement | undefined
  const slash = useSlashCommand(vscode)
  const introduction = useCommandIntroduction({
    text,
    context,
    enabled: () => true,
    commands: slash.commands,
    textarea: () => textarea,
    vscode,
  })
  const send = () => {
    setMessages((items) => [...items, "发送草稿"])
    setText("")
    slash.close()
  }
  return (
    <div style={{ padding: "20px", display: "flex", "flex-direction": "column", gap: "12px" }}>
      <h2>Spec 流程介绍交互验收</h2>
      <p>当前会话：{context()} · 附件：已评审详设.docx</p>
      <Show when={introduction.visible() && !slash.show()}>
        <div class="spec-introduction-rail">
          <span>Spec 文档驱动开发</span>
          <Button
            onMouseDown={(e: MouseEvent) => e.preventDefault()}
            onClick={introduction.open}
            disabled={introduction.busy()}
            aria-busy={introduction.busy()}
          >
            {introduction.busy() ? "正在加载…" : introduction.notice() ? "重试查看流程图" : "查看流程图"}
          </Button>
          <Show when={introduction.notice()}>
            <span class="spec-introduction-feedback" role="status">
              {introduction.notice()}
            </span>
          </Show>
        </div>
      </Show>
      <textarea
        aria-label="对话输入框"
        ref={textarea}
        value={text()}
        onInput={(e) => {
          setText(e.currentTarget.value)
          slash.onInput(e.currentTarget.value, e.currentTarget.selectionStart)
        }}
        onKeyDown={(e) => {
          if (slash.onKeyDown(e, textarea, setText, introduction.selected)) return
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      <Show when={slash.show()}>
        <div role="listbox" aria-label="命令候选">
          <For each={slash.results()}>
            {(cmd) => (
              <Button
                role="option"
                onMouseDown={(e: MouseEvent) => {
                  e.preventDefault()
                  if (textarea) slash.select(cmd, textarea, setText, introduction.selected)
                }}
              >
                {cmd.name}
              </Button>
            )}
          </For>
        </div>
      </Show>
      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px" }}>
        <Button onClick={send}>发送</Button>
        <Button
          onClick={() => {
            setText("/spec 已评审详设.docx")
            slash.close()
          }}
        >
          恢复草稿
        </Button>
        <Button onClick={() => setContext(context() === "会话一" ? "会话二" : "会话一")}>切换会话</Button>
        <Button
          onClick={() => {
            setCustom(!custom())
            commands()
          }}
        >
          切换同名 Skill
        </Button>
        <Button onClick={() => setDeferred(!deferred())}>延迟响应：{deferred() ? "开启" : "关闭"}</Button>
        <Button onClick={() => queue.splice(0).forEach((run) => run())}>送达响应</Button>
        <Button
          onClick={() => {
            void store.handle(
              {},
              {
                type: "commandIntroduction",
                introduction: "spec",
                action: "claim",
                requestID: "其他面板",
                manual: true,
              },
            )
          }}
        >
          其他面板占用
        </Button>
        <Button onClick={() => setFailure(!failure())}>保存失败：{failure() ? "开启" : "关闭"}</Button>
      </div>
      <output aria-label="本地消息记录">{messages().join("、")}</output>
    </div>
  )
}
export default { title: "Chat/SpecIntroduction", parameters: { layout: "fullscreen" } } satisfies Meta
export const Flow: StoryObj = {
  render: () => (
    <I18nProvider value={{ locale: () => "zh", t: (key) => dict[key as keyof typeof dict] ?? key }}>
      <DialogProvider>
        <Harness />
      </DialogProvider>
    </I18nProvider>
  ),
}
