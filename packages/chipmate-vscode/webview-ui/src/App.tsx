import { Component, createSignal, createMemo, Switch, Match, onMount, onCleanup } from "solid-js"
import { ThemeProvider } from "@chipmate/chipmate-ui/theme"
import { DialogProvider } from "@chipmate/chipmate-ui/context/dialog"
import { MarkedProvider } from "@chipmate/chipmate-ui/context/marked"
import { CodeComponentProvider } from "@chipmate/chipmate-ui/context/code"
import { DiffComponentProvider } from "@chipmate/chipmate-ui/context/diff"
import { FileComponentProvider } from "@chipmate/chipmate-ui/context/file"
import { Code } from "@chipmate/chipmate-ui/code"
import { Diff } from "@chipmate/chipmate-ui/diff"
import { File } from "@chipmate/chipmate-ui/file"
import { DataProvider } from "@chipmate/chipmate-ui/context/data"
import { Toast } from "@chipmate/chipmate-ui/toast"
import Settings from "./components/settings/Settings"
import ProfileView from "./components/profile/ProfileView"
import { VSCodeProvider, useVSCode } from "./context/vscode"
import { ServerProvider, useServer } from "./context/server"
import { ProviderProvider, useProvider } from "./context/provider"
import { ConfigProvider } from "./context/config"
import { DisplayProvider } from "./context/display"
import { WorkStyleProvider } from "./context/work-style"
import { IndexingProvider } from "./context/indexing"
import { AgentRequirementsProvider } from "./context/agent-requirements"
import { MemoryProvider } from "./context/memory"
import { SessionProvider, useSession } from "./context/session"
import { ManualCompactionProvider } from "./context/manual-compaction"
import { LocalTabsProvider, useLocalTabs } from "./context/local-tabs"
import { SessionSurfaceProvider, useSessionSurface } from "./context/session-surface"
import { LanguageBridge } from "./context/language-bridge"
import { ChatView } from "./components/chat"
import { SidebarEmptyState } from "./components/chat/SidebarEmptyState"
import { registerExpandedTaskTool } from "./components/chat/TaskToolExpanded"
import { registerVscodeToolOverrides } from "./components/chat/VscodeToolOverrides"
import { registerUfsReviewTool } from "./components/chat/UfsReviewToolCard"
import { SpeechToTextPrewarm } from "./components/speech-to-text/SpeechToTextPrewarm"
import { DeepSeekHarnessProvider, useDeepSeekHarness } from "./context/deepseek-harness"
import { requestAgentSelection } from "./components/shared/ModeSwitcher"

// Override the upstream "task" tool renderer with the fully-expanded version
// that shows child session parts inline in the VS Code sidebar.
registerExpandedTaskTool()
registerUfsReviewTool()
// Apply VS Code sidebar preferences to other tools (e.g. bash expanded by default).
registerVscodeToolOverrides()
import HistoryView from "./components/history/HistoryView"
import { NotificationsProvider } from "./context/notifications"
import { FeedbackProvider } from "./context/feedback"
import { ChipMateEmbeddingModelsProvider } from "./context/chipmate-embedding-models"
import { ImageModelsProvider } from "./context/image-models"
import type { Message as SDKMessage, Part as SDKPart } from "@chipmate/sdk/v2"
import { gatewayTarget } from "./utils/internal-offline-ui"
import "./styles/chat.css"

type ViewType = "newTask" | "history" | "profile" | "settings" | "subAgentViewer"
const VALID_VIEWS = new Set<string>(["newTask", "history", "profile", "settings", "subAgentViewer"])

/**
 * Bridge our session store to the DataProvider's expected Data shape.
 *
 * CRITICAL: `data` is a plain object with getters — NOT a createMemo wrapping
 * the whole shape. Wrapping the shape in a memo defeats Solid's fine-grained
 * reactivity: any single `store.parts[X]` mutation would re-run the outer
 * memo, producing a fresh POJO, which invalidates every downstream consumer
 * that reads `data.store.*` — including all mounted SessionTurn memos that
 * scan all messages in the session. With hundreds of messages and a dozen
 * visible turns, per-token streaming ends up doing O(N × visible_turns) work
 * per delta, which is why long sessions stream slowly.
 *
 * By exposing the underlying Solid store directly via getters, consumers
 * reading `data.store.message[X]` or `data.store.part[Y]` subscribe to only
 * that specific key. A text-delta on message Y only invalidates consumers
 * that actually read `part[Y]`, not the whole tree.
 */
export const DataBridge: Component<{ children: any }> = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const prov = useProvider()
  const server = useServer()
  const surface = useSessionSurface()

  // Memos for fields that change infrequently (not per-token) — cheap and
  // avoids allocating a fresh array/object on every consumer read.
  const sessionList = createMemo(
    () => session.sessions().map((s) => ({ ...s, id: s.id, role: "user" as const })) as unknown as any[],
  )

  const permissionsBySession = createMemo(() => {
    const grouped: Record<string, any[]> = {}
    for (const p of session.permissions()) {
      const sid = p.sessionID
      if (!sid) continue
      ;(grouped[sid] ??= []).push(p)
    }
    return grouped
  })

  const providerData = createMemo(() => ({
    all: new Map(Object.entries(prov.providers())),
    connected: prov.connected(),
    default: prov.defaults(),
  }))

  // Stable object with reactive getters — passes through to Solid stores so
  // consumers keep per-key reactivity. The family-filter previously done here
  // was counter-productive: consumers only ever do per-session-id / per-
  // message-id lookups, so they never see unrelated entries in practice, and
  // the filter pass itself was the source of the O(N) cascade.
  const data = {
    get session() {
      return sessionList()
    },
    get session_status() {
      return session.allStatusMap() as unknown as Record<string, any>
    },
    get session_diff() {
      return {} as Record<string, any[]>
    },
    get message() {
      return session.allMessages() as unknown as Record<string, SDKMessage[]>
    },
    get part() {
      return session.allParts() as unknown as Record<string, SDKPart[]>
    },
    get permission() {
      return permissionsBySession()
    },
    // Questions are handled directly by QuestionDock via session.questions(),
    // not through DataProvider. The DataProvider's question field is unused here.
    get question() {
      return {}
    },
    get provider() {
      return providerData() as unknown as any
    },
  }

  const respond = (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) => {
    if (!surface.canMutate()) return
    session.respondToPermission(input.permissionID, input.response, [], [])
  }

  const reply = (input: { requestID: string; answers: string[][] }) => {
    if (!surface.canMutate()) return
    session.replyToQuestion(input.requestID, input.answers)
  }

  const reject = (input: { requestID: string }) => {
    if (!surface.canMutate()) return
    session.rejectQuestion(input.requestID)
  }

  const open = (filePath: string, line?: number, column?: number) => {
    vscode.postMessage({ type: "openFile", filePath, line, column })
  }

  const openDiff = (diff: { file: string; patch?: string; additions: number; deletions: number }) => {
    vscode.postMessage({ type: "openDiffVirtual", diff, initialDiffStyle: "split" })
  }

  const openUrl = (url: string) => {
    vscode.postMessage({ type: "openExternal", url })
  }

  const openContent = (content: string, language?: string) => {
    vscode.postMessage({ type: "openContent", content, language })
  }

  // File existence validation for code span candidates
  const pending = new Map<string, (existing: string[]) => void>()
  const counter = { n: 0 }
  const validateFiles = (paths: string[]): Promise<string[]> => {
    const id = `vf-${++counter.n}`
    return new Promise((resolve) => {
      pending.set(id, resolve)
      vscode.postMessage({ type: "validateFiles", id, paths })
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          resolve([])
        }
      }, 3000)
    })
  }
  const handler = (event: MessageEvent) => {
    const msg = event.data
    if (msg?.type === "validateFilesResult" && msg.id) {
      const cb = pending.get(msg.id)
      if (cb) {
        pending.delete(msg.id)
        cb(msg.existing ?? [])
      }
    }
  }
  onMount(() => window.addEventListener("message", handler))
  onCleanup(() => window.removeEventListener("message", handler))

  const directory = () => {
    const dir = server.workspaceDirectory()
    if (!dir) return ""
    return dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + "/"
  }

  return (
    <DataProvider
      data={data}
      directory={directory()}
      // @ts-expect-error — onPermissionRespond/onQuestion* are extension-specific props not yet in chipmate-ui's DataProvider types
      onPermissionRespond={respond}
      onQuestionReply={reply}
      onQuestionReject={reject}
      onOpenFile={open}
      onOpenDiff={openDiff}
      onOpenUrl={openUrl}
      onOpenContent={openContent}
      onValidateFiles={validateFiles}
      onNavigateToSession={(id) => {
        if (surface.kind() === "main-editor") {
          vscode.postMessage({ type: "sessionSurface.openMain", key: { kind: "session", id } })
          return
        }
        session.selectSession(id)
      }}
    >
      {props.children}
    </DataProvider>
  )
}

type MermaidImageEvent = CustomEvent<{ dataUrl: string; filename: string }>
type PlantUmlRenderEvent = CustomEvent<{ requestId: string; source: string }>

export const MermaidDownloadBridge: Component = () => {
  const vscode = useVSCode()

  onMount(() => {
    const save = (event: Event) => {
      const detail = (event as MermaidImageEvent).detail
      if (!detail?.dataUrl || !detail.filename) return
      event.preventDefault()
      vscode.postMessage({ type: "saveImage", dataUrl: detail.dataUrl, filename: detail.filename })
    }
    window.addEventListener("chipmate:save-image", save)
    onCleanup(() => {
      window.removeEventListener("chipmate:save-image", save)
    })
  })

  return null
}

export const PlantUmlBridge: Component = () => {
  const vscode = useVSCode()

  onMount(() => {
    const render = (event: Event) => {
      const detail = (event as PlantUmlRenderEvent).detail
      if (!detail?.requestId || !detail.source) return
      event.preventDefault()
      vscode.postMessage({ type: "renderPlantUml", requestId: detail.requestId, source: detail.source })
    }
    const unsubscribe = vscode.onMessage((message) => {
      if (message.type !== "plantUmlRendered") return
      window.dispatchEvent(new CustomEvent("chipmate:plantuml-rendered", { detail: message }))
    })
    window.addEventListener("chipmate:render-plantuml", render)
    onCleanup(() => {
      unsubscribe()
      window.removeEventListener("chipmate:render-plantuml", render)
    })
  })

  return null
}

// Inner app component that uses the contexts
const AppContent: Component = () => {
  const [currentView, setCurrentView] = createSignal<ViewType>("newTask")
  const [settingsTab, setSettingsTab] = createSignal<string | undefined>()
  const session = useSession()
  const tabs = useLocalTabs()
  const server = useServer()
  const vscode = useVSCode()
  const dsh = useDeepSeekHarness()
  const surface = useSessionSurface()

  const handleViewAction = (action: string) => {
    switch (action) {
      case "plusButtonClicked": {
        if (surface.kind() === "main-editor") {
          vscode.postMessage({
            type: "sessionSurface.openMain",
            key: { kind: "draft", id: `main-pending:${crypto.randomUUID()}` },
          })
          break
        }
        const chat = currentView() === "newTask"
        if (chat) window.dispatchEvent(new CustomEvent("newTaskRequest"))
        if (!chat && tabs) tabs.add()
        if (!chat && !tabs) session.clearCurrentSession()
        setCurrentView("newTask")
        break
      }
      case "historyButtonClicked":
        setCurrentView("history")
        break
      case "profileButtonClicked":
        {
          const target = gatewayTarget()
          if (target.tab) setSettingsTab(target.tab)
          setCurrentView(target.view)
        }
        break
      case "settingsButtonClicked":
        setCurrentView("settings")
        break
      case "cycleAgentMode":
        if (document.hasFocus()) cycleAgent(1)
        break
      case "cyclePreviousAgentMode":
        if (document.hasFocus()) cycleAgent(-1)
        break
      case "focusSearch":
        setCurrentView("newTask")
        window.dispatchEvent(new CustomEvent("focusTranscriptSearch"))
        break
    }
  }

  const cycleAgent = (direction: 1 | -1) => {
    const available = session.agents().filter((a) => a.mode !== "subagent" && !a.hidden)
    if (available.length <= 1) return
    const current = dsh.active() ? "deepseek-harness" : session.selectedAgent()
    const idx = available.findIndex((a) => a.name === current)
    const raw = idx + direction
    const next = raw < 0 ? available.length - 1 : raw >= available.length ? 0 : raw
    const agent = available[next]
    if (!agent) return
    requestAgentSelection(agent.name)
  }

  const handleForked = (message: { type?: string; sessionID?: string; forkedFromID?: string }) => {
    if (message.type !== "sessionForked" || !message.sessionID) return
    if (surface.kind() === "main-editor") {
      vscode.postMessage({ type: "sessionSurface.openMain", key: { kind: "session", id: message.sessionID } })
      setCurrentView("newTask")
      return
    }
    if (tabs && message.forkedFromID) tabs.openAfter(message.forkedFromID, message.sessionID)
    if (tabs && !message.forkedFromID) tabs.open(message.sessionID)
    if (!tabs) session.selectSession(message.sessionID)
    setCurrentView("newTask")
  }

  const [forkState, setForkState] = createSignal<{
    sessionID: string
    afterMessageID?: string
    state: "pending" | "slow"
  }>()
  const handleForkState = (message: {
    type?: string
    sessionID?: string
    afterMessageID?: string
    state?: string
  }) => {
    if (message.type !== "sessionForkState" || !message.sessionID) return
    if (message.state !== "pending" && message.state !== "slow") return setForkState(undefined)
    setForkState({ sessionID: message.sessionID, afterMessageID: message.afterMessageID, state: message.state })
  }

  const handleChipMateModel = (message: { type?: string }) => {
    if (message.type === "selectChipMateModel") setCurrentView("newTask")
  }

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data
      if (message?.type === "action" && message.action) {
        console.log("[ChipMate New] App: 🎬 action:", message.action)
        handleViewAction(message.action)
      }
      if (message?.type === "navigate" && message.view && VALID_VIEWS.has(message.view)) {
        console.log("[ChipMate New] App: 🧭 navigate:", message.view, message.tab ? `tab=${message.tab}` : "")
        const target =
          message.view === "profile" ? gatewayTarget() : { view: message.view as ViewType, tab: message.tab }
        if (target.tab) setSettingsTab(target.tab)
        setCurrentView(target.view)
        vscode.postMessage({ type: "settingsTabChanged", tab: target.tab })
      }
      if (message?.type === "openCloudSession" && message.sessionId) {
        console.log("[ChipMate New] App: ☁️ openCloudSession:", message.sessionId)
        session.selectCloudSession(message.sessionId)
        setCurrentView("newTask")
      }
      handleChipMateModel(message)
      handleForkState(message)
      handleForked(message)
      if (message?.type === "viewSubAgentSession" && message.sessionID) {
        console.log("[ChipMate New] App: 🔍 viewSubAgentSession:", message.sessionID)
        session.setCurrentSessionID(message.sessionID)
        setCurrentView("subAgentViewer")
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  const handleSelectSession = (id: string) => {
    if (surface.kind() === "main-editor") {
      vscode.postMessage({ type: "sessionSurface.openMain", key: { kind: "session", id } })
      setCurrentView("newTask")
      return
    }
    if (tabs) tabs.open(id)
    if (!tabs) session.selectSession(id)
    setCurrentView("newTask")
  }

  const handleForkMessage = (sessionId: string, messageId: string) => {
    if (forkState()?.sessionID === sessionId) return
    setForkState({ sessionID: sessionId, afterMessageID: messageId, state: "pending" })
    vscode.postMessage({ type: "forkSession", sessionId, afterMessageId: messageId })
  }

  const emptyState = () => (
    <SidebarEmptyState onSelectSession={handleSelectSession} onShowHistory={() => setCurrentView("history")} />
  )

  return (
    <div class="container">
      <Switch
        fallback={
          <ChatView
            continueInWorktree
            onForkMessage={handleForkMessage}
            forkState={forkState()}
            promptBoxId="sidebar:fallback"
            emptyState={emptyState}
          />
        }
      >
        <Match when={currentView() === "newTask"}>
          <ChatView
            onSelectSession={handleSelectSession}
            onForkMessage={handleForkMessage}
            forkState={forkState()}
            continueInWorktree
            promptBoxId="sidebar:new-task"
            emptyState={emptyState}
          />
        </Match>
        <Match when={currentView() === "history"}>
          <HistoryView onSelectSession={handleSelectSession} onBack={() => setCurrentView("newTask")} />
        </Match>
        <Match when={currentView() === "profile"}>
          <ProfileView
            profileData={server.profileData()}
            deviceAuth={server.deviceAuth()}
            onLogin={server.startLogin}
          />
        </Match>
        <Match when={currentView() === "settings"}>
          <Settings
            tab={settingsTab()}
            onTabChange={setSettingsTab}
            onClose={() => vscode.postMessage({ type: "closePanel" })}
          />
        </Match>
        <Match when={currentView() === "subAgentViewer"}>
          <ChatView readonly />
        </Match>
      </Switch>
    </div>
  )
}

// Main App component with context providers
const App: Component = () => {
  return (
    <ThemeProvider defaultTheme="chipmate-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <SessionSurfaceProvider>
            <MermaidDownloadBridge />
            <PlantUmlBridge />
            <ServerProvider>
              <LanguageBridge>
                <MarkedProvider>
                  <DiffComponentProvider component={Diff}>
                    <CodeComponentProvider component={Code}>
                      <FileComponentProvider component={File}>
                        <ProviderProvider>
                          <DeepSeekHarnessProvider>
                            <ConfigProvider>
                              <SpeechToTextPrewarm />
                              <DisplayProvider>
                                <WorkStyleProvider>
                                  <IndexingProvider>
                                    <ChipMateEmbeddingModelsProvider>
                                      <ImageModelsProvider>
                                        <NotificationsProvider>
                                          <SessionProvider>
                                            <ManualCompactionProvider>
                                              <LocalTabsProvider>
                                                <AgentRequirementsProvider>
                                                  <MemoryProvider>
                                                    <FeedbackProvider>
                                                      <DataBridge>
                                                        <AppContent />
                                                      </DataBridge>
                                                    </FeedbackProvider>
                                                  </MemoryProvider>
                                                </AgentRequirementsProvider>
                                              </LocalTabsProvider>
                                            </ManualCompactionProvider>
                                          </SessionProvider>
                                        </NotificationsProvider>
                                      </ImageModelsProvider>
                                    </ChipMateEmbeddingModelsProvider>
                                  </IndexingProvider>
                                </WorkStyleProvider>
                              </DisplayProvider>
                            </ConfigProvider>
                          </DeepSeekHarnessProvider>
                        </ProviderProvider>
                      </FileComponentProvider>
                    </CodeComponentProvider>
                  </DiffComponentProvider>
                </MarkedProvider>
              </LanguageBridge>
            </ServerProvider>
          </SessionSurfaceProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}

export default App
