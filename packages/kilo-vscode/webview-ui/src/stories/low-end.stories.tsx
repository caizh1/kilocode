/** @jsxImportSource solid-js */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import Settings from "../components/settings/Settings"
import { ChatView } from "../components/chat/ChatView"
import HistoryView from "../components/history/HistoryView"
import { AgentConsoleContent } from "../../agent-console/AgentConsoleApp"
import { TerminalTab, type TerminalSocket } from "../../agent-manager/terminal/TerminalTab"
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
import "../../agent-console/agent-console.css"
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
  location: index < 10 ? "builtin" : `/project/.kilo/skills/qa-skill-${index}`,
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
  plugin: ["@kilocode/kilo-indexing"],
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
    paths: Array.from({ length: 50 }, (_, index) => `/project/.kilo/skills/qa-${index}`),
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

const consoleSession = {
  ...session,
  messages: () => [],
  visibleMessages: () => [],
  userMessages: () => [],
  allMessages: () => ({}),
  allParts: () => ({}),
  getParts: () => [],
}

type TerminalScenario = "mixed" | "burst" | "bytes"

interface TerminalStats {
  scenario: TerminalScenario | null
  state: "idle" | "running" | "complete" | "stopped"
  frames: number
  bytes: number
  received: number
  commands: number
  interrupts: number
  expectedTail: string
  input: string
}

interface TerminalQA {
  start(scenario: TerminalScenario): Promise<TerminalStats>
  stop(): TerminalStats
  stats(): TerminalStats
  transcript(): { emitted: string; received: string; input: string }
}

declare global {
  interface Window {
    __chipmateTerminalQA?: TerminalQA
  }
}

const wait = (delay: number) => new Promise<void>((resolve) => window.setTimeout(resolve, delay))

class FixtureSocket implements TerminalSocket {
  binaryType: BinaryType = "arraybuffer"
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  #ready: number = WebSocket.CONNECTING
  #run = 0
  #input = ""
  #emitted = ""
  #received = ""
  #stats: TerminalStats = {
    scenario: null,
    state: "idle",
    frames: 0,
    bytes: 0,
    received: 0,
    commands: 0,
    interrupts: 0,
    expectedTail: "",
    input: "",
  }

  constructor() {
    window.setTimeout(() => {
      if (this.#ready !== WebSocket.CONNECTING) return
      this.#ready = WebSocket.OPEN
      this.onopen?.(new Event("open"))
      this.#emit("\x1b[2J\x1b[HCHIPMATE_TERMINAL_READY\r\n$ ")
    }, 0)
  }

  get readyState() {
    return this.#ready
  }

  snapshot(): TerminalStats {
    return {
      ...this.#stats,
      received: new TextEncoder().encode(this.#received).byteLength,
      input: this.#input,
    }
  }

  received(data: string) {
    this.#received += data
  }

  transcript() {
    return { emitted: this.#emitted, received: this.#received, input: this.#input }
  }

  async start(scenario: TerminalScenario): Promise<TerminalStats> {
    const run = ++this.#run
    this.#emitted = ""
    this.#received = ""
    this.#stats = {
      scenario,
      state: "running",
      frames: 0,
      bytes: 0,
      received: 0,
      commands: this.#stats.commands,
      interrupts: this.#stats.interrupts,
      expectedTail: `CHIPMATE_${scenario.toUpperCase()}_DONE`,
      input: this.#input,
    }
    if (scenario === "burst") {
      for (let offset = 0; offset < 5_000; offset += 100) {
        if (run !== this.#run) return this.snapshot()
        const lines = Array.from(
          { length: 100 },
          (_, index) => `BURST-${(offset + index).toString().padStart(4, "0")}: ${"x".repeat(72)}\r\n`,
        ).join("")
        this.#emit(offset ? lines : `\x1b[2J\x1b[H${lines}`)
        await wait(0)
      }
      this.#emit(`${this.#stats.expectedTail}\r\n$ `)
    }
    if (scenario === "mixed") {
      const frames = [
        "\x1b[2J\x1b[HSTATIC plain terminal output\r\n",
        "\x1b[31mANSI red\x1b[0m \x1b[32mANSI green\x1b[0m \x1b[34mANSI blue\x1b[0m\r\n",
        "PROGRESS 000%\rPROGRESS 050%\rPROGRESS 100%\r\n",
        "BACKSPACE: ABC\b\bXY\r\n",
        "中文宽字符：终端布局校验；emoji：😀 🫠 👨‍👩‍👧‍👦 🏳️‍🌈\r\n",
        `${"LONG-LINE-".repeat(180)}\r\n`,
        "\x1b[2J\x1b[HCLEAR-SCREEN-RECOVERED\r\n",
        `${this.#stats.expectedTail}\r\n$ `,
      ]
      for (const frame of frames) {
        if (run !== this.#run) return this.snapshot()
        this.#emit(frame)
        await wait(24)
      }
    }
    if (scenario === "bytes") {
      const text = Array.from(
        { length: 40 },
        (_, index) => `BYTE-${index.toString().padStart(4, "0")}|`,
      ).join("")
      for (const byte of new TextEncoder().encode(`${text}${this.#stats.expectedTail}\r\n$ `)) {
        if (run !== this.#run) return this.snapshot()
        this.#emit(Uint8Array.of(byte).buffer)
        if (this.#stats.frames % 64 === 0) await wait(1)
      }
    }
    if (run === this.#run) this.#stats.state = "complete"
    return this.snapshot()
  }

  stop(): TerminalStats {
    this.#run += 1
    this.#stats.state = "stopped"
    return this.snapshot()
  }

  send(data: string) {
    if (this.#ready !== WebSocket.OPEN) return
    this.#input += data
    if (data.includes("\x03")) {
      this.#stats.interrupts += 1
      this.#emit("^C\r\nCHIPMATE_INTERRUPT_ACK\r\n$ ")
      return
    }
    this.#emit(data === "\r" ? "\r\n" : data)
    const commands = this.#input.split("\r")
    this.#input = commands.pop() ?? ""
    for (const command of commands) {
      this.#stats.commands += 1
      this.#emit(`CHIPMATE_COMMAND_${this.#stats.commands}:${command}\r\n$ `)
    }
  }

  close() {
    if (this.#ready === WebSocket.CLOSED) return
    this.#run += 1
    this.#ready = WebSocket.CLOSED
    this.onclose?.(new CloseEvent("close", { code: 1000, reason: "fixture-disposed", wasClean: true }))
  }

  #emit(data: string | ArrayBuffer) {
    if (this.#ready !== WebSocket.OPEN) return
    const bytes = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength
    this.#emitted += typeof data === "string" ? data : new TextDecoder().decode(data)
    this.#stats.frames += 1
    this.#stats.bytes += bytes
    this.onmessage?.(new MessageEvent("message", { data }))
  }
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
            <div style={{ "min-height": 0, flex: 1 }}>
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

function ConsoleFixture() {
  const [open, setOpen] = createSignal(false)
  const tabs = sessions.slice(0, 4)
  return (
    <StoryProviders noPadding locale="zh" config={config} sessionID={sessions[0].id} session={consoleSession}>
      <Show
        when={open()}
        fallback={
          <div style={{ padding: "24px" }}>
            <Button data-ui="low-end-open-console" onClick={() => setOpen(true)}>
              打开 Agent Console
            </Button>
          </div>
        }
      >
        <div style={{ width: "100vw", height: "100vh", display: "flex", "flex-direction": "column" }}>
          <div data-ui="low-end-console-sessions" style={{ display: "flex", gap: "8px", padding: "8px" }}>
            <For each={tabs}>{(item) => <span>{item.title}</span>}</For>
          </div>
          <div style={{ "min-height": 0, height: 0, flex: 1, overflow: "hidden" }}>
            <ConsoleTerminal />
          </div>
        </div>
      </Show>
    </StoryProviders>
  )
}

function ConsoleTerminal() {
  let socket: FixtureSocket | undefined
  const qa: TerminalQA = {
    start: (scenario) => {
      if (!socket) throw new Error("Terminal fixture socket is not mounted")
      return socket.start(scenario)
    },
    stop: () => socket?.stop() ?? emptyStats(),
    stats: () => socket?.snapshot() ?? emptyStats(),
    transcript: () => socket?.transcript() ?? { emitted: "", received: "", input: "" },
  }
  onMount(() => {
    window.__chipmateTerminalQA = qa
  })
  onCleanup(() => {
    if (window.__chipmateTerminalQA === qa) delete window.__chipmateTerminalQA
    socket?.close()
  })
  const terminal = (
    <div data-ui="low-end-console-output" style={{ width: "100%", height: "100%", "min-height": 0 }}>
      <TerminalTab
        terminalId="low-end-real-xterm"
        socket={() => {
          socket = new FixtureSocket()
          return socket
        }}
        font={{ fontFamily: "monospace", fontSize: 13 }}
        active={true}
        focus={true}
        shortcuts={false}
        foreground="#fff"
        output={(value) => socket?.received(value)}
      />
    </div>
  )
  return (
    <AgentConsoleContent
      initialMode="shell"
      shell={terminal}
    />
  )
}

function emptyStats(): TerminalStats {
  return {
    scenario: null,
    state: "idle",
    frames: 0,
    bytes: 0,
    received: 0,
    commands: 0,
    interrupts: 0,
    expectedTail: "",
    input: "",
  }
}

export const AgentConsole: Story = {
  name: "Agent Console fixture",
  render: () => <ConsoleFixture />,
}
