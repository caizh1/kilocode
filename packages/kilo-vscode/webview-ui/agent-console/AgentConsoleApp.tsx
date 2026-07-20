/** @jsxImportSource solid-js */

import { type Component, type JSX, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { PermissionDock } from "../src/components/chat/PermissionDock"
import { editPermission, permissionPresentation } from "../src/components/chat/permission-presentation"
import { useLanguage } from "../src/context/language"
import { useServer } from "../src/context/server"
import { useSession } from "../src/context/session"
import { useVSCode } from "../src/context/vscode"
import { TerminalTab } from "../agent-manager/terminal/TerminalTab"
import type { TerminalWriter } from "../agent-manager/terminal/state"
import type { TerminalFont } from "../src/types/messages/agent-manager"
import type { PermissionRequest } from "../src/types/messages"
import { HybridPrompt } from "./HybridPrompt"
import { HybridTimeline, type ShellEntry } from "./HybridTimeline"

type Mode = "agent" | "shell"

interface TerminalState {
  id: string
  title: string
  wsUrl: string
  font: TerminalFont
}

interface Props {
  initialMode?: Mode
  initialEntries?: ShellEntry[]
  shell?: JSX.Element
}

function name(path: string | undefined): string {
  if (!path) return "Workspace"
  const clean = path.replace(/[\\/]+$/, "")
  return clean.split(/[\\/]/).pop() || clean
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
  const [entries, setEntries] = createSignal<ShellEntry[]>(props.initialEntries ?? [])
  const [inputError, setInputError] = createSignal<string>()
  let writer: TerminalWriter | undefined
  let active: string | undefined
  let quiet: ReturnType<typeof setTimeout> | undefined

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
    vscode.postMessage({ type: "agentConsole.shell.restart" })
  }

  const close = () => {
    const current = terminal()
    if (!current) return
    vscode.postMessage({ type: "agentConsole.terminal.close", terminalId: current.id })
  }

  const reset = () => {
    session.clearCurrentSession()
    setEntries([])
    setInputError(undefined)
    vscode.postMessage({ type: "agentConsole.session.new" })
    requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))
  }

  createEffect(() => {
    create()
  })

  const bind = (next: TerminalWriter) => {
    writer = next
    return () => {
      if (writer === next) writer = undefined
    }
  }

  const settle = () => {
    if (!active) return
    const id = active
    setEntries((items) => items.map((item) => (item.id === id ? { ...item, state: "complete" } : item)))
  }

  const finish = () => {
    settle()
    active = undefined
  }

  const output = (data: string) => {
    if (!active) return
    const id = active
    setEntries((items) =>
      items.map((item) => (item.id === id ? { ...item, output: item.output + data, state: "running" as const } : item)),
    )
    clearTimeout(quiet)
    quiet = setTimeout(settle, 450)
  }

  const shell = (command: string) => {
    clearTimeout(quiet)
    finish()
    setInputError(undefined)
    const id = crypto.randomUUID()
    const entry: ShellEntry = { id, command, output: "", created: Date.now(), state: "running" }
    setEntries((items) => [...items, entry])
    active = id
    if (writer?.(`${command}\r`)) return
    active = undefined
    setEntries((items) =>
      items.map((item) =>
        item.id === id ? { ...item, state: "error", output: "Shell 尚未连接，请稍后重试。" } : item,
      ),
    )
  }

  const agent = (input: string) => {
    finish()
    setInputError(undefined)
    const selected = session.selected()
    if (!selected) {
      setInputError("尚未选择可用模型，请先在 ChipMate 设置中配置内网模型。")
      return
    }
    session.sendMessage(input, selected.providerID, selected.modelID)
  }

  const interrupt = () => {
    writer?.("\x03")
    finish()
  }

  const permissions = createMemo(() => session.scopedPermissions(session.currentSessionID()))
  const permission = () => {
    const id = session.currentSessionID()
    return permissions().find((item) => item.sessionID === id) ?? permissions()[0]
  }

  const decide = (response: "once" | "reject", approved: string[], denied: string[]) => {
    const request = permission()
    if (!request || session.respondingPermissions().has(request.id)) return
    session.respondToPermission(request.id, response, approved, denied)
  }

  const edit = (request: PermissionRequest) => {
    editPermission(
      request,
      session.respondingPermissions().has(request.id),
      () => session.respondToPermission(request.id, "reject", [], []),
      (text) => window.dispatchEvent(new CustomEvent("prefillPrompt", { detail: { text } })),
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

  onMount(() => {
    const dispose = vscode.onMessage((message) => {
      if (message.type === "agentConsole.terminal.created") {
        setTerminal({
          id: message.terminalId,
          title: message.title,
          wsUrl: message.wsUrl,
          font: message.font,
        })
        setPending(false)
        setError(undefined)
        return
      }
      if (message.type === "agentConsole.terminal.closed") {
        if (terminal()?.id === message.terminalId) setTerminal(undefined)
        setPending(false)
        return
      }
      if (message.type === "agentConsole.terminal.error") {
        setPending(false)
        setError(message.message)
        return
      }
      if (message.type !== "agentConsole.terminal.fontChanged") return
      setTerminal((current) => (current ? { ...current, font: message.font } : current))
    })
    onCleanup(() => {
      clearTimeout(quiet)
      dispose()
    })
  })

  const state = () => server.connectionState()
  const connected = () => state() === "connected"

  return (
    <main data-component="agent-console" data-mode={mode()}>
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
          <span data-slot="agent-console-connection" data-state={state()}>
            <span data-slot="agent-console-connection-dot" />
            {connected()
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
                onClick={reset}
              />
            </Tooltip>
            <Tooltip value={language.t("agentConsole.action.clear")} placement="bottom">
              <IconButton
                icon="trash"
                size="small"
                variant="ghost"
                label={language.t("agentConsole.action.clear")}
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
        <div data-slot="agent-console-pane" data-pane="agent" data-active={mode() === "agent" ? "" : undefined}>
          <HybridTimeline entries={entries} footer={permissionCard} />
          <Show when={inputError()}>{(message) => <div data-slot="agent-console-input-error">{message()}</div>}</Show>
          <HybridPrompt
            disabled={() => !connected() || !!permission()}
            onAgent={agent}
            onShell={shell}
            onInterrupt={interrupt}
          />
        </div>
        <div data-slot="agent-console-pane" data-pane="shell" data-active={mode() === "shell" ? "" : undefined}>
          <div data-slot="agent-console-shell-notice">
            <Icon name="warning" size="small" />
            <span>{language.t("agentConsole.shell.directWarning")}</span>
          </div>
          <div data-slot="agent-console-terminal">
            <Show
              when={props.shell ?? terminal()}
              fallback={
                <div data-slot="agent-console-terminal-state">
                  <Icon name={error() ? "circle-x" : "console"} size="large" />
                  <span>{error() ?? language.t("agentConsole.shell.starting")}</span>
                </div>
              }
            >
              {props.shell ??
                (() => {
                  const current = terminal()
                  if (!current) return null
                  return (
                    <TerminalTab
                      terminalId={current.id}
                      wsUrl={current.wsUrl}
                      font={current.font}
                      active={mode() === "shell"}
                      focus={mode() === "shell"}
                      resizeType="agentConsole.terminal.resize"
                      fontType="agentConsole.terminal.fontChanged"
                      shortcuts={false}
                      bind={bind}
                      output={output}
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
