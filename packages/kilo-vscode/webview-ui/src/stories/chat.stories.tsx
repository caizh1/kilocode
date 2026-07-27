/** @jsxImportSource solid-js */
/**
 * Stories for high-priority chat components:
 * ChatView, MessageList, QuestionDock, TaskHeader
 *
 * These render with mocked session/server/provider contexts — the components
 * will show their "idle / empty" states since no real extension host is connected.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import type { AssistantMessage } from "@kilocode/sdk/v2"
import { createSignal, onCleanup, onMount, type Component } from "solid-js"
import { MemoryContract } from "@kilocode/kilo-memory/effect/httpapi"
import { MemorySchema } from "@kilocode/kilo-memory/schema"
import { StoryProviders, defaultMockData, mockSessionValue } from "./StoryProviders"
import { ChatView } from "../components/chat/ChatView"
import { ErrorDisplay } from "../components/chat/ErrorDisplay"
import { TaskHeader } from "../components/chat/TaskHeader"
import { TaskUsage } from "../components/chat/TaskUsage"
import { QuestionDock } from "../components/chat/QuestionDock"
import { SuggestBar } from "../components/chat/SuggestBar"
import { MessageList } from "../components/chat/MessageList"
import { VscodeUserMessage } from "../components/chat/VscodeUserMessage"
import { TurnOutcome } from "../components/shared/TurnOutcome"
import { SessionContext } from "../context/session"
import { MemoryContext, type MemoryContextValue } from "../context/memory"
import { ProviderContext } from "../context/provider"
import { ServerContext } from "../context/server"
import { WorktreeModeProvider } from "../context/worktree-mode"
import type {
  Config,
  AgentRequirementResult,
  Message,
  Part,
  QuestionRequest,
  ReviewComment,
  SessionModelUsage,
  SuggestionRequest,
  TodoItem,
} from "../types/messages"
import { formatReviewCommentsMarkdown } from "../utils/review-comment-markdown"
import { reviewMetadata } from "../../../src/shared/review-comments"

const SESSION_ID = "story-session-chat-001"

const missingToolsRequirements: AgentRequirementResult = {
  agent: "code-review",
  directory: "/project",
  enabled: true,
  state: "blocked",
  skills: [
    { name: "review-checklist", status: "ready" },
    { name: "security-audit", status: "missing" },
  ],
  mcps: [
    { name: "github", status: "missing" },
    { name: "filesystem", status: "ready" },
  ],
  vscode_extensions: [],
}

const missingExtensionRequirements: AgentRequirementResult = {
  agent: "release-review",
  directory: "/project",
  enabled: true,
  state: "blocked",
  skills: [],
  mcps: [],
  vscode_extensions: [
    {
      name: "GitHub Pull Requests",
      id: "github.vscode-pull-request-github",
      status: "missing",
    },
  ],
}

const malformedRequirements: AgentRequirementResult = {
  agent: "malformed-agent",
  directory: "/project",
  enabled: true,
  state: "error",
  skills: [],
  mcps: [],
  vscode_extensions: [],
  error: {
    code: "malformed_declaration",
    message: "Invalid requirements declaration.",
  },
}

const readyRequirements: AgentRequirementResult = {
  agent: "ready-agent",
  directory: "/project",
  enabled: true,
  state: "ready",
  skills: [{ name: "review-checklist", status: "ready" }],
  mcps: [{ name: "filesystem", status: "ready" }],
  vscode_extensions: [
    {
      name: "GitHub Pull Requests",
      id: "github.vscode-pull-request-github",
      status: "ready",
    },
  ],
}

// ---------------------------------------------------------------------------
// Question fixtures
// ---------------------------------------------------------------------------

const singleQuestion: QuestionRequest = {
  id: "q-single-001",
  sessionID: SESSION_ID,
  questions: [
    {
      question: "Which testing framework should I use for this project?",
      header: "Choose a framework",
      options: [
        { label: "Vitest", description: "Fast, Vite-native unit testing" },
        { label: "Jest", description: "Widely adopted, rich ecosystem" },
        { label: "Playwright", description: "End-to-end browser testing" },
        { label: "Bun test", description: "Built-in, zero config" },
      ],
    },
  ],
  tool: { messageID: "asst-msg-001", callID: "call-question-001" },
}

const multiQuestion: QuestionRequest = {
  id: "q-multi-001",
  sessionID: SESSION_ID,
  questions: [
    {
      question: "Which testing framework?",
      header: "Step 1 of 2",
      options: [
        { label: "Vitest", description: "Fast, Vite-native" },
        { label: "Jest", description: "Widely adopted" },
        { label: "Bun test", description: "Built-in, zero config" },
      ],
    },
    {
      question: "Should I include coverage reporting?",
      header: "Step 2 of 2",
      options: [
        { label: "Yes, Istanbul", description: "Instrumentation-based" },
        { label: "Yes, V8", description: "Native V8 coverage" },
        { label: "No", description: "Skip coverage" },
      ],
    },
  ],
  tool: { messageID: "asst-msg-001", callID: "call-question-002" },
}

const reviewSuggestion: SuggestionRequest = {
  id: "s-review-001",
  sessionID: SESSION_ID,
  text: "Start a code review of uncommitted changes?",
  actions: [{ label: "Start review", description: "Run a local review now", prompt: "/review uncommitted" }],
  tool: { messageID: "asst-msg-002", callID: "call-suggest-001" },
}

const policyMessage =
  "No endpoints found matching your data policy (Free model training). Configure: https://openrouter.ai/settings/privacy"

const policyError: NonNullable<AssistantMessage["error"]> = {
  name: "APIError",
  data: {
    message: policyMessage,
    statusCode: 400,
    isRetryable: false,
    responseBody: JSON.stringify(
      {
        error: {
          type: "Bad Request",
          message: "Data collection is required for this model. Please enable data collection to use this model.",
        },
      },
      null,
      2,
    ),
  },
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: "Chat",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// ChatView stories
// ---------------------------------------------------------------------------

export const ChatViewIdle: Story = {
  name: "ChatView — idle (empty)",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle">
      <div style={{ width: "100%", height: "600px", display: "flex", "flex-direction": "column" }}>
        <ChatView />
      </div>
    </StoryProviders>
  ),
}

export const QAAlignedIdleLight: Story = {
  name: "QA — aligned idle, light theme",
  globals: { vscodeTheme: "light-modern" },
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle">
      <div style={{ width: "100%", height: "600px", display: "flex", "flex-direction": "column" }}>
        <ChatView />
      </div>
    </StoryProviders>
  ),
}

function QAWelcomeRecentLightStory() {
  const session = {
    ...mockSessionValue({ status: "idle" }),
    currentSessionID: () => undefined,
    currentSession: () => undefined,
    sessions: () => [
      {
        id: "recent-architecture",
        title: "检查索引架构",
        createdAt: "2026-07-15T08:00:00.000Z",
        updatedAt: "2026-07-16T08:00:00.000Z",
      },
      {
        id: "recent-settings",
        title: "优化浅色模式设置",
        createdAt: "2026-07-14T08:00:00.000Z",
        updatedAt: "2026-07-15T08:00:00.000Z",
      },
    ],
  }

  return (
    <StoryProviders sessionID={SESSION_ID} status="idle" locale="zh">
      <SessionContext.Provider value={session as any}>
        <div style={{ width: "100%", height: "720px", display: "flex", "flex-direction": "column" }}>
          <ChatView onSelectSession={() => undefined} onShowHistory={() => undefined} />
        </div>
      </SessionContext.Provider>
    </StoryProviders>
  )
}

export const QAWelcomeRecentLight: Story = {
  name: "QA — welcome with recent sessions, light theme",
  globals: { vscodeTheme: "light-modern" },
  render: () => <QAWelcomeRecentLightStory />,
}

export const QAAlignedIdleContrast: Story = {
  name: "QA — aligned idle, high contrast",
  globals: { vscodeTheme: "hc-black" },
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle">
      <div style={{ width: "100%", height: "600px", display: "flex", "flex-direction": "column" }}>
        <ChatView />
      </div>
    </StoryProviders>
  ),
}

/** ChatView with messages — shows the full-width "New task" button above the prompt */
export const ChatViewWithMessages: Story = {
  name: "ChatView — with messages (shows New Task button)",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "idle" }),
      messages: () => [{ id: "msg-001" }] as any[],
      costBreakdown: () => [{ label: "Parent session", cost: 0.0012 }],
      contextUsage: () => ({ tokens: 512, percentage: 6 }),
    }
    return (
      <StoryProviders sessionID={SESSION_ID} status="idle" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "200px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const ChatViewRequirementsChecking: Story = {
  name: "ChatView — agent requirements checking",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle" noPadding agentRequirementsChecking agentRequirementsBlocked>
      <ServerContext.Provider value={mockServer as any}>
        <div style={{ height: "600px", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </ServerContext.Provider>
    </StoryProviders>
  ),
}

export const ChatViewRequirementsMissingTools: Story = {
  name: "ChatView — missing skills and MCPs",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle" noPadding agentRequirements={missingToolsRequirements}>
      <ServerContext.Provider value={mockServer as any}>
        <div style={{ height: "600px", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </ServerContext.Provider>
    </StoryProviders>
  ),
}

export const ChatViewRequirementsMissingExtension: Story = {
  name: "ChatView — missing VS Code extension",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle" noPadding agentRequirements={missingExtensionRequirements}>
      <ServerContext.Provider value={mockServer as any}>
        <div style={{ height: "600px", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </ServerContext.Provider>
    </StoryProviders>
  ),
}

export const ChatViewRequirementsMalformed: Story = {
  name: "ChatView — malformed agent requirements",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle" noPadding agentRequirements={malformedRequirements}>
      <ServerContext.Provider value={mockServer as any}>
        <div style={{ height: "600px", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </ServerContext.Provider>
    </StoryProviders>
  ),
}

export const ChatViewRequirementsReady: Story = {
  name: "ChatView — requirements ready (no card)",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle" noPadding agentRequirements={readyRequirements}>
      <ServerContext.Provider value={mockServer as any}>
        <div style={{ height: "600px", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </ServerContext.Provider>
    </StoryProviders>
  ),
}

export const ChatViewAgentManagerCompleted: Story = {
  name: "ChatView — completed Agent Manager session actions",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "idle", closeReason: "completed" }),
      messages: () => [{ id: "msg-001" }] as any[],
      worktreeStats: () => ({ files: 2, additions: 12, deletions: 4 }),
    }
    return (
      <StoryProviders sessionID={SESSION_ID} status="idle" noPadding>
        <ServerContext.Provider value={mockServer as any}>
          <SessionContext.Provider value={session as any}>
            <WorktreeModeProvider>
              <div style={{ height: "200px", display: "flex", "flex-direction": "column" }}>
                <ChatView onForkSession={() => undefined} continueInWorktree />
              </div>
            </WorktreeModeProvider>
          </SessionContext.Provider>
        </ServerContext.Provider>
      </StoryProviders>
    )
  },
}

export const UserMessageReviewComments: Story = {
  name: "User message — interactive review comments",
  render: () => {
    const comments: ReviewComment[] = [
      {
        id: "review-1",
        file: "src/components/chat/KiloBackendChatManager.kt",
        side: "additions",
        line: 114,
        comment: "Keep this state synchronized when the active session changes.",
        selectedText: "private val activeSession = MutableStateFlow<String?>(null)",
      },
      {
        id: "review-2",
        file: "resources/messages/KiloBundle_bs.properties",
        side: "deletions",
        line: 235,
        comment: "Translate the modified setting description.",
        selectedText: "settings.models.smallModel.description=The lightweight model used for quick tasks.",
      },
    ]
    const prefix = formatReviewCommentsMarkdown(comments)
    const text = `${prefix}\n\nPlease address these review comments.`
    const review = { version: 1 as const, comments }
    const message: Message = {
      id: "review-user-message",
      sessionID: SESSION_ID,
      role: "user",
      createdAt: new Date(0).toISOString(),
      time: { created: 0 },
    }
    const parts: Part[] = [
      {
        id: "review-user-part",
        sessionID: SESSION_ID,
        messageID: message.id,
        type: "text",
        text,
        metadata: reviewMetadata(review),
      },
    ]

    return (
      <StoryProviders sessionID={SESSION_ID} status="idle">
        <div style={{ "max-height": "400px", padding: "12px" }}>
          <VscodeUserMessage message={message} parts={parts} />
        </div>
      </StoryProviders>
    )
  },
}

/**
 * ChatView with a pending question tool call and an empty input.
 *
 * Locks in the fix for the regression where the question tool's pending request
 * caused the Send button to render as a Stop square. The snapshot captures the
 * prompt bar footer — the submit control must be the paper-plane arrow icon,
 * not the filled square Stop icon.
 *
 * If someone re-couples the prompt input to the question tool, this story's
 * baseline PNG will diverge and the visual-regression CI job will fail.
 */
const pendingToolQuestion: QuestionRequest = {
  id: "q-toolcall-001",
  sessionID: SESSION_ID,
  questions: [
    {
      question: "What would you like to do next?",
      header: "Next step",
      options: [
        { label: "Continue", description: "Keep going with the current plan" },
        { label: "Revise", description: "Adjust the approach before continuing" },
      ],
    },
  ],
  tool: { messageID: "asst-q-001", callID: "call-q-001" },
}

export const ChatViewWithPendingQuestionEmptyInput: Story = {
  name: "ChatView — pending question, empty input (submit must be arrow, not square)",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="busy" questions={[pendingToolQuestion]}>
      <div style={{ "max-height": "400px", display: "flex", "flex-direction": "column" }}>
        <ChatView />
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// QuestionDock stories
// ---------------------------------------------------------------------------

export const QuestionDockSingle: Story = {
  name: "QuestionDock — single question (explicit submit)",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} questions={[singleQuestion]}>
      <div class="chat-view" data-ui="qa-shell" style={{ width: "100%" }}>
        <QuestionDock request={singleQuestion} />
      </div>
    </StoryProviders>
  ),
}

export const QuestionDockMulti: Story = {
  name: "QuestionDock — multi-question wizard",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} questions={[multiQuestion]}>
      <div class="chat-view" data-ui="qa-shell" style={{ width: "100%" }}>
        <QuestionDock request={multiQuestion} />
      </div>
    </StoryProviders>
  ),
}

/** Many options to verify the max-height scroll constraint */
const manyOptionsQuestion: QuestionRequest = {
  id: "q-many-001",
  sessionID: SESSION_ID,
  questions: [
    {
      question: "What would you like to work on today?",
      header: "Quick check-in",
      options: [
        { label: "Fix a bug", description: "Debug and resolve an issue in the codebase" },
        { label: "Add a feature", description: "Implement new functionality" },
        { label: "Refactor code", description: "Improve existing code structure or quality" },
        { label: "Write tests", description: "Add or improve test coverage" },
        { label: "Review code", description: "Provide feedback on code changes" },
        { label: "Update docs", description: "Improve documentation" },
        { label: "Performance", description: "Optimize for speed or memory" },
      ],
    },
  ],
}

export const QuestionDockManyOptions: Story = {
  name: "QuestionDock — many options (scrollable)",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} questions={[manyOptionsQuestion]}>
      <div class="chat-view" data-ui="qa-shell" style={{ width: "100%" }}>
        <QuestionDock request={manyOptionsQuestion} />
      </div>
    </StoryProviders>
  ),
}

export const SuggestBarReview: Story = {
  name: "SuggestBar — review suggestion",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} suggestions={[reviewSuggestion]}>
      <div class="chat-view" data-ui="qa-shell" style={{ width: "100%" }}>
        <SuggestBar request={reviewSuggestion} />
      </div>
    </StoryProviders>
  ),
}

export const ErrorDisplayDataPolicy: Story = {
  name: "ErrorDisplay — data policy",
  render: () => (
    <StoryProviders sessionID={SESSION_ID}>
      <div style={{ width: "min(720px, 100%)" }}>
        <ErrorDisplay error={policyError} />
      </div>
    </StoryProviders>
  ),
}

const toolUserID = "user-msg-spacing-001"
const toolAssistantID = "asst-msg-spacing-001"
const queuedUserID = "user-msg-spacing-002"
const queuedSecondID = "user-msg-spacing-003"
const toolNow = 1_700_000_000_000
const spacingMessages = [
  {
    id: toolUserID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: toolNow - 9000 },
  },
  {
    id: queuedUserID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: toolNow - 1000 },
  },
  {
    id: queuedSecondID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: toolNow - 500 },
  },
  {
    id: toolAssistantID,
    sessionID: SESSION_ID,
    role: "assistant",
    parentID: toolUserID,
    time: { created: toolNow - 8000 },
    modelID: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/project", root: "/project" },
  },
]
const spacingParts = {
  [toolUserID]: [
    {
      id: "part-user-spacing-001",
      sessionID: SESSION_ID,
      messageID: toolUserID,
      type: "text",
      text: "Run a shell command and stop so I can test the spacing.",
    },
  ],
  [toolAssistantID]: [
    {
      id: "part-text-spacing-001",
      sessionID: SESSION_ID,
      messageID: toolAssistantID,
      type: "text",
      text: "The conversation stays in one centered reading lane so longer explanations remain easy to scan. Tool output, prose, and the composer share the same left and right edges in a wide editor tab.",
    },
    {
      id: "part-bash-spacing-001",
      sessionID: SESSION_ID,
      messageID: toolAssistantID,
      type: "tool",
      callID: "call-bash-spacing-001",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "pwd", description: "Print current directory" },
        output: "/Users/marius/Documents/git/kilocode/.kilo/worktrees/zest-kettledrum",
        title: "pwd",
        metadata: {},
        time: { start: toolNow - 7000, end: toolNow - 6500 },
      },
    },
    {
      id: "part-text-spacing-001",
      sessionID: SESSION_ID,
      messageID: toolAssistantID,
      type: "text",
      text: "The command completed successfully. The assistant response should stay in the reading flow without an outer card.",
    },
  ],
  [queuedUserID]: [
    {
      id: "part-user-spacing-002",
      sessionID: SESSION_ID,
      messageID: queuedUserID,
      type: "text",
      text: "ok",
    },
  ],
  [queuedSecondID]: [
    {
      id: "part-user-spacing-003",
      sessionID: SESSION_ID,
      messageID: queuedSecondID,
      type: "text",
      text: "and then explain it",
    },
  ],
}
const spacingData = {
  ...defaultMockData,
  message: { [SESSION_ID]: spacingMessages },
  part: spacingParts,
}
const readableMessages = [spacingMessages[0], spacingMessages[3]]
const readableData = {
  ...defaultMockData,
  message: { [SESSION_ID]: readableMessages },
  part: spacingParts,
}

function renderReadableChat(status: "idle" | "busy" = "idle") {
  const session = {
    ...mockSessionValue({ id: SESSION_ID, status, closeReason: status === "idle" ? "completed" : undefined }),
    messages: () => readableMessages,
    visibleMessages: () => readableMessages,
    userMessages: () => readableMessages.filter((message) => message?.role === "user"),
    getParts: (id: string) => spacingParts[id as keyof typeof spacingParts] ?? [],
  }
  return (
    <StoryProviders data={readableData} sessionID={SESSION_ID} status={status} noPadding>
      <SessionContext.Provider value={session as any}>
        <div style={{ height: "100vh", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </SessionContext.Provider>
    </StoryProviders>
  )
}

export const ChatViewReadable1280: Story = {
  name: "ChatView - readable editor tab",
  render: renderReadableChat,
}

export const ChatViewReadable420: Story = {
  name: "ChatView - readable busy sidebar",
  render: () => renderReadableChat("busy"),
}

export const QAAlignedConversationSurface: Story = {
  name: "QA — aligned conversation surface",
  render: () => {
    const session = {
      ...mockSessionValue({
        id: SESSION_ID,
        status: "idle",
        questions: [{ ...singleQuestion, tool: undefined } as QuestionRequest],
        suggestions: [{ ...reviewSuggestion, tool: undefined } as SuggestionRequest],
      }),
      messages: () => spacingMessages,
      visibleMessages: () => spacingMessages,
      userMessages: () => spacingMessages.filter((message) => message.role === "user"),
      getParts: (id: string) => spacingParts[id as keyof typeof spacingParts] ?? [],
      costBreakdown: () => [{ label: "QA session", cost: 0.0012 }],
      contextUsage: () => ({ tokens: 4096, percentage: 12 }),
    }
    return (
      <StoryProviders data={spacingData} sessionID={SESSION_ID} status="idle" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ height: "720px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

const mermaidUserID = "user-msg-mermaid-001"
const mermaidAssistantID = "asst-msg-mermaid-001"
const mermaidNow = 1_700_000_300_000
const mermaidMessages = [
  {
    id: mermaidUserID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: mermaidNow },
  },
  {
    id: mermaidAssistantID,
    sessionID: SESSION_ID,
    role: "assistant",
    parentID: mermaidUserID,
    time: { created: mermaidNow + 1000, completed: mermaidNow + 2000 },
    modelID: "deepseek-v4-flash",
    providerID: "myprovider",
    mode: "default",
    agent: "code",
    path: { cwd: "/project", root: "/project" },
  },
]
const mermaidParts = {
  [mermaidUserID]: [
    {
      id: "part-user-mermaid-001",
      sessionID: SESSION_ID,
      messageID: mermaidUserID,
      type: "text",
      text: "请画一张包含正常图、mmd 别名和错误示例的 Mermaid 图。",
    },
  ],
  [mermaidAssistantID]: [
    {
      id: "part-text-mermaid-001",
      sessionID: SESSION_ID,
      messageID: mermaidAssistantID,
      type: "text",
      text: `正常图：

\`\`\`mermaid
flowchart LR
  A[QA response] --> B{Valid Mermaid?}
  B -->|Yes| C[Render inline]
  B -->|No| D[Keep source]
\`\`\`

mmd 别名：

\`\`\`mmd
sequenceDiagram
  User->>QA: Draw diagram
  QA-->>User: Rendered SVG
\`\`\`

错误图：

\`\`\`mermaid
flowchart TD
  Broken -->
\`\`\``,
    },
  ],
}
const mermaidData = {
  ...defaultMockData,
  message: { [SESSION_ID]: mermaidMessages },
  part: mermaidParts,
}

function renderMermaidChat(streaming = false) {
  const messages = streaming
    ? [mermaidMessages[0], { ...mermaidMessages[1], time: { created: mermaidNow + 1000 } }]
    : mermaidMessages
  const session = {
    ...mockSessionValue({ id: SESSION_ID, status: streaming ? "busy" : "idle" }),
    messages: () => messages,
    visibleMessages: () => messages,
    userMessages: () => messages.filter((message) => message?.role === "user"),
    getParts: (id: string) => mermaidParts[id as keyof typeof mermaidParts] ?? [],
  }
  return (
    <StoryProviders data={mermaidData} sessionID={SESSION_ID} status={streaming ? "busy" : "idle"} noPadding>
      <SessionContext.Provider value={session as any}>
        <div style={{ height: "760px", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </SessionContext.Provider>
    </StoryProviders>
  )
}

export const QAMermaidComplete: Story = {
  name: "QA — Mermaid rendered, aliased, and invalid",
  render: () => renderMermaidChat(false),
}

export const QAMermaidStreaming: Story = {
  name: "QA — Mermaid remains source while streaming",
  render: () => renderMermaidChat(true),
}

const plantUmlUserID = "user-msg-plantuml-001"
const plantUmlAssistantID = "asst-msg-plantuml-001"
const plantUmlNow = 1_700_000_320_000
const plantUmlSource = `@startuml
class Controller
Controller --> Service
@enduml`
const plantUmlStreamText = `类图：

\`\`\`PlantUML
${plantUmlSource}
\`\`\``
const plantUmlMessages = [
  {
    id: plantUmlUserID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: plantUmlNow },
  },
  {
    id: plantUmlAssistantID,
    sessionID: SESSION_ID,
    role: "assistant",
    parentID: plantUmlUserID,
    time: { created: plantUmlNow + 1000, completed: plantUmlNow + 2000 },
    modelID: "deepseek-v4-flash",
    providerID: "myprovider",
    mode: "code",
    agent: "code",
    path: { cwd: "/project", root: "/project" },
  },
]
const plantUmlParts = {
  [plantUmlUserID]: [
    {
      id: "part-user-plantuml-001",
      sessionID: SESSION_ID,
      messageID: plantUmlUserID,
      type: "text",
      text: `请在 Code 模式画 UML 类图和时序图；不要渲染我消息里的源码：
@startuml
User -> UI
@enduml`,
    },
  ],
  [plantUmlAssistantID]: [
    {
      id: "part-text-plantuml-001",
      sessionID: SESSION_ID,
      messageID: plantUmlAssistantID,
      type: "text",
      text: `${plantUmlStreamText}

uml 别名：

\`\`\`uml
@startuml
Alice -> Bob: 认证请求
@enduml
\`\`\`

裸源码错误图：
@startuml
Broken ->
@enduml`,
    },
  ],
}
const plantUmlData = {
  ...defaultMockData,
  message: { [SESSION_ID]: plantUmlMessages },
  part: plantUmlParts,
}
const plantUmlPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="

const PlantUmlStoryBridge: Component<{ delay: number }> = (props) => {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const render = (event: Event) => {
    const detail = (event as CustomEvent<{ requestId: string; source: string }>).detail
    if (!detail?.requestId || !detail.source) return
    event.preventDefault()
    const timer = setTimeout(() => {
      timers.delete(timer)
      const broken = detail.source.includes("Broken ->")
      window.dispatchEvent(
        new CustomEvent("kilo:plantuml-rendered", {
          detail: broken
            ? {
                type: "plantUmlRendered",
                requestId: detail.requestId,
                ok: false,
                issues: ["Syntax Error near line 2"],
              }
            : {
                type: "plantUmlRendered",
                requestId: detail.requestId,
                ok: true,
                dataUrl: plantUmlPng,
                width: 480,
                height: 280,
                issues: [],
              },
        }),
      )
    }, props.delay)
    timers.add(timer)
  }
  window.addEventListener("kilo:render-plantuml", render)
  onCleanup(() => {
    window.removeEventListener("kilo:render-plantuml", render)
    for (const timer of timers) clearTimeout(timer)
  })
  return null
}

function renderPlantUmlChat(status: "idle" | "busy" = "idle", delay = 500, completed = true) {
  const messages = completed
    ? plantUmlMessages
    : [plantUmlMessages[0], { ...plantUmlMessages[1], time: { created: plantUmlNow + 1000 } }]
  const session = {
    ...mockSessionValue({ id: SESSION_ID, status }),
    messages: () => messages,
    visibleMessages: () => messages,
    userMessages: () => messages.filter((message) => message?.role === "user"),
    getParts: (id: string) => plantUmlParts[id as keyof typeof plantUmlParts] ?? [],
  }
  return (
    <StoryProviders data={plantUmlData} sessionID={SESSION_ID} status={status} noPadding>
      <SessionContext.Provider value={session as any}>
        <PlantUmlStoryBridge delay={delay} />
        <div style={{ height: "760px", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </SessionContext.Provider>
    </StoryProviders>
  )
}

function QAPlantUmlStreamingStory() {
  const [text, setText] = createSignal(plantUmlStreamText)
  const messages = [
    plantUmlMessages[0],
    { ...plantUmlMessages[1], time: { created: plantUmlNow + 1000 } },
  ]
  const session = {
    ...mockSessionValue({ id: SESSION_ID, status: "busy" }),
    messages: () => messages,
    visibleMessages: () => messages,
    userMessages: () => messages.filter((message) => message?.role === "user"),
    getParts: (id: string) => {
      if (id !== plantUmlAssistantID) return plantUmlParts[id as keyof typeof plantUmlParts] ?? []
      return [{ ...plantUmlParts[plantUmlAssistantID][0], text: text() }]
    },
  }

  onMount(() => {
    const target = window as Window & {
      plantUmlStreamNext?: () => void
      plantUmlStreamChange?: () => void
      plantUmlStreamDuplicate?: () => void
    }
    target.plantUmlStreamNext = () => setText((value) => `${value}\n\n继续生成说明。`)
    target.plantUmlStreamChange = () =>
      setText(`类图：

\`\`\`plantuml
@startuml
class Controller
Controller --> Repository
@enduml
\`\`\``)
    target.plantUmlStreamDuplicate = () =>
      setText((value) => `${value}

缓存中的相同类图：

\`\`\`plantuml
${plantUmlSource}
\`\`\``)
    onCleanup(() => {
      delete target.plantUmlStreamNext
      delete target.plantUmlStreamChange
      delete target.plantUmlStreamDuplicate
    })
  })

  return (
    <StoryProviders data={plantUmlData} sessionID={SESSION_ID} status="busy" locale="zh" noPadding>
      <SessionContext.Provider value={session as any}>
        <PlantUmlStoryBridge delay={30_000} />
        <div style={{ height: "720px", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </SessionContext.Provider>
    </StoryProviders>
  )
}

export const QAPlantUMLComplete: Story = {
  name: "QA — Code mode normalizes and renders PlantUML",
  render: () => renderPlantUmlChat(),
}

export const QAPlantUMLIdleFallback: Story = {
  name: "QA — idle renders without message completion timestamp",
  render: () => renderPlantUmlChat("idle", 500, false),
}

export const QAPlantUMLLongWait: Story = {
  name: "QA — PlantUML long server render",
  render: () => renderPlantUmlChat("idle", 10_000),
}

export const QAPlantUMLTimeout: Story = {
  name: "QA — PlantUML server timeout",
  render: () => renderPlantUmlChat("idle", 120_000),
}

export const QAPlantUMLStreaming: Story = {
  name: "QA — PlantUML renders while streaming",
  render: () => <QAPlantUmlStreamingStory />,
}

export const QAUserMessageLengths: Story = {
  name: "QA — user message length states",
  render: () => {
    const samples = [
      { id: "short", text: "能远端渲染吗？" },
      { id: "medium", text: "当前无法正常进行远端渲染吗？需要检查一下服务状态和配置。" },
      {
        id: "long",
        text: "请帮我全面检查远端 Mermaid 和 Word 渲染是否正常：验证渲染服务健康状态、接口配置（URL、超时、鉴权）、最近的失败日志和错误详情，并确认降级或本地渲染回退是否生效；如有问题请给出根因分析和修复建议。",
      },
    ]
    const now = 1_700_000_200_000
    const messages = samples.flatMap<Message>((sample, index) => {
      const time = now + index * 2_000
      const user = `user-message-${sample.id}`
      return [
        {
          id: user,
          sessionID: SESSION_ID,
          role: "user",
          createdAt: new Date(time).toISOString(),
          time: { created: time },
        },
        {
          id: `assistant-message-${sample.id}`,
          sessionID: SESSION_ID,
          role: "assistant",
          parentID: user,
          createdAt: new Date(time + 1_000).toISOString(),
          time: { created: time + 1_000, completed: time + 1_500 },
          finish: "stop",
          modelID: "deepseek-v4-flash",
          providerID: "myprovider",
          mode: "default",
          agent: "code",
          path: { cwd: "/project", root: "/project" },
        },
      ]
    })
    const parts = Object.fromEntries(
      samples.flatMap((sample) => [
        [
          `user-message-${sample.id}`,
          [
            {
              id: `user-part-${sample.id}`,
              sessionID: SESSION_ID,
              messageID: `user-message-${sample.id}`,
              type: "text",
              text: sample.text,
            },
          ],
        ],
        [
          `assistant-message-${sample.id}`,
          [
            {
              id: `assistant-part-${sample.id}`,
              sessionID: SESSION_ID,
              messageID: `assistant-message-${sample.id}`,
              type: "text",
              text: "正在考虑下一步",
            },
          ],
        ],
      ]),
    ) as Record<string, Part[]>
    const data = {
      ...defaultMockData,
      message: { [SESSION_ID]: messages },
      part: parts,
    }
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "idle" }),
      messages: () => messages,
      visibleMessages: () => messages,
      userMessages: () => messages.filter((message) => message.role === "user"),
      getParts: (id: string) => parts[id] ?? [],
    }
    return (
      <StoryProviders data={data} sessionID={SESSION_ID} status="idle" noPadding>
        <SessionContext.Provider value={session as any}>
          <div
            class="chat-view"
            data-ui="qa-shell"
            data-story="qa-message-lengths"
            style={{ height: "720px", display: "flex", "flex-direction": "column" }}
          >
            <MessageList onForkMessage={() => undefined} />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const MessageListToolToQueuedUserSpacing: Story = {
  name: "MessageList — queued users stay at bottom",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy" }),
      messages: () => spacingMessages,
      visibleMessages: () => spacingMessages,
      userMessages: () => spacingMessages.filter((msg) => msg.role === "user"),
      getParts: (id: string) => spacingParts[id as keyof typeof spacingParts] ?? [],
    }
    return (
      <StoryProviders data={spacingData} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div
            class="chat-view"
            data-ui="qa-shell"
            style={{ height: "420px", display: "flex", "flex-direction": "column" }}
          >
            <MessageList />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// MessageList — sub-agent (task tool) to queued user spacing
// Verifies the same vertical gap applies when the last assistant part is a
// sub-agent's expanded task tool, not just a regular tool like bash.
// ---------------------------------------------------------------------------

const subUserID = "user-msg-subagent-spacing-001"
const subAssistantID = "asst-msg-subagent-spacing-001"
const subQueuedUserID = "user-msg-subagent-spacing-002"
const subChildSessionID = "story-session-child-subagent-001"
const subNow = 1_700_000_100_000
const subagentSpacingMessages = [
  {
    id: subUserID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: subNow - 9000 },
  },
  {
    id: subAssistantID,
    sessionID: SESSION_ID,
    role: "assistant",
    parentID: subUserID,
    time: { created: subNow - 8000 },
    modelID: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/project", root: "/project" },
  },
  {
    id: subQueuedUserID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: subNow - 1000 },
  },
]
const subagentSpacingParts = {
  [subUserID]: [
    {
      id: "part-user-subagent-spacing-001",
      sessionID: SESSION_ID,
      messageID: subUserID,
      type: "text",
      text: "Delegate a search to a sub-agent so I can test the spacing.",
    },
  ],
  [subAssistantID]: [
    {
      id: "part-task-subagent-spacing-001",
      sessionID: SESSION_ID,
      messageID: subAssistantID,
      type: "tool",
      callID: "call-task-subagent-spacing-001",
      tool: "task",
      state: {
        status: "completed",
        input: { description: "Find auth usage", subagent_type: "explore" },
        output: "done",
        title: "Find auth usage",
        metadata: { sessionId: subChildSessionID },
        time: { start: subNow - 7000, end: subNow - 6500 },
      },
    },
  ],
  [subQueuedUserID]: [
    {
      id: "part-user-subagent-spacing-002",
      sessionID: SESSION_ID,
      messageID: subQueuedUserID,
      type: "text",
      text: "continue",
    },
  ],
}
const subagentSpacingData = {
  ...defaultMockData,
  message: {
    [SESSION_ID]: subagentSpacingMessages,
    [subChildSessionID]: [],
  },
  part: subagentSpacingParts,
}

export const MessageListSubagentToQueuedUserSpacing: Story = {
  name: "MessageList — sub-agent to queued user spacing",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "idle" }),
      messages: () => subagentSpacingMessages,
      userMessages: () => subagentSpacingMessages.filter((msg) => msg.role === "user"),
    }
    return (
      <StoryProviders data={subagentSpacingData} sessionID={SESSION_ID} status="idle" noPadding>
        <SessionContext.Provider value={session as any}>
          <div
            class="chat-view"
            data-ui="qa-shell"
            style={{ height: "420px", display: "flex", "flex-direction": "column" }}
          >
            <MessageList />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// TurnOutcome - abnormal terminal state cards
// ---------------------------------------------------------------------------

const outcomeMessage: Message = {
  id: "asst-msg-outcome-001",
  sessionID: SESSION_ID,
  role: "assistant",
  createdAt: new Date(subNow).toISOString(),
  finish: "unknown",
}

export const TurnOutcomeUnknown: Story = {
  name: "TurnOutcome - response ended without a finish reason",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "idle", closeReason: "completed" }),
      visibleMessages: () => [outcomeMessage],
    }
    return (
      <StoryProviders sessionID={SESSION_ID} status="idle" noPadding>
        <SessionContext.Provider value={session as any}>
          <TurnOutcome />
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const TurnOutcomeFailed: Story = {
  name: "TurnOutcome - failed turn fallback",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "idle", closeReason: "error" }),
      visibleMessages: () => [{ ...outcomeMessage, id: "asst-msg-outcome-002", finish: "error" }],
    }
    return (
      <StoryProviders sessionID={SESSION_ID} status="idle" noPadding>
        <SessionContext.Provider value={session as any}>
          <TurnOutcome />
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// TaskHeader with todos
// ---------------------------------------------------------------------------

const headerNow = 1_700_000_000_000
const headerUserID = "user-task-header-001"
const headerAssistantID = "asst-task-header-001"
const headerMessages: Message[] = [
  {
    id: headerUserID,
    sessionID: SESSION_ID,
    role: "user",
    content: "Can you use the update_todo_list tool to create a CLI interface implementation plan?",
    createdAt: new Date(headerNow - 12000).toISOString(),
    time: { created: headerNow - 12000 },
  },
  {
    id: headerAssistantID,
    sessionID: SESSION_ID,
    role: "assistant",
    parentID: headerUserID,
    content: "I'll track the CLI interface implementation with a todo list.",
    createdAt: new Date(headerNow - 10000).toISOString(),
    time: { created: headerNow - 10000 },
    modelID: "anthropic/claude-sonnet-4-6",
    providerID: "kilo",
    mode: "default",
    agent: "code",
    path: { cwd: "/project", root: "/project" },
  },
]
const headerParts: Record<string, Part[]> = {
  [headerUserID]: [
    {
      id: "part-header-user-text-001",
      sessionID: SESSION_ID,
      messageID: headerUserID,
      type: "text",
      text: "/chip-design-doc 请分析 MP CP 模块，生成一份源码驱动的详细设计文档。",
    },
  ],
  [headerAssistantID]: [
    {
      id: "part-header-skill-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "skill",
      state: {
        status: "completed",
        input: { name: "chip-design-doc" },
        output: "Loaded chip-design-doc guidance.",
        title: "Skill chip-design-doc",
      },
    },
    {
      id: "part-header-read-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "packages/opencode/src/cli/index.ts" },
        output: "export async function main() { /* existing CLI bootstrap */ }",
        title: "Read CLI entrypoint",
      },
    },
    {
      id: "part-header-todos-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "todowrite",
      state: {
        status: "completed",
        input: {
          todos: [
            { id: "1", content: "Locate MP and CP module sources", status: "completed" },
            { id: "2", content: "Trace control flow and state machines", status: "in_progress" },
            { id: "3", content: "Generate the design document", status: "pending" },
          ],
        },
        output: "Updated 3 todos",
        title: "Updated design tasks",
        metadata: {
          todos: [
            { id: "1", content: "Locate MP and CP module sources", status: "completed" },
            { id: "2", content: "Trace control flow and state machines", status: "in_progress" },
            { id: "3", content: "Generate the design document", status: "pending" },
          ],
        },
      },
    },
    {
      id: "part-header-text-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "text",
      text: "I found the existing command registration and argument parsing flow.",
    },
    {
      id: "part-header-glob-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "glob",
      state: {
        status: "completed",
        input: { pattern: "packages/opencode/src/**/*.ts" },
        output:
          "packages/opencode/src/cli/index.ts\npackages/opencode/src/command/run.ts\npackages/opencode/src/config/config.ts",
        title: "Find CLI files",
      },
    },
    {
      id: "part-header-edit-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "edit",
      state: {
        status: "completed",
        input: { filePath: "packages/opencode/src/cli/index.ts" },
        output: "Updated the command registry to expose the new interface hook.",
        title: "Update CLI registry",
      },
    },
    {
      id: "part-header-bash-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "bun run check-types:webview", description: "Typecheck webview" },
        output: "Checked 1 project. No type errors found.",
        title: "Run typecheck",
      },
    },
    {
      id: "part-header-write-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "write",
      state: {
        status: "completed",
        input: { filePath: "packages/opencode/src/cli/interface.ts" },
        output: "Created the CLI interface implementation scaffold.",
        title: "Create interface scaffold",
      },
    },
    {
      id: "part-header-artifact-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "save_mermaid_artifact",
      state: {
        status: "completed",
        input: { source: "flowchart LR\n  MP --> CP" },
        output: JSON.stringify({
          artifactDir: ".kilo/artifacts/mp-cp-design",
          sourcePath: ".kilo/artifacts/mp-cp-design/control-flow.mmd",
          pngPath: ".kilo/artifacts/mp-cp-design/control-flow.png",
          quality: "ok",
        }),
        title: "MP CP control-flow diagram",
      },
    },
    {
      id: "part-header-text-002",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "text",
      text: "Next I am wiring the implementation into the existing command path.",
    },
    {
      id: "part-header-bash-002",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "bash",
      state: {
        status: "running",
        input: { command: "bun test packages/opencode/test/cli.test.ts", description: "Run CLI tests" },
        title: "Run CLI tests",
      },
    },
  ],
}

const mockTodosInProgress: TodoItem[] = [
  { id: "1", content: "Project setup and architecture backlog", status: "completed" },
  { id: "2", content: "Configuration schema for target jobs", status: "completed" },
  { id: "3", content: "Core scanning logic", status: "completed" },
  { id: "4", content: "Build invocation and error handling", status: "completed" },
  { id: "5", content: "CLI interface implementation", status: "in_progress" },
  { id: "6", content: "Storage layer implementation", status: "pending" },
  { id: "7", content: "Character profiles and prompt types", status: "pending" },
  { id: "8", content: "Local tests and integration tests", status: "pending" },
  { id: "9", content: "Migration guide", status: "pending" },
  { id: "10", content: "Release validation", status: "pending" },
]

const mockTodosAllDone: TodoItem[] = [
  { id: "1", content: "Create a haiku about Jan", status: "completed" },
  { id: "2", content: "Create a poem about Henk", status: "completed" },
]

const mockTodosIntegrated: TodoItem[] = [
  { id: "1", content: "完成输入对象扫描", status: "completed" },
  { id: "2", content: "完成候选分类", status: "completed" },
  { id: "3", content: "完成 IAR Map 对账", status: "completed" },
  { id: "4", content: "完成 GCC 链接检查", status: "completed" },
  { id: "5", content: "完成指标汇总", status: "completed" },
  { id: "6", content: "完成状态说明", status: "completed" },
  { id: "7", content: "完成结果复核", status: "completed" },
]

const headerData = {
  ...defaultMockData,
  message: { [SESSION_ID]: headerMessages },
  part: headerParts,
}

function IntegratedTaskHudStory() {
  onMount(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "timelineSettingLoaded", visible: false } }))
    })
  })
  const session = {
    ...mockSessionValue({ id: SESSION_ID, status: "idle" }),
    messages: () => headerMessages,
    visibleMessages: () => headerMessages,
    userMessages: () => headerMessages.filter((message) => message.role === "user"),
    currentSession: () => ({
      id: SESSION_ID,
      title: "MPBL警告全量分类与候选台账",
      createdAt: new Date(headerNow - 12000).toISOString(),
      updatedAt: new Date(headerNow).toISOString(),
    }),
    todos: () => mockTodosIntegrated,
    getParts: (id: string) => headerParts[id] ?? [],
    contextUsage: () => ({ tokens: 212930, percentage: null }),
    costBreakdown: () => [],
  }
  return (
    <StoryProviders
      data={headerData}
      sessionID={SESSION_ID}
      status="idle"
      noPadding
      locale="zh"
      config={{ plugin: ["@kilocode/kilo-indexing"] } as Config}
    >
      <SessionContext.Provider value={session as any}>
        <div style={{ width: "100%", height: "980px", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </SessionContext.Provider>
    </StoryProviders>
  )
}

export const QATaskHudIntegrated1280: Story = {
  name: "QA 任务 HUD 融合效果 — 桌面深色",
  render: () => <IntegratedTaskHudStory />,
}

export const QATaskHudIntegratedNarrow: Story = {
  name: "QA 任务 HUD 融合效果 — 窄宽深色",
  render: () => <IntegratedTaskHudStory />,
}

export const QATaskHudIntegratedLight1280: Story = {
  name: "QA 任务 HUD 融合效果 — 桌面浅色",
  render: () => <IntegratedTaskHudStory />,
}

export const QATaskHudIntegratedContrast: Story = {
  name: "QA 任务 HUD 融合效果 — 高对比",
  render: () => <IntegratedTaskHudStory />,
}

export const QATitaniumFullConversation: Story = {
  name: "Titanium Studio — 完整真实对话基准",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy" }),
      messages: () => headerMessages,
      visibleMessages: () => headerMessages,
      userMessages: () => headerMessages.filter((message) => message.role === "user"),
      currentSession: () => ({
        id: SESSION_ID,
        title: "MP CP module detailed design document",
        createdAt: new Date(headerNow - 12000).toISOString(),
        updatedAt: new Date(headerNow).toISOString(),
      }),
      todos: () => mockTodosInProgress,
      getParts: (id: string) => headerParts[id] ?? [],
      contextUsage: () => ({ tokens: 126653, percentage: 63 }),
      costBreakdown: () =>
        Array.from({ length: 18 }, (_, index) => ({
          label: `Turn ${index + 1}`,
          cost: 0.018 + (index % 5) * 0.006,
        })),
    }
    return (
      <StoryProviders
        data={headerData}
        sessionID={SESSION_ID}
        status="busy"
        noPadding
        config={{ plugin: ["@kilocode/kilo-indexing"] } as Config}
      >
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "980px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const TaskHeaderWithTodos: Story = {
  name: "TaskHeader — with todos (in progress)",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy" }),
      messages: () => headerMessages,
      currentSession: () => ({
        id: SESSION_ID,
        title: "Task: Can you use the update_todo_list tool to create a CLI interface implementation?",
        createdAt: new Date(headerNow - 12000).toISOString(),
        updatedAt: new Date(headerNow).toISOString(),
      }),
      todos: () => mockTodosInProgress,
      getParts: (id: string) => headerParts[id] ?? [],
      contextUsage: () => ({ tokens: 34300, percentage: 17 }),
      costBreakdown: () => [{ label: "Session", cost: 0.64 }],
    }
    return (
      <StoryProviders sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div class="chat-view" data-ui="qa-shell" style={{ width: "100%" }}>
            <TaskHeader />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const TaskHeaderWithTodosAllDone: Story = {
  name: "TaskHeader — with todos (all done)",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "idle" }),
      messages: () => [{ id: "msg-001" }] as any[],
      currentSession: () => ({
        id: SESSION_ID,
        title: "Writing poems about the team",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      todos: () => mockTodosAllDone,
    }
    return (
      <StoryProviders sessionID={SESSION_ID} status="idle" noPadding>
        <SessionContext.Provider value={session as any}>
          <div class="chat-view" data-ui="qa-shell" style={{ width: "380px" }}>
            <TaskHeader />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

const memoryState = MemorySchema.create()
const mockMemory: MemoryContextValue = {
  status: () => ({
    root: "/project",
    state: MemoryContract.state({
      ...memoryState,
      enabled: true,
      stats: {
        ...memoryState.stats,
        lastInjectedAt: headerNow,
        lastInjectedBytes: 2_132,
        lastInjectedTokens: 533,
        lastInjectedSessionID: SESSION_ID,
      },
    }),
    exists: { state: true, index: true },
    index: { bytes: 49_600, estimatedTokens: 12_400, preview: "" },
  }),
  loading: () => false,
  pending: () => false,
  error: () => undefined,
  enabled: () => true,
  sessionTokens: () => 533,
  totalTokens: () => 12_400,
  activity: () => [
    {
      type: "loaded",
      at: headerNow,
      tokens: 533,
      count: 1,
      items: [],
      refs: ["project.md"],
    },
  ],
  refresh: () => {},
  inspect: () => {},
  enable: () => {},
  disable: () => {},
  auto: () => {},
  rebuild: () => {},
}

const memoryHeader = (width: string) => {
  const msgs = [{ id: "msg-001", role: "assistant" }] as any[]
  const session = {
    ...mockSessionValue({ id: SESSION_ID, status: "idle" }),
    messages: () => msgs,
    visibleMessages: () => msgs,
    contextUsage: () => ({ tokens: 34300, percentage: 17 }),
    costBreakdown: () => [{ label: "Session", cost: 0.64 }],
    currentSession: () => ({
      id: SESSION_ID,
      title: "Integrate project memory",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  }
  return (
    <StoryProviders sessionID={SESSION_ID} status="idle" noPadding>
      <SessionContext.Provider value={session as any}>
        <MemoryContext.Provider value={mockMemory}>
          <div class="chat-view" data-ui="qa-shell" style={{ width }}>
            <TaskHeader />
          </div>
        </MemoryContext.Provider>
      </SessionContext.Provider>
    </StoryProviders>
  )
}

export const TaskHeaderWithMemory: Story = {
  name: "TaskHeader — with memory enabled",
  render: () => memoryHeader("380px"),
}

export const TaskHeaderWithMemory200: Story = {
  name: "TaskHeader — with memory enabled 200",
  render: () => memoryHeader("200px"),
}

const usageTokens = { input: 25_900_000, output: 52_000, reasoning: 4_100, cache: { read: 10_500_000, write: 80_000 } }
const usageData = {
  sessionIDs: [SESSION_ID, "story-subagent-001"],
  totals: {
    steps: 4,
    cost: 0.097214,
    tokens: { input: 25_908_400, output: 52_710, reasoning: 4_220, cache: { read: 10_514_000, write: 80_900 } },
  },
  models: [
    { providerID: "kilo", modelID: "qwen/qwen3.7-plus-20260602", steps: 3, cost: 0.067214, tokens: usageTokens },
    {
      providerID: "minimax",
      modelID: "minimax-m3",
      steps: 1,
      cost: 0.03,
      tokens: { input: 8_400, output: 710, reasoning: 120, cache: { read: 14_000, write: 900 } },
    },
  ],
} satisfies SessionModelUsage
const usageProviders = {
  kilo: {
    id: "kilo",
    name: "Kilo Gateway",
    models: {
      "qwen/qwen3.7-plus": { id: "qwen/qwen3.7-plus", name: "Qwen: Qwen3.7 Plus (20% off)" },
    },
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    models: { "minimax-m3": { id: "minimax-m3", name: "MiniMax M3" } },
  },
}
const usageProvider = {
  providers: () => usageProviders,
  connected: () => ["kilo", "minimax"],
  defaults: () => ({}),
  defaultSelection: () => ({ providerID: "kilo", modelID: "qwen/qwen3.7-plus" }),
  models: () => [],
  findModel: () => undefined,
  authMethods: () => ({}),
  authStates: () => ({}),
  isModelValid: () => true,
}

const usageStory = (open: boolean) => () => (
  <StoryProviders sessionID={SESSION_ID} status="idle" noPadding>
    <ProviderContext.Provider value={usageProvider as any}>
      <div style={{ "max-height": "560px", overflow: "auto" }}>
        <TaskUsage
          defaultOpen={open}
          usage={usageData}
          tokens={{
            input: usageData.totals.tokens.input,
            output: usageData.totals.tokens.output,
            cached: usageData.totals.tokens.cache.read,
          }}
        />
      </div>
    </ProviderContext.Provider>
  </StoryProviders>
)

export const TaskUsageCollapsed: Story = {
  name: "Task usage — collapsed",
  render: usageStory(false),
}

export const TaskUsageExpanded: Story = {
  name: "Task usage — provider and model breakdown",
  render: usageStory(true),
}

export const TaskUsageExpanded200: Story = {
  name: "Task usage — provider and model breakdown, narrow",
  render: usageStory(true),
}

// ---------------------------------------------------------------------------
// Welcome screen with AccountSwitcher + KiloNotifications
// ---------------------------------------------------------------------------

const MOCK_NOTIFICATION = {
  id: "notif-1",
  title: "Try BYOK for Kilo Gateway",
  message: "Bring your own API key for even more flexibility with Kilo Gateway models.",
  action: { actionText: "Learn more", actionURL: "https://kilo.ai/docs" },
}

/** Mock server context with profile data so AccountSwitcher is visible */
const mockServer = {
  connectionState: () => "connected" as const,
  serverInfo: () => undefined,
  extensionVersion: () => "1.0.0",
  errorMessage: () => undefined,
  errorDetails: () => undefined,
  isConnected: () => true,
  profileData: () => ({
    profile: {
      email: "dev@kilo.dev",
      name: "Dev User",
      organizations: [{ id: "org-1", name: "Kilo Org", role: "member" }],
    },
    balance: { balance: 5.0 },
    currentOrgId: "org-1",
  }),
  deviceAuth: () => ({ status: "idle" as const }),
  startLogin: () => {},
  goToLogin: () => {},
  vscodeLanguage: () => "en",
  languageOverride: () => undefined,
  workspaceDirectory: () => "/project",
  gitInstalled: () => true,
}

export const WelcomeWithSwitcherAndNotification: Story = {
  name: "Welcome — account switcher + notification",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle" noPadding notifications={[MOCK_NOTIFICATION]}>
      <ServerContext.Provider value={mockServer as any}>
        <div style={{ width: "100%", height: "600px", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </ServerContext.Provider>
    </StoryProviders>
  ),
}
