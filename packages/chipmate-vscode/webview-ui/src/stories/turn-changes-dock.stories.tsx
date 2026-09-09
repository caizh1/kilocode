import { createMemo, createSignal, onCleanup } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders, defaultMockData } from "./StoryProviders"
import { ChatView } from "../components/chat/ChatView"
import { getVSCodeAPI } from "../context/vscode"
import type { Message, Part } from "../types/messages"
import type { TurnChangesSummary } from "../../../src/shared/turn-changes"

const meta = { title: "Chat/按需修改记录", parameters: { layout: "fullscreen" } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Fixture() {
  const sessionID = "ses_伸缩验收"
  const messageID = "msg_当前用户"
  const assistantID = "msg_当前回答"
  const [phase, setPhase] = createSignal<TurnChangesSummary["phase"]>("running")
  const [status, setStatus] = createSignal<"busy" | "idle">("busy")
  const [revision, setRevision] = createSignal(1)
  const now = 1788854400000
  const messages = createMemo<Message[]>(() => [
    { id: messageID, sessionID, role: "user", createdAt: new Date(now).toISOString(), time: { created: now } },
    {
      id: assistantID,
      sessionID,
      role: "assistant",
      parentID: messageID,
      createdAt: new Date(now + 1).toISOString(),
      time: { created: now + 1, ...(status() === "idle" ? { completed: now + 1000 } : {}) },
      ...(status() === "idle" ? { finish: "stop" } : {}),
    },
  ])
  const parts: Record<string, Part[]> = {
    [messageID]: [{ id: "part_用户", messageID, sessionID, type: "text", text: "检查初始化逻辑，并解释每个步骤。" }],
    [assistantID]: [
      {
        id: "part_回答",
        messageID: assistantID,
        sessionID,
        type: "text",
        text: Array.from(
          { length: 50 },
          (_, n) => `第 ${n + 1} 步：检查设备初始化、错误返回和资源释放，保留调用顺序。`,
        ).join("\n\n"),
      },
    ],
  }
  const summary = (): TurnChangesSummary => ({
    directory: "/验收项目",
    sessionID,
    messageID,
    revision: revision(),
    phase: phase(),
    outcome: "interrupted",
    canRevert: phase() === "ready",
    canRestore: false,
    files: [
      {
        id: "file_主文件",
        file: "主文件.c",
        status: "modified",
        additions: 2,
        deletions: 2,
        binary: false,
        undone: [],
        state: "kept",
      },
    ],
  })
  const api = getVSCodeAPI()
  const previous = api.postMessage
  api.postMessage = (message) => {
    if (message.type !== "turnChangesRequest") {
      previous(message)
      return
    }
    queueMicrotask(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "turnChangesResult",
            sessionID,
            messageID: message.messageID,
            requestID: message.requestID,
            result: { ok: true, summary: summary() },
          },
        }),
      ),
    )
  }
  const control = (event: Event) => {
    const input = (event as CustomEvent<{ phase: TurnChangesSummary["phase"]; idle?: boolean }>).detail
    setPhase(input.phase)
    if (input.idle !== undefined) setStatus(input.idle ? "idle" : "busy")
    setRevision((value) => value + 1)
    window.dispatchEvent(new MessageEvent("message", { data: { type: "turnChangesUpdated", sessionID, messageID } }))
  }
  window.addEventListener("验收修改阶段", control)
  onCleanup(() => {
    api.postMessage = previous
    window.removeEventListener("验收修改阶段", control)
  })
  return (
    <StoryProviders
      locale="zh"
      noPadding
      sessionID={sessionID}
      session={{
        status,
        statusInfo: () => ({ type: status() }),
        messages,
        visibleMessages: messages,
        userMessages: () => messages().filter((message) => message.role === "user"),
        getParts: (id: string) => parts[id] ?? [],
      }}
      data={{ ...defaultMockData, message: { [sessionID]: messages() }, part: parts }}
    >
      <div
        data-dock-fixture
        style={{ display: "flex", "flex-direction": "column", height: "100dvh", width: "100%", overflow: "hidden" }}
      >
        <ChatView />
      </div>
    </StoryProviders>
  )
}
export const Running: Story = { name: "长输出与伸缩状态", render: () => <Fixture /> }
