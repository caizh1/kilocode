/** @jsxImportSource solid-js */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import type { ChatConversationViewNode } from "@deepseek-ai/dsh-client-runtime/client"
import { createSignal, onCleanup, onMount, type Component } from "solid-js"
import {
  DeepSeekHarnessComposer,
  DeepSeekHarnessConversation,
} from "../components/deepseek-harness/DeepSeekHarnessConversation"
import { DeepSeekHarnessTaskHeader } from "../components/deepseek-harness/DeepSeekHarnessTaskHeader"
import { DeepSeekHarnessContext, type DeepSeekHarnessContextValue } from "../context/deepseek-harness"
import type { OfficialConversation } from "../context/deepseek-harness-official-client"
import { StoryProviders } from "./StoryProviders"

const model = { providerID: "newapi", modelID: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }
const sessionId = "story-dsh-session"

function node(id: string, kind: string, data: unknown, anchorSeq: number): ChatConversationViewNode {
  return {
    key: id,
    id,
    kind,
    target: "chat",
    anchorSeq,
    location: {} as never,
    visibility: "visible",
    data,
  }
}

function tool(id: string, callView: unknown, resultView: unknown, anchorSeq: number): ChatConversationViewNode {
  return node(
    id,
    "tool-call",
    {
      root: {
        kind: "tool-result",
        seq: anchorSeq,
        time: 1_787_031_866_000 + anchorSeq,
        callId: id,
        call: { name: "official_tool", argsRaw: "{}" },
        callTime: 1_787_031_866_000,
        content: [{ type: "text", text: "官方工具原始结果" }],
        isError: false,
        callView,
        resultView,
        subCalls: [],
      },
    },
    anchorSeq,
  )
}

const longAnswer = Array.from(
  { length: 18 },
  (_, index) => `第 ${index + 1} 段：这是用于验证 ChipMate DeepSeek Harness 长回答滚动边界的内容。`,
).join("\n\n")

function conversation(extra = "", running = false, reasoningEffort = "high"): OfficialConversation {
  const rows = [
    node("user-1", "user", { content: [{ type: "text", text: "请分析这个工作区并给出完整回答。" }] }, 1),
    node(
      "context-1",
      "context",
      { content: [{ type: "text", text: "Current runtime context: workspace-write; approval policy: ask." }] },
      2,
    ),
    node(
      "assistant-1",
      "assistant-step",
      {
        status: running ? "running" : "completed",
        blocks: [
          {
            kind: "text",
            text: `<think>先确认约束，再逐项检查证据。</think>${longAnswer}`,
          },
        ],
      },
      3,
    ),
    tool(
      "tool-terminal",
      { card: "terminal", title: "printf 验证", description: "执行官方持久 Bash", cwd: "/workspace" },
      { card: "terminal", output: "ok", exitCode: 0 },
      5,
    ),
    tool(
      "tool-diff",
      { card: "diff", title: "编辑 main.c", diffs: [{ path: "main.c", oldText: "return 0;", newText: "return 1;" }] },
      { card: "diff", diffs: [{ path: "main.c", oldText: "return 0;", newText: "return 1;" }] },
      6,
    ),
    tool(
      "tool-search",
      { card: "generic", title: "搜索符号", kind: "search" },
      { card: "search", shape: "paths", paths: ["src/main.c", "src/main.h"], total: 2, truncated: false },
      7,
    ),
    tool(
      "tool-read",
      { card: "generic", title: "读取 main.c", kind: "read" },
      { card: "read", path: "src/main.c", offset: 1, lines: [{ number: 1, text: "int main(void) {}" }], totalLines: 1 },
      8,
    ),
    tool(
      "tool-web",
      { card: "generic", title: "查询官方资料", kind: "fetch" },
      { card: "web", kind: "fetch", url: "https://example.test/reference", statusCode: 200, truncated: false },
      9,
    ),
    node(
      "assistant-2",
      "assistant-step",
      {
        status: "completed",
        blocks: [
          { kind: "reasoning", text: "这是官方 reasoning 块，用于验证原生投影优先级。" },
          { kind: "text", text: `最后一条可见回答。${extra}` },
        ],
      },
      10,
    ),
    node(
      "tail-1",
      "turn-tail",
      { turn: 1, seq: 18, time: 1_787_031_866_836, branchUnavailable: true, ttftMs: 420, tokensPerSecond: 31.5 },
      11,
    ),
  ]
  const nodes = new Map(rows.map((item) => [item.key, item]))
  return {
    session: {} as never,
    header: {
      sessionId,
      title: "官方会话：platform/driver gcc适配与单测代码审查",
      loading: false,
    },
    reasoning: {
      efforts: [
        { id: "off", name: "Off" },
        { id: "high", name: "High" },
        { id: "max", name: "Max" },
      ],
      value: reasoningEffort,
    },
    snapshot: {
      sessionId,
      running,
      pending: [],
      chat: { order: rows.map((item) => item.key), nodes },
    } as never,
  }
}

const unavailableModel = { providerID: "gateway", modelID: "deepseek-gateway", name: "DeepSeek Gateway" }
const backupModel = { providerID: "backup-newapi", modelID: "deepseek-backup", name: "DeepSeek Backup" }
const hostOnlyModel = { providerID: "host-newapi", modelID: "deepseek-host-only", name: "DeepSeek Host Only" }

const HarnessStory: Component<{
  preset?: "standard" | "minimal"
  scenario?: "ready" | "provider-required" | "no-provider" | "switch-confirmation"
}> = (props) => {
  const preset = () => props.preset ?? "minimal"
  const scenario = () => props.scenario ?? "ready"
  const [official, setOfficial] = createSignal(conversation("", true))
  const [configured, setConfigured] = createSignal(scenario() !== "no-provider")
  const providerOptions = () => [
    {
      providerID: unavailableModel.providerID,
      providerName: "内部 Gateway",
      available: false,
      reason: "unsupported-auth" as const,
      models: [unavailableModel],
    },
    ...(configured()
      ? [
          {
            providerID: model.providerID,
            providerName: "NewAPI",
            available: true,
            models: [model],
          },
          {
            providerID: backupModel.providerID,
            providerName: "备用 NewAPI",
            available: true,
            models: [backupModel],
          },
          {
            providerID: hostOnlyModel.providerID,
            providerName: "宿主权威 NewAPI",
            available: true,
            models: [hostOnlyModel],
          },
        ]
      : []),
  ]
  const snapshot = () => ({
    state:
      scenario() === "provider-required" || scenario() === "no-provider"
        ? ("provider-selection-required" as const)
        : scenario() === "switch-confirmation"
          ? ("provider-switch-confirmation-required" as const)
          : ("ready" as const),
    active: true,
    sessions: [],
    models: [model],
    providerOptions: providerOptions(),
    selectionState:
      scenario() === "ready"
        ? ("ready" as const)
        : scenario() === "switch-confirmation"
          ? ("restart-required" as const)
          : ("required" as const),
    connectionGeneration: 1,
    running: official().snapshot.running,
    sessionId,
    selectedModel: configured() ? model : undefined,
    desiredSelection: configured() ? (scenario() === "switch-confirmation" ? backupModel : model) : undefined,
    runningSelection: configured() ? model : undefined,
    expectedAgentPreset: preset(),
    agentPreset: preset(),
    presetState: "ready" as const,
    readOnlySession: false,
  })
  const value: DeepSeekHarnessContextValue = {
    active: () => true,
    snapshot,
    conversation: official,
    operationError: () => undefined,
    pending: () => [],
    readyForInput: () => scenario() === "ready",
    eligible: () => [model],
    selectedModel: () => model,
    activate: () => undefined,
    deactivate: () => undefined,
    send: async () => undefined,
    cancel: async () => undefined,
    selectModel: async () => undefined,
    selectReasoningEffort: async (effort) => {
      setOfficial((current) => ({
        ...current,
        reasoning: current.reasoning ? { ...current.reasoning, value: effort } : undefined,
      }))
    },
    post: () => undefined,
  }

  const append = () => setOfficial(conversation("\n\n新增流式内容，用于验证自动跟随和用户暂停滚动。", true))
  const updateTitle = () =>
    setOfficial((current) => ({
      ...current,
      header: { ...current.header, title: "官方会话：标题已更新" },
    }))
  const mismatchTitle = () =>
    setOfficial((current) => ({
      ...current,
      header: { sessionId: "other-official-session", title: "其他官方会话", loading: false },
    }))
  const configure = () => setConfigured(true)
  const invalidate = () => setConfigured(false)
  onMount(() => window.addEventListener("chipmate:dsh-story-append", append))
  onMount(() => window.addEventListener("chipmate:dsh-story-update-title", updateTitle))
  onMount(() => window.addEventListener("chipmate:dsh-story-mismatch-title", mismatchTitle))
  onMount(() => window.addEventListener("chipmate:dsh-story-configure-provider", configure))
  onMount(() => window.addEventListener("chipmate:dsh-story-invalidate-provider", invalidate))
  onCleanup(() => {
    window.removeEventListener("chipmate:dsh-story-append", append)
    window.removeEventListener("chipmate:dsh-story-update-title", updateTitle)
    window.removeEventListener("chipmate:dsh-story-mismatch-title", mismatchTitle)
    window.removeEventListener("chipmate:dsh-story-configure-provider", configure)
    window.removeEventListener("chipmate:dsh-story-invalidate-provider", invalidate)
  })

  return (
    <DeepSeekHarnessContext.Provider value={value}>
      <div class="container" style={{ height: "640px" }}>
        <div class="chat-view" data-ui="qa-shell">
          <DeepSeekHarnessTaskHeader />
          <div class="chat-messages-wrapper" data-ui="qa-conversation">
            <div class="chat-messages">
              <DeepSeekHarnessConversation />
            </div>
          </div>
          <div class="chat-input" data-ui="qa-dock">
            <DeepSeekHarnessComposer />
          </div>
        </div>
      </div>
    </DeepSeekHarnessContext.Provider>
  )
}

const meta = {
  title: "DeepSeek Harness/Conversation",
  component: HarnessStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HarnessStory>

export default meta
type Story = StoryObj<typeof meta>

const renderWithPreset = (
  preset: "standard" | "minimal",
  scenario: "ready" | "provider-required" | "no-provider" | "switch-confirmation" = "ready",
) => (
  <StoryProviders
    noPadding
    locale="zh"
    config={{} as never}
    providers={{
      newapi: {
        id: "newapi",
        name: "NewAPI",
        env: [],
        models: {
          "deepseek-v4-flash": {
            id: "deepseek-v4-flash",
            name: "DeepSeek V4 Flash",
            inputPrice: 0,
            outputPrice: 0,
            limit: { context: 262_144, output: 32_768 },
          },
        },
      },
      gateway: {
        id: "gateway",
        name: "内部 Gateway",
        env: [],
        models: {
          "deepseek-gateway": {
            id: "deepseek-gateway",
            name: "DeepSeek Gateway",
            inputPrice: 0,
            outputPrice: 0,
            limit: { context: 262_144, output: 32_768 },
          },
        },
      },
      "backup-newapi": {
        id: "backup-newapi",
        name: "备用 NewAPI",
        env: [],
        models: {
          "deepseek-backup": {
            id: "deepseek-backup",
            name: "DeepSeek Backup",
            inputPrice: 0,
            outputPrice: 0,
            limit: { context: 262_144, output: 32_768 },
          },
        },
      },
    }}
  >
    <HarnessStory preset={preset} scenario={scenario} />
  </StoryProviders>
)

export const LongConversation420: Story = {
  name: "Long conversation — 420px",
  render: () => renderWithPreset("minimal"),
}

export const LongConversation200: Story = {
  name: "Long conversation — 200px",
  render: () => renderWithPreset("minimal"),
}

export const WindowsStandard420: Story = {
  name: "Windows standard — 420px",
  render: () => renderWithPreset("standard"),
}

export const ProviderSelectionRequired420: Story = {
  name: "Provider selection required — 420px",
  render: () => renderWithPreset("minimal", "provider-required"),
}

export const NoProvider420: Story = {
  name: "No configured Provider — 420px",
  render: () => renderWithPreset("minimal", "no-provider"),
}

export const ProviderSwitchConfirmation420: Story = {
  name: "Provider switch confirmation — 420px",
  render: () => renderWithPreset("minimal", "switch-confirmation"),
}
