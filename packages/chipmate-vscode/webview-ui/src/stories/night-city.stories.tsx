import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal, type ComponentProps } from "solid-js"
import { GrowBox } from "../../../../chipmate-ui/src/components/grow-box"
import { Toast } from "@chipmate/chipmate-ui/toast"
import { ChatView } from "../components/chat/ChatView"
import { SessionTabStrip } from "../components/chat/SessionTabStrip"
import Settings from "../components/settings/Settings"
import { ServerContext } from "../context/server"
import { SessionContext } from "../context/session"
import { WorktreeModeProvider } from "../context/worktree-mode"
import { LocalTabsProvider } from "../context/local-tabs"
import { StoryProviders, defaultMockData, mockSessionValue } from "./StoryProviders"
import { registerVscodeToolOverrides } from "../components/chat/VscodeToolOverrides"
import type { Message, Part } from "../types/messages"

// 固定内容用于设计图对照，不作为模型回答或真实工具执行的证据。
registerVscodeToolOverrides()
const sessionID = "night-city-visual"
const time = Date.parse("2026-09-08T14:02:00+08:00")
const messages: Message[] = [
  { id: "night-user", sessionID, role: "user", createdAt: new Date(time).toISOString(), time: { created: time } },
  {
    id: "night-assistant",
    sessionID,
    role: "assistant",
    parentID: "night-user",
    createdAt: new Date(time + 1000).toISOString(),
    time: { created: time + 1000, completed: time + 5000 },
    agent: "code",
    modelID: "qa",
    providerID: "qa",
  },
]
const parts: Record<string, Part[]> = {
  "night-user": [
    {
      id: "night-request",
      sessionID,
      messageID: "night-user",
      type: "text",
      text: "请检查 UFS 初始化流程中的超时处理，给出修改建议。",
    },
  ],
  "night-assistant": [
    {
      id: "night-answer",
      sessionID,
      messageID: "night-assistant",
      type: "text",
      text: "已检查初始化路径，正在补齐异常退出时的资源释放。\n\n建议在超时返回前释放已申请的资源，并保留原始错误码。",
    },
    {
      id: "night-read",
      sessionID,
      messageID: "night-assistant",
      type: "tool",
      tool: "read",
      callID: "night-read-call",
      state: {
        status: "completed",
        input: { filePath: "ufs_init.c" },
        output: "已读取初始化入口和错误恢复分支。",
        title: "读取 ufs_init.c",
        metadata: {},
      },
    },
    {
      id: "night-code",
      sessionID,
      messageID: "night-assistant",
      type: "text",
      text: "```c\nint ret = init_hardware(ctx);\nif (ret < 0) {\n    release_resources(ctx);\n    return ret;\n}\n```\n\n接下来验证初始化失败与重复初始化场景。",
    },
  ],
}

export default {
  title: "Appearance/NightCity",
  parameters: { layout: "fullscreen" },
  globals: { skin: "night-city" },
} satisfies Meta

export const Chat: StoryObj = {
  name: "聊天设计对照",
  render: (args: { reasoning?: boolean }) => {
    const [variant, setVariant] = createSignal<string>()
    const [active, setActive] = createSignal<string | undefined>(sessionID)
    const session = {
      ...mockSessionValue({ id: sessionID, status: "idle", closeReason: "completed" }),
      variantList: () => (args.reasoning ? ["low", "high"] : []),
      currentVariant: variant,
      selectVariant: setVariant,
      currentSessionID: active,
      selectSession: setActive,
      clearCurrentSession: () => setActive(undefined),
      agents: () => [
        { name: "code", description: "编写代码", mode: "primary" as const },
        { name: "ask", description: "问答", mode: "primary" as const },
      ],
      sessions: () => [
        {
          id: sessionID,
          title: "UFS 初始化审查",
          createdAt: new Date(time).toISOString(),
          updatedAt: new Date(time).toISOString(),
        },
        {
          id: "night-city-review",
          title: "异常恢复分析",
          createdAt: new Date(time).toISOString(),
          updatedAt: new Date(time).toISOString(),
        },
      ],
      deleteQueuedMessage: () => {},
      isSubmitting: () => false,
      configModel: () => null,
      skillRemoveState: () => undefined,
      removeSkill: () => undefined,
      removeMcp: () => {},
      mcpStatus: () => ({}),
      mcpLoading: () => null,
      connectMcp: () => {},
      disconnectMcp: () => {},
      authenticateMcp: () => {},
      refreshMcpStatus: () => {},
      currentSession: () => ({
        id: sessionID,
        title: "UFS 初始化审查",
        createdAt: new Date(time).toISOString(),
        updatedAt: new Date(time).toISOString(),
      }),
      messages: () => (active() === sessionID ? messages : []),
      visibleMessages: () => (active() === sessionID ? messages : []),
      userMessages: () => (active() === sessionID ? messages.filter((message) => message.role === "user") : []),
      getParts: (id: string) => parts[id] ?? [],
    } as ComponentProps<typeof SessionContext.Provider>["value"]
    return (
      <StoryProviders
        data={{ ...defaultMockData, message: { [sessionID]: messages }, part: parts }}
        sessionID={sessionID}
        status="idle"
        locale="zh"
        noPadding
      >
        <ServerContext.Provider
          value={{
            connectionState: () => "connected",
            serverInfo: () => undefined,
            extensionVersion: () => "开发验收",
            errorMessage: () => undefined,
            errorDetails: () => undefined,
            isConnected: () => true,
            profileData: () => null,
            deviceAuth: () => ({ status: "idle" }),
            startLogin: () => {},
            goToLogin: () => {},
            vscodeLanguage: () => "zh",
            languageOverride: () => "zh",
            workspaceDirectory: () => "/验收工作区",
            gitInstalled: () => true,
          }}
        >
          <SessionContext.Provider value={session}>
            <WorktreeModeProvider>
              <LocalTabsProvider>
                <div style={{ height: "100vh", display: "flex", "flex-direction": "column" }}>
                  <SessionTabStrip />
                  <ChatView />
                  <Toast.Region />
                </div>
              </LocalTabsProvider>
            </WorktreeModeProvider>
          </SessionContext.Provider>
        </ServerContext.Provider>
      </StoryProviders>
    )
  },
}

export const ReasoningChat: StoryObj = { ...Chat, args: { reasoning: true } }
export const SidebarChat: StoryObj = { ...ReasoningChat, parameters: { nativeNavigation: true } }

// 使用真实 ConfigProvider，忙碌会话仅是视图边界的固定输入。
export const BusySettings: StoryObj = {
  render: () => (
    <StoryProviders locale="zh" noPadding session={{ allStatusMap: () => ({ 验收会话: { type: "busy" } }) }}>
      <div style={{ height: "100vh" }}>
        <Settings tab="display" />
      </div>
    </StoryProviders>
  ),
}

export const StaticExpansion: StoryObj = {
  render: () => {
    const [open, setOpen] = createSignal(true)
    const [extra, setExtra] = createSignal(false)
    return (
      <div style={{ padding: "20px" }}>
        <button onClick={() => setOpen(!open())}>切换展开</button>
        <button onClick={() => setExtra(!extra())}>增加正文</button>
        <GrowBox animate={false} open={open()} slot="night-city-static-expansion">
          <p>已有历史消息立即显示，无需逐条测量高度。</p>
          {extra() && <p>新增正文使用自然高度，后续展开收起仍可使用动画。</p>}
        </GrowBox>
      </div>
    )
  },
}
