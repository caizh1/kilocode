/** @jsxImportSource solid-js */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal, type Component } from "solid-js"
import { AgentConsoleContent } from "../../agent-console/AgentConsoleApp"
import { TerminalTab, type TerminalSocket } from "../../agent-manager/terminal/TerminalTab"
import type { TerminalWriter } from "../../agent-manager/terminal/state"
import "../../agent-console/agent-console.css"
import { StoryProviders, defaultMockData, mockSessionValue } from "./StoryProviders"
import { registerVscodeToolOverrides } from "../components/chat/VscodeToolOverrides"
import { SessionContext } from "../context/session"
import { ServerContext } from "../context/server"
import { WorktreeModeProvider } from "../context/worktree-mode"
import type { PermissionRequest } from "../types/messages"

registerVscodeToolOverrides()

const sid = "agent-console-story"
const uid = "agent-console-user"
const aid = "agent-console-assistant"
const now = 1_721_360_000_000

const messages = [
  {
    id: uid,
    sessionID: sid,
    role: "user",
    createdAt: new Date(now).toISOString(),
    time: { created: now },
  },
  {
    id: aid,
    sessionID: sid,
    role: "assistant",
    parentID: uid,
    createdAt: new Date(now + 1000).toISOString(),
    time: { created: now + 1000, completed: now + 1800 },
    modelID: "deepseek-v4-flash",
    providerID: "internal",
    mode: "default",
    agent: "agent-console",
    path: { cwd: "/project", root: "/project" },
    finish: "stop",
  },
]

const parts = {
  [uid]: [
    {
      id: "agent-console-user-text",
      sessionID: sid,
      messageID: uid,
      type: "text",
      text: "请清理 /tmp/example 目录，并在执行前说明风险。",
    },
  ],
  [aid]: [
    {
      id: "agent-console-assistant-text",
      sessionID: sid,
      messageID: aid,
      type: "text",
      text: "这个操作会递归删除目录内容，并且使用 sudo 提权。执行后通常无法恢复，因此需要你的明确批准。",
    },
  ],
}

const permission: PermissionRequest = {
  id: "agent-console-dangerous-bash",
  sessionID: sid,
  toolName: "agent_console_shell",
  patterns: ["sudo rm -rf /tmp/example"],
  always: [],
  args: {
    command: "sudo rm -rf /tmp/example",
    description: "高危操作：提权并永久删除目录内容。",
    rules: ["sudo *", "rm *"],
  },
  tool: { messageID: aid, callID: "agent-console-dangerous-call" },
}

const data = {
  ...defaultMockData,
  message: { [sid]: messages },
  part: parts,
}

const activity = [
  { seq: 1, time: now - 1000, kind: "idle" as const, data: "ChipMate local shell\r\n/project $ printf status\r\n" },
  {
    seq: 2,
    time: now + 2000,
    kind: "begin" as const,
    cwd: "/project",
    runId: "story-run",
    source: "direct" as const,
    command: "printf status",
  },
  {
    seq: 3,
    time: now + 2100,
    kind: "data" as const,
    data: "\x1b[32mstatus ok\x1b[0m\r\n\x1b[31mone warning\x1b[0m",
    runId: "story-run",
    source: "direct" as const,
  },
  {
    seq: 4,
    time: now + 2200,
    kind: "end" as const,
    cwd: "/project",
    exitCode: 0,
    runId: "story-run",
    source: "direct" as const,
  },
]

const server = {
  connectionState: () => "connected" as const,
  serverInfo: () => undefined,
  extensionVersion: () => "1.0.0",
  errorMessage: () => undefined,
  errorDetails: () => undefined,
  isConnected: () => true,
  profileData: () => null,
  deviceAuth: () => ({ status: "idle" as const }),
  startLogin: () => undefined,
  goToLogin: () => undefined,
  vscodeLanguage: () => "zh-cn",
  languageOverride: () => undefined,
  workspaceDirectory: () => "/project",
  gitInstalled: () => true,
}

class StorySocket implements TerminalSocket {
  binaryType: BinaryType = "arraybuffer"
  readyState: number = WebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor() {
    queueMicrotask(() => {
      this.readyState = WebSocket.OPEN
      this.onopen?.(new Event("open"))
      this.emit(
        "ChipMate local shell\r\n/project $ bun run typecheck\r\n\x1b[32mTypecheck passed\x1b[0m\r\n\x1b[31mCommand failed\x1b[0m\r\n/project $ ",
      )
    })
  }

  send(data: string): void {
    if (data.startsWith("\x18\x15")) {
      this.emit(`\r\x1b[2K/project $ ${data.slice(2)}`)
      return
    }
    this.emit(data)
    if (data === "\r") this.emit("\r\n/project $ ")
  }

  close(): void {
    this.readyState = WebSocket.CLOSED
  }

  private emit(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }))
  }
}

const Shell: Component<{ bind: (next: TerminalWriter) => () => void }> = (props) => (
  <TerminalTab
    terminalId="agent-console-story-shell"
    socket={() => new StorySocket()}
    font={{ fontFamily: "Consolas, Menlo, monospace", fontSize: 13 }}
    active={true}
    focus={true}
    shortcuts={false}
    foreground="#fff"
    bind={props.bind}
  />
)

const ImeDemo: Component = () => {
  const [count, setCount] = createSignal(0)
  return (
    <StoryProviders data={data} sessionID={sid} status="idle" locale="zh" noPadding>
      <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
        <output data-ui="agent-console-ime-captures">{count()}</output>
        <TerminalTab
          terminalId="agent-console-ime-shell"
          socket={() => new StorySocket()}
          font={{ fontFamily: "Consolas, Menlo, monospace", fontSize: 13 }}
          active={true}
          focus={true}
          shortcuts={false}
          foreground="#fff"
          captureInput={true}
          capture={() => {
            setCount((value) => value + 1)
            return "accepted"
          }}
        />
      </div>
    </StoryProviders>
  )
}

const Demo: Component<{ inline?: boolean; busy?: boolean }> = (props) => {
  const [permissions, setPermissions] = createSignal(props.inline ? [] : [permission])
  const [responding, setResponding] = createSignal(new Set<string>())
  const [entries, setEntries] = createSignal(activity)
  const session = {
    ...mockSessionValue({ id: sid, status: props.busy ? "busy" : "idle", permissions: permissions() }),
    messages: () => messages,
    visibleMessages: () => messages,
    userMessages: () => messages.filter((message) => message.role === "user"),
    getParts: (id: string) => parts[id as keyof typeof parts] ?? [],
    permissions,
    scopedPermissions: () => permissions(),
    respondingPermissions: responding,
    respondToPermission: (id: string) => {
      setResponding(new Set([id]))
      setPermissions((items) => items.filter((item) => item.id !== id))
    },
  }

  return (
    <StoryProviders data={data} sessionID={sid} status={props.busy ? "busy" : "idle"} locale="zh" noPadding>
      <ServerContext.Provider value={server}>
        <SessionContext.Provider value={session as never}>
          <WorktreeModeProvider>
            <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
              <button
                hidden
                data-ui="agent-console-stream-chunk"
                onClick={() =>
                  setEntries((items) =>
                    items.map((item) =>
                      item.seq === 3 && item.kind === "data"
                        ? { ...item, data: `${item.data}\r\n\x1b[36mstreamed tail\x1b[0m` }
                        : item,
                    ),
                  )
                }
              />
              <AgentConsoleContent
                shell={(bind) => <Shell bind={bind} />}
                activities={props.inline ? entries() : undefined}
              />
            </div>
          </WorktreeModeProvider>
        </SessionContext.Provider>
      </ServerContext.Provider>
    </StoryProviders>
  )
}

const meta: Meta = {
  title: "AgentConsole",
  parameters: { layout: "fullscreen" },
}

export default meta
type Story = StoryObj

export const Approval: Story = {
  name: "Agent timeline with high-risk approval",
  render: () => <Demo />,
}

export const Inline: Story = {
  name: "Inline terminal timeline",
  render: () => <Demo inline />,
}

export const Busy: Story = {
  name: "Shell prompt while Agent is busy",
  render: () => <Demo inline busy />,
}

export const RouteTimeout: Story = {
  name: "Single real shell input",
  render: () => <Demo inline />,
}

export const Ime: Story = {
  name: "Windows IME Enter routing",
  render: () => <ImeDemo />,
}
