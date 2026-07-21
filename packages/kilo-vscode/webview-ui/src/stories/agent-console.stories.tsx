/** @jsxImportSource solid-js */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal, type Component } from "solid-js"
import { AgentConsoleContent } from "../../agent-console/AgentConsoleApp"
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

const Shell: Component = () => {
  const [value, setValue] = createSignal("")
  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        "flex-direction": "column",
        gap: "8px",
        color: "#fff",
        "font-family": "var(--vscode-editor-font-family, monospace)",
        "font-size": "13px",
      }}
    >
      <div>ChipMate local shell</div>
      <div>/project $ bun run typecheck</div>
      <div style={{ color: "var(--vscode-testing-iconPassed, #40c463)" }}>Typecheck passed</div>
      <div style={{ color: "var(--vscode-errorForeground, #f14c4c)" }}>Command failed</div>
      <label style={{ display: "flex", gap: "8px", "align-items": "center" }}>
        <span>/project $</span>
        <input
          aria-label="输入 Shell 命令"
          value={value()}
          onInput={(event) => setValue(event.currentTarget.value)}
          style={{
            flex: "1",
            border: "0",
            outline: "0",
            color: "inherit",
            background: "transparent",
            "font-family": "inherit",
          }}
        />
      </label>
    </div>
  )
}

const Demo: Component<{ inline?: boolean; busy?: boolean; timeout?: number }> = (props) => {
  const [permissions, setPermissions] = createSignal(props.inline ? [] : [permission])
  const [responding, setResponding] = createSignal(new Set<string>())
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
              <AgentConsoleContent
                shell={<Shell />}
                activities={props.inline ? activity : undefined}
                routeTimeout={props.timeout}
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
  name: "Editable prompt while Agent is busy",
  render: () => <Demo inline busy />,
}

export const RouteTimeout: Story = {
  name: "Route timeout preserves input",
  render: () => <Demo inline timeout={50} />,
}
