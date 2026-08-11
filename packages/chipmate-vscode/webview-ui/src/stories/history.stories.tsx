/** @jsxImportSource solid-js */
/**
 * Stories for the SessionList component (history panel).
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal, type ParentComponent } from "solid-js"
import { DialogProvider } from "@chipmate/chipmate-ui/context/dialog"
import { DataProvider } from "@chipmate/chipmate-ui/context/data"
import { DiffComponentProvider } from "@chipmate/chipmate-ui/context/diff"
import { CodeComponentProvider } from "@chipmate/chipmate-ui/context/code"
import { FileComponentProvider } from "@chipmate/chipmate-ui/context/file"
import { MarkedProvider } from "@chipmate/chipmate-ui/context/marked"
import { I18nProvider } from "@chipmate/chipmate-ui/context"
import { Diff } from "@chipmate/chipmate-ui/diff"
import { Code } from "@chipmate/chipmate-ui/code"
import { File } from "@chipmate/chipmate-ui/file"
import { VSCodeProvider } from "../context/vscode"
import { ServerProvider } from "../context/server"
import { ConfigProvider } from "../context/config"
import { ProviderProvider } from "../context/provider"
import { SessionContext } from "../context/session"
import { LanguageContext } from "../context/language"
import { dict as uiEn } from "@chipmate/chipmate-ui/i18n/en"
import { dict as appEn } from "../i18n/en"
import { dict as chipmateEn } from "@chipmate/chipmate-i18n/en"
import SessionList from "../components/history/SessionList"
import HistoryView from "../components/history/HistoryView"

const dict: Record<string, string> = { ...appEn, ...uiEn, ...chipmateEn }
function t(key: string) {
  return dict[key] ?? key
}
function noop() {}

const now = new Date().toISOString()
const yesterday = new Date(Date.now() - 86400000).toISOString()
const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()

const mockSessions = [
  { id: "s1", title: "Refactor authentication module", createdAt: now, updatedAt: now },
  { id: "s2", title: "Add screenshot test coverage", createdAt: yesterday, updatedAt: yesterday },
  { id: "s3", title: "Fix TypeScript errors in webview", createdAt: weekAgo, updatedAt: weekAgo },
  { id: "s4", title: undefined, createdAt: weekAgo, updatedAt: weekAgo },
]

const WithSessions: ParentComponent<{ sessions?: typeof mockSessions }> = (props) => {
  const [locale] = createSignal<"en">("en")
  const sessions = props.sessions ?? []
  const session = {
    currentSessionID: () => "s1",
    currentSession: () => sessions[0],
    setCurrentSessionID: noop,
    sessions: () => sessions as any,
    status: () => "idle" as const,
    statusInfo: () => ({ type: "idle" }),
    statusText: () => undefined,
    busySince: () => undefined,
    loading: () => false,
    messages: () => [],
    userMessages: () => [],
    allMessages: () => ({}),
    allParts: () => ({}),
    allStatusMap: () => ({}),
    getParts: () => [],
    todos: () => [],
    permissions: () => [],
    questions: () => [],
    questionErrors: () => new Set<string>(),
    scopedPermissions: () => [] as any[],
    scopedQuestions: () => [] as any[],
    selected: () => ({ providerID: "chipmate", modelID: "anthropic/claude-sonnet-4-6" }),
    selectModel: noop,
    hasModelOverride: () => false,
    clearModelOverride: noop,
    costBreakdown: () => [],
    contextUsage: () => undefined,
    agents: () => [{ name: "code", description: "Code mode", mode: "primary" as const }],
    selectedAgent: () => "code",
    selectAgent: noop,
    getSessionAgent: () => "code",
    getSessionModel: () => ({ providerID: "chipmate", modelID: "anthropic/claude-sonnet-4-6" }),
    setSessionModel: noop,
    setSessionAgent: noop,
    setSessionVariant: noop,
    variantList: () => [],
    currentVariant: () => undefined,
    selectVariant: noop,
    sendMessage: noop,
    abort: noop,
    compact: noop,
    respondToPermission: noop,
    replyToQuestion: noop,
    rejectQuestion: noop,
    createSession: noop,
    clearCurrentSession: noop,
    loadSessions: noop,
    selectSession: noop,
    deleteSession: noop,
    renameSession: noop,
    syncSession: noop,
    cloudPreviewId: () => null,
    selectCloudSession: noop,
  }

  return (
    <VSCodeProvider>
      <ServerProvider>
        <ConfigProvider>
          <ProviderProvider>
            <DialogProvider>
              <LanguageContext.Provider
                value={{ locale, setLocale: noop, userOverride: () => "" as any, t, text: (_locale, key) => t(key) }}
              >
                <I18nProvider value={{ locale: () => "en", t }}>
                  <SessionContext.Provider value={session as any}>
                    <DataProvider
                      data={{
                        session: sessions as any,
                        session_status: {},
                        session_diff: {},
                        message: {},
                        part: {},
                        provider: {
                          all: new Map(),
                          connected: [] as string[],
                          default: {} as any,
                        },
                      }}
                      directory="/project/"
                    >
                      <DiffComponentProvider component={Diff}>
                        <CodeComponentProvider component={Code}>
                          <FileComponentProvider component={File}>
                            <MarkedProvider>
                              <div style={{ padding: "12px" }}>{props.children}</div>
                            </MarkedProvider>
                          </FileComponentProvider>
                        </CodeComponentProvider>
                      </DiffComponentProvider>
                    </DataProvider>
                  </SessionContext.Provider>
                </I18nProvider>
              </LanguageContext.Provider>
            </DialogProvider>
          </ProviderProvider>
        </ConfigProvider>
      </ServerProvider>
    </VSCodeProvider>
  )
}

const meta: Meta = {
  title: "History/SessionList",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

const SessionListDemo = () => {
  const [selected, setSelected] = createSignal("")

  return (
    <WithSessions sessions={mockSessions as any}>
      <div style={{ height: "500px" }}>
        <SessionList onSelectSession={setSelected} />
        <output class="sr-only" data-slot="selected-session">
          {selected()}
        </output>
      </div>
    </WithSessions>
  )
}

export const WithItems: Story = {
  name: "With sessions",
  render: () => <SessionListDemo />,
}

export const Sources: Story = {
  name: "Local and cloud sources",
  render: () => (
    <WithSessions sessions={mockSessions as any}>
      <div style={{ height: "500px" }}>
        <HistoryView onSelectSession={noop} onBack={noop} />
      </div>
    </WithSessions>
  ),
}

const WorktreeSourcesDemo = () => {
  const [selected, setSelected] = createSignal("")
  const ids = new Set(["s1", "s3"])

  return (
    <WithSessions sessions={mockSessions as any}>
      <div style={{ height: "500px" }}>
        <HistoryView onSelectSession={setSelected} onBack={noop} worktreeSessionIds={() => ids} />
        <output class="sr-only" data-slot="selected-session">
          {selected()}
        </output>
      </div>
    </WithSessions>
  )
}

export const WorktreeSources: Story = {
  name: "Current worktree source",
  render: () => <WorktreeSourcesDemo />,
}
