/** @jsxImportSource solid-js */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Show, createSignal, onMount } from "solid-js"
import { Button } from "@chipmate/chipmate-ui/button"
import Settings from "../components/settings/Settings"
import { ChatView } from "../components/chat/ChatView"
import HistoryView from "../components/history/HistoryView"
import type {
  AgentInfo,
  Config,
  IndexingStatus,
  Message,
  Part,
  Provider,
  SessionInfo,
  SkillInfo,
} from "../types/messages"
import { StoryProviders, defaultMockData } from "./StoryProviders"
import { CHIPMATE_SERVER_KEY } from "../../../src/shared/chipmate-server"
import "../../agent-manager/agent-manager.css"

const meta: Meta = {
  title: "Performance/LowEnd",
  parameters: { layout: "fullscreen" },
}

export default meta
type Story = StoryObj

const providers = Object.fromEntries(
  Array.from({ length: 20 }, (_, provider) => {
    const id = `qa-provider-${provider.toString().padStart(2, "0")}`
    const models = Object.fromEntries(
      Array.from({ length: 15 }, (_, model) => {
        const key = `qa-model-${model.toString().padStart(2, "0")}`
        return [
          key,
          {
            id: key,
            name: `QA Model ${provider + 1}.${model + 1}`,
            limit: { context: 32_768, output: 4_096 },
          },
        ]
      }),
    )
    return [id, { id, name: `QA Provider ${provider + 1}`, source: "config" as const, models }]
  }),
) satisfies Record<string, Provider>

const agents: AgentInfo[] = Array.from({ length: 30 }, (_, index) => ({
  name: `qa-agent-${index.toString().padStart(2, "0")}`,
  displayName: `QA Agent ${index + 1}`,
  description: `Deterministic low-end fixture agent ${index + 1}`,
  mode: index % 3 === 0 ? "subagent" : "primary",
  native: index < 5,
}))

const skills: SkillInfo[] = Array.from({ length: 100 }, (_, index) => ({
  name: `qa-skill-${index.toString().padStart(3, "0")}`,
  description: `Deterministic low-end fixture skill ${index + 1}`,
  location: index < 10 ? "builtin" : `/project/.chipmate/skills/qa-skill-${index}`,
  scope: index % 2 === 0 ? "project" : "global",
}))

const sessions: SessionInfo[] = Array.from({ length: 100 }, (_, index) => {
  const stamp = Date.now() - index * 60_000
  return {
    id: `qa-session-${index.toString().padStart(3, "0")}`,
    title: `Low-end history session ${index + 1}`,
    createdAt: new Date(stamp - 10_000).toISOString(),
    updatedAt: new Date(stamp).toISOString(),
  }
})

const messages: Message[] = Array.from({ length: 1_000 }, (_, index) => {
  const role = index % 2 === 0 ? "user" : "assistant"
  const stamp = 1_720_000_000_000 + index * 1_000
  return {
    id: `qa-message-${index.toString().padStart(4, "0")}`,
    sessionID: sessions[0].id,
    role,
    createdAt: new Date(stamp).toISOString(),
    time: { created: stamp, completed: role === "assistant" ? stamp + 800 : undefined },
    ...(role === "assistant"
      ? {
          parentID: `qa-message-${(index - 1).toString().padStart(4, "0")}`,
          modelID: "qa-model-00",
          providerID: "qa-provider-00",
          agent: "qa-agent-00",
          path: { cwd: "/project", root: "/project" },
        }
      : {}),
  }
})

const parts = Object.fromEntries(
  messages.map((message, index) => [
    message.id,
    [
      {
        id: `qa-part-${index.toString().padStart(4, "0")}`,
        sessionID: message.sessionID,
        messageID: message.id,
        type: "text" as const,
        text: `${message.role === "user" ? "User" : "Assistant"} deterministic performance fixture turn ${index + 1}.`,
      },
    ] satisfies Part[],
  ]),
)

const data = {
  ...defaultMockData,
  session: sessions,
  message: { [sessions[0].id]: messages },
  part: parts,
}

const config = {
  plugin: ["@chipmate/chipmate-indexing"],
  model: "qa-provider-00/qa-model-00",
  provider: Object.fromEntries(
    Object.keys(providers).map((id) => [
      id,
      { npm: "@ai-sdk/openai-compatible", name: providers[id].name, options: { baseURL: "http://127.0.0.1:6001/v1" } },
    ]),
  ),
  agent: Object.fromEntries(agents.map((agent) => [agent.name, { description: agent.description, mode: agent.mode }])),
  mcp: Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `qa-mcp-${index.toString().padStart(2, "0")}`,
      { type: "local", command: ["printf", `qa-mcp-${index}`], enabled: true },
    ]),
  ),
  instructions: Array.from({ length: 100 }, (_, index) => `qa/instructions/${index}.md`),
  skills: {
    paths: Array.from({ length: 50 }, (_, index) => `/project/.chipmate/skills/qa-${index}`),
    urls: Array.from({ length: 50 }, (_, index) => `https://qa.invalid/skills/${index}`),
  },
  indexing: {
    enabled: true,
    provider: "openai-compatible",
    model: "qa-embedding",
    dimension: 2_048,
    vectorStore: "lancedb",
    "openai-compatible": { baseUrl: "http://127.0.0.1:6001/v1", apiKey: "qa-redacted" },
  },
} as Config

const indexing: IndexingStatus = {
  state: "In Progress",
  message: "Deterministic low-end indexing fixture",
  processedFiles: 630,
  totalFiles: 1_000,
  percent: 63,
  pipelines: {
    codeGraph: {
      state: "Complete",
      message: "Code Graph complete",
      processedFiles: 1_000,
      totalFiles: 1_000,
      percent: 100,
      errorCount: 0,
      staleCount: 0,
      skippedCount: 0,
    },
    rag: {
      state: "In Progress",
      message: "Code RAG indexing",
      processedFiles: 630,
      totalFiles: 1_000,
      percent: 63,
      errorCount: 0,
      staleCount: 0,
      skippedCount: 0,
    },
    documents: {
      state: "Standby",
      message: "Document RAG waiting",
      processedFiles: 0,
      totalFiles: 50,
      percent: 0,
      errorCount: 0,
      staleCount: 0,
      skippedCount: 0,
    },
  },
}

const session = {
  currentSessionID: () => sessions[0].id,
  currentSession: () => sessions[0],
  sessions: () => sessions,
  messages: () => messages,
  visibleMessages: () => messages,
  userMessages: () => messages.filter((message) => message.role === "user"),
  allMessages: () => ({ [sessions[0].id]: messages }),
  allParts: () => parts,
  getParts: (id: string) => parts[id] ?? [],
  agents: () => agents.filter((agent) => agent.mode !== "subagent"),
  allAgents: () => agents,
  skills: () => skills,
  loadSessions: () => undefined,
}

function SettingsFixture() {
  const [open, setOpen] = createSignal(false)
  onMount(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "indexingStatusLoaded", status: indexing } }))
  })
  return (
    <StoryProviders
      noPadding
      locale="zh"
      config={config}
      settings={{ [CHIPMATE_SERVER_KEY]: "http://127.0.0.1:6001" }}
      features={{ indexing: true }}
      providers={providers}
      connected={Object.keys(providers)}
      session={session}
      saveDelay={300}
    >
      <Show
        when={open()}
        fallback={
          <div style={{ padding: "24px" }}>
            <Button data-ui="low-end-open-settings" onClick={() => setOpen(true)}>
              打开设置
            </Button>
          </div>
        }
      >
        <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
          <Settings />
        </div>
      </Show>
    </StoryProviders>
  )
}

export const SettingsHeavy: Story = {
  name: "Settings heavy fixture",
  render: () => <SettingsFixture />,
}

function ChatHistoryFixture() {
  const [history, setHistory] = createSignal(false)
  return (
    <StoryProviders noPadding locale="zh" config={config} data={data} sessionID={sessions[0].id} session={session}>
      <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
        <Show
          when={!history()}
          fallback={
            <div data-ui="low-end-history-screen" style={{ height: "100%" }}>
              <HistoryView onSelectSession={() => setHistory(false)} onBack={() => setHistory(false)} />
            </div>
          }
        >
          <div style={{ height: "100%", display: "flex", "flex-direction": "column" }}>
            <div style={{ padding: "8px", "flex-shrink": 0 }}>
              <Button data-ui="low-end-history-open" onClick={() => setHistory(true)}>
                历史记录
              </Button>
            </div>
            {/* 与实际 Webview 的 .container 一样提供受限的 flex 高度，避免虚拟列表把全部历史当成可见区。 */}
            <div style={{ "min-height": 0, flex: 1, display: "flex", "flex-direction": "column" }}>
              <ChatView onShowHistory={() => setHistory(true)} />
            </div>
          </div>
        </Show>
      </div>
    </StoryProviders>
  )
}

export const LongHistory: Story = {
  name: "Long history fixture",
  render: () => <ChatHistoryFixture />,
}
