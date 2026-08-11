/** @jsxImportSource solid-js */

import {
  type Component,
  type JSX,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from "solid-js"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { IconButton } from "@chipmate/chipmate-ui/icon-button"
import { Button } from "@chipmate/chipmate-ui/button"
import { Tabs } from "@chipmate/chipmate-ui/tabs"
import { Tooltip } from "@chipmate/chipmate-ui/tooltip"
import { PermissionDock } from "../src/components/chat/PermissionDock"
import { editPermission, permissionPresentation } from "../src/components/chat/permission-presentation"
import { useLanguage } from "../src/context/language"
import { useServer } from "../src/context/server"
import { useSession } from "../src/context/session"
import { useVSCode } from "../src/context/vscode"
import { TerminalTab } from "../agent-manager/terminal/TerminalTab"
import { AgentConsoleSocket } from "./relay-socket"
import type { TerminalWriter } from "../agent-manager/terminal/state"
import type { TerminalFont } from "../src/types/messages/agent-manager"
import type {
  AgentConsoleActivityEvent,
  AgentConsoleInputRoutedMessage,
  AgentConsoleTerminalRecoveryMessage,
  AgentConsoleTerminalStateMessage,
} from "../src/types/messages/extension-messages"
import type { PermissionRequest } from "../src/types/messages"
import { HybridTimeline, type Failure } from "./HybridTimeline"
import { mergeActivity } from "./activity"
import { queue } from "./queue"

type Mode = "agent" | "shell"

interface TerminalState {
  id: string
  title: string
  font: TerminalFont
}

interface Props {
  initialMode?: Mode
  shell?: (bind: (next: TerminalWriter) => () => void) => JSX.Element
  activities?: AgentConsoleActivityEvent[]
}

type ShellState =
  | { status: "starting" }
  | { status: "ready"; cwd: string }
  | { status: "busy"; cwd: string }
  | { status: "recovering"; cwd?: string }
  | { status: "error"; message: string }

function name(path: string | undefined): string {
  if (!path) return "Workspace"
  const clean = path.replace(/[\\/]+$/, "")
  return clean.split(/[\\/]/).pop() || clean
}

function fontStyle(terminal: TerminalState | undefined): JSX.CSSProperties {
  return {
    "--agent-console-terminal-font":
      terminal?.font.fontFamily ?? '"Cascadia Mono", Consolas, Menlo, Monaco, monospace',
    "--agent-console-terminal-size": `${terminal?.font.fontSize ?? 13}px`,
    "--agent-console-terminal-line-height": String(terminal?.font.lineHeight ?? 1),
  } as JSX.CSSProperties
}

export const AgentConsoleContent: Component<Props> = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const session = useSession()
  const language = useLanguage()
  const [mode, setMode] = createSignal<Mode>(props.initialMode ?? "agent")
  const [terminal, setTerminal] = createSignal<TerminalState>()
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [inputError, setInputError] = createSignal<string>()
  const [capture, setCapture] = createSignal<string>()
  const [relay, setRelay] = createSignal<"connecting" | "open" | "error" | "closed">(
    props.shell ? "open" : "connecting",
  )
  const [failures, setFailures] = createSignal<Failure[]>([])
  const [alternate, setAlternate] = createSignal(false)
  const [shellState, setShellState] = createSignal<ShellState>(
    props.shell ? { status: "ready", cwd: server.workspaceDirectory() ?? "/project" } : { status: "starting" },
  )
  const [dirty, setDirty] = createSignal(false)
  const [activities, setActivities] = createSignal<AgentConsoleActivityEvent[]>(props.activities ?? [])
  const state = () => server.connectionState()
  const connected = () => state() === "connected"
  const available = () => {
    const shell = shellState().status
    return connected() && relay() === "open" && (shell === "ready" || shell === "busy")
  }

  const bridge = queue((_id, message) => setInputError(message))

  const create = () => {
    if (props.shell || terminal() || pending()) return
    setPending(true)
    setError(undefined)
    vscode.postMessage({ type: "agentConsole.terminal.create" })
  }

  const change = (next: Mode) => {
    setMode(next)
    vscode.postMessage({ type: "agentConsole.mode.changed", mode: next })
    create()
    if (next === "agent") requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))
  }

  const restart = () => {
    setPending(true)
    setError(undefined)
    setInputError(undefined)
    setRelay("connecting")
    setShellState({ status: "starting" })
    vscode.postMessage({ type: "agentConsole.shell.restart" })
  }

  const close = () => {
    const current = terminal()
    if (!current) return
    vscode.postMessage({ type: "agentConsole.terminal.close", terminalId: current.id })
  }

  const reset = () => {
    session.clearCurrentSession()
    bridge.clear()
    setInputError(undefined)
    setFailures([])
    vscode.postMessage({ type: "agentConsole.session.new" })
    requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))
  }

  createEffect(() => {
    const id = session.currentSessionID()
    untrack(() => session.selectAgent("agent-console", id))
  })

  createEffect(() => {
    if (props.activities) setActivities(props.activities)
  })

  const bind = (next: TerminalWriter) => {
    return bridge.bind(next)
  }

  const archive = (input: string, message: string) => {
    setFailures((current) => [...current, { id: crypto.randomUUID(), input, message, created: Date.now() }])
  }

  const agent = (input: string, report = true) => {
    setInputError(undefined)
    if (!connected()) {
      if (report) archive(input, "Agent 连接已断开，请恢复连接后重试。")
      return false
    }
    if (session.status() !== "idle" || permission()) {
      if (report) archive(input, "Agent 正在处理上一项请求，请稍后重试。")
      return false
    }
    const state = shellState()
    if (state.status !== "ready") {
      const message = state.status === "error" ? state.message : "等待 Shell 回到命令提示符后再调用 Agent。"
      if (report) archive(input, message)
      return false
    }
    session.selectAgent("agent-console", session.currentSessionID())
    const selected = session.selected()
    if (!selected) {
      if (report) archive(input, "尚未选择可用模型，请先在 ChipMate 设置中配置内网模型。")
      return false
    }
    session.sendMessage(input, selected.providerID, selected.modelID)
    return true
  }

  const retry = (failure: Failure) => {
    if (!agent(failure.input, false)) {
      setFailures((current) =>
        current.map((item) =>
          item.id === failure.id ? { ...item, message: "Agent 仍不可用，请检查连接和模型配置后重试。" } : item,
        ),
      )
      return
    }
    setFailures((current) => current.filter((item) => item.id !== failure.id))
  }

  const captureInput = (): "accepted" | "busy" | "unavailable" => {
    const current = terminal()
    if (capture()) {
      setInputError("正在判断上一条输入，请稍候。")
      return "busy"
    }
    if (!current || !gate().submit) {
      setInputError(gate().label ?? "Shell 尚未准备好接收输入。")
      return "unavailable"
    }
    const id = crypto.randomUUID()
    setCapture(id)
    setInputError(undefined)
    vscode.postMessage({ type: "agentConsole.input.capture", terminalId: current.id, requestId: id })
    return "accepted"
  }

  const interrupt = () => {
    bridge.write("\x03")
    session.abort()
  }

  const recover = () => {
    const current = terminal()
    if (!current) return
    setInputError(undefined)
    vscode.postMessage({ type: "agentConsole.terminal.recover", terminalId: current.id })
  }

  const fail = (message: string) => {
    bridge.reject(message)
    setInputError(message)
  }

  const connection = (next: "open" | "error" | "closed", detail?: string) => {
    setRelay(next)
    if (next === "open") {
      setError(undefined)
      return
    }
    if (next === "closed" && error()) return
    const label = language.t(next === "error" ? "agentManager.terminal.connectionError" : "agentManager.terminal.ended")
    const message = detail ? `${label} (${detail})` : label
    setError(message)
    fail(message)
  }

  const permissions = createMemo(() => session.scopedPermissions(session.currentSessionID()))
  const permission = () => {
    const id = session.currentSessionID()
    return permissions().find((item) => item.sessionID === id) ?? permissions()[0]
  }

  const gate = createMemo(() => {
    if (mode() !== "agent") return { submit: false, label: undefined, action: undefined }
    const shell = shellState()
    if (shell.status === "error") return { submit: false, label: shell.message, action: "restart" as const }
    if (shell.status === "recovering") return { submit: false, label: "正在恢复 Shell…", action: undefined }
    if (shell.status === "starting") return { submit: false, label: "Shell 正在连接…", action: undefined }
    if (!connected() || relay() !== "open") {
      return { submit: false, label: "Shell 正在连接，当前输入不会提交", action: undefined }
    }
    const status = session.status()
    if (status !== "idle") {
      const label = status === "retry" ? "Agent 正在重试，Ctrl+C 可中断" : "Agent 执行中，Ctrl+C 可中断"
      return { submit: false, label, action: undefined }
    }
    if (permission()) return { submit: false, label: "等待处理命令审批", action: undefined }
    if (capture()) return { submit: false, label: "正在判断输入类型…", action: undefined }
    if (shell.status === "ready") return { submit: true, label: undefined, action: undefined }
    if (shell.status === "busy") {
      return { submit: false, label: "Shell 命令运行中，Ctrl+C 可中断", action: "recover" as const }
    }
    return { submit: false, label: undefined, action: undefined }
  })

  let signature = ""
  createEffect(() => {
    const next = `${gate().submit}:${gate().label ?? "ready"}`
    if (next === signature) return
    signature = next
    const current = terminal()
    if (!current) return
    vscode.postMessage({
      type: "agentConsole.terminal.diagnostic",
      terminalId: current.id,
      event: "input-gate",
      detail: next,
    })
  })

  const decide = (response: "once" | "reject", approved: string[], denied: string[]) => {
    const request = permission()
    if (!request || session.respondingPermissions().has(request.id)) return
    const current = terminal()
    const command =
      typeof request.args.command === "string" ? request.args.command : request.patterns.find((item) => item.trim())
    if (response === "once" && current && command) {
      vscode.postMessage({
        type: "agentConsole.command.expect",
        terminalId: current.id,
        runId: crypto.randomUUID(),
        source: "agent",
        command,
        callId: request.tool?.callID,
      })
    }
    session.respondToPermission(request.id, response, approved, denied)
  }

  const edit = (request: PermissionRequest) => {
    editPermission(
      request,
      session.respondingPermissions().has(request.id),
      () => session.respondToPermission(request.id, "reject", [], []),
      (text) => {
        bridge.write(`\x18\x15${text}`)
        setDirty(!!text)
      },
    )
  }

  const permissionCard = () => {
    const request = permission()
    if (!request) return undefined
    return (
      <PermissionDock
        request={request}
        severity={permissionPresentation(request)}
        directory={server.workspaceDirectory()}
        labels={{
          once: language.t("agentConsole.permission.execute"),
          edit: language.t("agentConsole.permission.edit"),
          reject: language.t("agentConsole.permission.reject"),
        }}
        responding={session.respondingPermissions().has(request.id)}
        onDecide={decide}
        onEdit={() => edit(request)}
      />
    )
  }

  const updateShell = (message: AgentConsoleTerminalStateMessage) => {
    if (terminal()?.id !== message.terminalId) return
    setShellState(message.state)
    if (message.state.status === "ready") setInputError(undefined)
    if (message.state.status === "error") setInputError(message.state.message)
  }

  const finishRecovery = (message: AgentConsoleTerminalRecoveryMessage) => {
    if (terminal()?.id !== message.terminalId) return
    if (!message.success) {
      setInputError(message.message ?? "Shell 恢复失败，请重启 Shell。")
      return
    }
    setDirty(false)
    setInputError(undefined)
    requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))
  }

  const routeInput = (message: AgentConsoleInputRoutedMessage) => {
    if (capture() !== message.requestId) return
    setCapture(undefined)
    setDirty(false)
    if (message.route === "agent") agent(message.input)
  }

  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (mode() !== "agent" || (session.status() === "idle" && shellState().status !== "busy")) return
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "c") return
      if (window.getSelection()?.toString()) return
      const node = event.target
      if (
        (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) &&
        node.selectionStart !== node.selectionEnd
      )
        return
      event.preventDefault()
      interrupt()
    }
    const dispose = vscode.onMessage((message) => {
      if (message.type === "agentConsole.terminal.created") {
        setTerminal({
          id: message.terminalId,
          title: message.title,
          font: message.font,
        })
        setPending(false)
        setError(undefined)
        setRelay("connecting")
        setActivities([])
        return
      }
      if (message.type === "agentConsole.terminal.activitySnapshot") {
        if (terminal()?.id !== message.terminalId) return
        setActivities((current) =>
          mergeActivity(
            message.events,
            current.filter((event) => event.seq > message.throughSeq),
          ),
        )
        return
      }
      if (message.type === "agentConsole.terminal.activity") {
        if (terminal()?.id !== message.terminalId) return
        setActivities((current) => mergeActivity(current, [message.event]))
        return
      }
      if (message.type === "agentConsole.input.routed") {
        routeInput(message)
        return
      }
      if (message.type === "agentConsole.input.error") {
        if (capture() !== message.requestId) return
        setCapture(undefined)
        if (message.recovery === "archive" && message.input) {
          archive(message.input, message.message)
          setDirty(false)
          return
        }
        setInputError(message.message)
        return
      }
      if (message.type === "agentConsole.terminal.state") {
        updateShell(message)
        return
      }
      if (message.type === "agentConsole.terminal.recovery") {
        finishRecovery(message)
        return
      }
      if (message.type === "agentConsole.terminal.closed") {
        if (terminal()?.id === message.terminalId) setTerminal(undefined)
        setActivities([])
        setShellState({ status: "error", message: language.t("agentManager.terminal.ended") })
        setRelay("closed")
        setPending(false)
        fail(language.t("agentManager.terminal.ended"))
        return
      }
      if (message.type === "agentConsole.terminal.error") {
        setPending(false)
        setError(message.message)
        setShellState({ status: "error", message: message.message })
        setRelay("error")
        fail(message.message)
        return
      }
      if (message.type !== "agentConsole.terminal.fontChanged") return
      setTerminal((current) => (current ? { ...current, font: message.font } : current))
    })
    window.addEventListener("keydown", key)
    create()
    onCleanup(() => {
      dispose()
      window.removeEventListener("keydown", key)
    })
  })

  return (
    <main data-component="agent-console" data-mode={mode()} style={fontStyle(terminal())}>
      <header data-slot="agent-console-toolbar">
        <div data-slot="agent-console-leading">
          <Tabs
            value={mode()}
            onChange={(value) => change(value as Mode)}
            variant="pill"
            data-slot="agent-console-mode"
            aria-label={language.t("agentConsole.mode.label")}
          >
            <Tabs.List>
              <Tabs.Trigger value="shell">
                <Icon name="console" size="small" />
                <span>{language.t("agentConsole.mode.shell")}</span>
              </Tabs.Trigger>
              <Tabs.Trigger value="agent">
                <Icon name="brain" size="small" />
                <span>{language.t("agentConsole.mode.agent")}</span>
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
          <div data-slot="agent-console-workspace" title={server.workspaceDirectory()}>
            <Icon name="folder" size="small" />
            <span>{name(server.workspaceDirectory())}</span>
          </div>
        </div>

        <div data-slot="agent-console-actions">
          <span data-slot="agent-console-connection" data-state={available() ? "connected" : "connecting"}>
            <span data-slot="agent-console-connection-dot" />
            {available()
              ? language.t("agentConsole.connection.connected")
              : language.t("agentConsole.connection.connecting")}
          </span>
          <Show when={mode() === "agent"}>
            <Tooltip value={language.t("agentConsole.action.newSession")} placement="bottom">
              <IconButton
                icon="plus"
                size="small"
                variant="ghost"
                label={language.t("agentConsole.action.newSession")}
                disabled={session.status() === "busy" || !!permission()}
                onClick={reset}
              />
            </Tooltip>
            <Tooltip value={language.t("agentConsole.action.clear")} placement="bottom">
              <IconButton
                icon="trash"
                size="small"
                variant="ghost"
                label={language.t("agentConsole.action.clear")}
                disabled={session.status() === "busy" || !!permission()}
                onClick={reset}
              />
            </Tooltip>
          </Show>
          <Show when={mode() === "shell"}>
            <Tooltip value={language.t("agentConsole.action.restartShell")} placement="bottom">
              <IconButton
                icon="play"
                size="small"
                variant="ghost"
                label={language.t("agentConsole.action.restartShell")}
                disabled={pending()}
                onClick={restart}
              />
            </Tooltip>
            <Tooltip value={language.t("agentConsole.action.closeShell")} placement="bottom">
              <IconButton
                icon="stop"
                size="small"
                variant="ghost"
                label={language.t("agentConsole.action.closeShell")}
                disabled={!terminal()}
                onClick={close}
              />
            </Tooltip>
          </Show>
        </div>
      </header>

      <section data-slot="agent-console-content">
        <Show when={mode() === "shell"}>
          <div data-slot="agent-console-shell-notice">
            <Icon name="warning" size="small" />
            <span>{language.t("agentConsole.shell.directWarning")}</span>
          </div>
        </Show>
        <div
          data-slot="agent-console-layers"
          data-expanded={shellState().status === "busy" || alternate() ? "" : undefined}
          data-alternate={alternate() ? "" : undefined}
        >
          <section data-slot="agent-console-activity" data-active={mode() === "agent" ? "" : undefined}>
            <HybridTimeline
              activities={activities}
              footer={permissionCard}
              footerTarget={() => permission()?.tool}
              error={inputError}
              failures={failures}
              retry={retry}
            />
          </section>
          <Show when={mode() === "agent" && gate().label}>
            {(label) => (
              <div data-slot="agent-console-route-status">
                <span>{label()}</span>
                <Show when={gate().action === "recover"}>
                  <Button size="small" variant="ghost" onClick={recover}>
                    恢复
                  </Button>
                </Show>
                <Show when={gate().action === "restart"}>
                  <Button size="small" variant="ghost" onClick={restart}>
                    重启
                  </Button>
                </Show>
              </div>
            )}
          </Show>
          <div data-slot="agent-console-terminal" data-active="">
            <Show
              when={props.shell ?? terminal()}
              fallback={
                <div data-slot="agent-console-terminal-state">
                  <Icon name={error() ? "circle-x" : "console"} size="large" />
                  <span>{error() ?? language.t("agentConsole.shell.starting")}</span>
                </div>
              }
            >
              {props.shell?.(bind) ??
                (() => {
                  const current = terminal()
                  if (!current) return null
                  return (
                    <TerminalTab
                      terminalId={current.id}
                      socket={() => new AgentConsoleSocket(vscode, current.id)}
                      font={current.font}
                      active={true}
                      focus={true}
                      resizeType="agentConsole.terminal.resize"
                      fontType="agentConsole.terminal.fontChanged"
                      shortcuts={false}
                      bind={bind}
                      inputEnabled={
                        mode() === "shell"
                          ? shellState().status === "ready" || shellState().status === "busy"
                          : shellState().status === "busy" || gate().submit
                      }
                      captureInput={mode() === "agent" && shellState().status === "ready"}
                      capture={captureInput}
                      dirty={setDirty}
                      screen={setAlternate}
                      foreground="#fff"
                      connection={connection}
                      diagnostic={(event, detail) =>
                        vscode.postMessage({
                          type: "agentConsole.terminal.diagnostic",
                          terminalId: current.id,
                          event,
                          detail,
                        })
                      }
                    />
                  )
                })()}
            </Show>
          </div>
        </div>
      </section>
    </main>
  )
}
