/** @jsxImportSource solid-js */

/**
 * ChatView component
 * Main chat container that combines all chat components
 */

import { TurnChangesProvider } from "../../context/turn-changes"
import { TurnChangesDock } from "./TurnChangesDock"
import { type Component, type JSX, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@chipmate/chipmate-ui/button"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { Spinner } from "@chipmate/chipmate-ui/dynamic-spinner"
import { Tooltip } from "@chipmate/chipmate-ui/tooltip"
import { showToast } from "@chipmate/chipmate-ui/toast"
import { DropdownMenu } from "@chipmate/chipmate-ui/dropdown-menu"
import { TaskHeader } from "./TaskHeader"
import { MessageList } from "./MessageList"
import { AgentRequirements } from "./AgentRequirements"
import { PromptInput } from "./PromptInput"
import { PermissionDock } from "./PermissionDock"
import { PermissionDialogController } from "./PermissionDialogController"
import { editPermission, permissionPresentation } from "./permission-presentation"
import { StartupErrorBanner } from "./StartupErrorBanner"
import { SessionTabStrip } from "./SessionTabStrip"
import { useSession } from "../../context/session"
import { useLocalTabs } from "../../context/local-tabs"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useWorktreeMode } from "../../context/worktree-mode"
import { useServer } from "../../context/server"
import { useAgentRequirements } from "../../context/agent-requirements"
import { TranscriptSearchProvider } from "../../context/transcript-search"
import { isPromptBlocked, isSuggesting, isQuestioning } from "./prompt-input-utils"
import { showTabStrip } from "../../utils/local-tabs"
import { canUseSidebarSessionActions } from "../../utils/internal-offline-ui"
import { useDeepSeekHarness } from "../../context/deepseek-harness"
import { DeepSeekHarnessComposer, DeepSeekHarnessConversation } from "../deepseek-harness/DeepSeekHarnessConversation"
import { DeepSeekHarnessTaskHeader } from "../deepseek-harness/DeepSeekHarnessTaskHeader"
import { useSessionSurface } from "../../context/session-surface"
import type { SessionSurfacePhase } from "../../../../src/shared/session-surface"

interface ChatViewProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  onForkMessage?: (sessionId: string, messageId: string) => void
  forkState?: { sessionID: string; afterMessageID?: string; state: "pending" | "slow" }
  onForkSession?: (sessionId: string) => void
  readonly?: boolean
  /** When true, show the "Continue in Worktree" button. Defaults to true in the sidebar. */
  continueInWorktree?: boolean
  promptBoxId?: string
  pendingSessionID?: string
  emptyState?: () => JSX.Element
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const language = useLanguage()
  const worktreeMode = useWorktreeMode()
  const server = useServer()
  const tabs = useLocalTabs()
  const requirements = useAgentRequirements()
  const deepSeekHarness = useDeepSeekHarness()
  const surface = useSessionSurface()
  // Show "Show Changes" only in the standalone sidebar, not inside Agent Manager
  const isSidebar = () => surface.kind() === "sidebar" && worktreeMode === undefined
  const readonly = () => props.readonly === true || !surface.canMutate()
  const pendingSessionID = () => props.pendingSessionID ?? tabs?.pending()
  // Show "Continue in Worktree": only when explicitly enabled via prop
  const canContinueInWorktree = () => props.continueInWorktree === true

  const id = () => session.currentSessionID()
  const hasMessages = () => session.messages().length > 0
  const idle = () => session.status() !== "busy"

  // "Continue in Worktree" state
  const [transferring, setTransferring] = createSignal(false)
  const [transferDetail, setTransferDetail] = createSignal("")
  const [repoBranch, setRepoBranch] = createSignal<string>()
  let worktreeRef: HTMLDivElement | undefined

  // Permissions and questions scoped to this session's family (self + subagents).
  // Each ChatView only sees its own session tree — no cross-session leakage.
  // Memoized so the BFS walk in sessionFamily() runs once per reactive update,
  // not once per accessor call (questionRequest, permissionRequest, blocked all read these).
  const familyPermissions = createMemo(() => session.scopedPermissions(id()))
  const familyQuestions = createMemo(() => session.scopedQuestions(id()))
  const familySuggestions = createMemo(() => session.scopedSuggestions(id()))
  // Non-tool questions (standalone, not from the question tool) render inline in
  // the message list since they don't have an associated tool part in the conversation.
  // Tool-linked questions render inline at their tool part position via AssistantMessage.
  const standaloneQuestions = createMemo(() => familyQuestions().filter((q) => !q.tool))
  const standaloneSuggestions = createMemo(() => familySuggestions().filter((s) => !s.tool))
  const permissionRequest = () => familyPermissions().find((p) => p.sessionID === id()) ?? familyPermissions()[0]
  // Questions and suggestions do not block input; permissions and agent requirements do.
  // Pending questions and suggestions are auto-dismissed in sendMessage/sendCommand.
  const blocked = () => isPromptBlocked(familyPermissions().length) || (!readonly() && requirements.blocked())
  const requirementReason = () =>
    !readonly() && requirements.blocked() ? language.t("agentRequirements.prompt.blocked") : undefined
  // Session is busy only because a suggestion tool call is pending — prompt should behave as idle
  const suggesting = () => isSuggesting(blocked(), familySuggestions().length)
  // Session is busy only because a question tool call is pending — prompt should behave as idle
  const questioning = () => isQuestioning(blocked(), familyQuestions().length)
  const dock = () => !readonly() || !!permissionRequest()

  onMount(() => {
    if (props.readonly) return
    const handler = (e: KeyboardEvent) => {
      if (readonly()) return
      if (e.key !== "Escape" || (!session.submitting() && session.status() === "idle") || e.defaultPrevented) return
      e.preventDefault()
      session.abort()
    }
    document.addEventListener("keydown", handler)
    onCleanup(() => document.removeEventListener("keydown", handler))
  })

  // Listen for "Continue in Worktree" progress messages
  {
    const labels: Record<string, string> = {
      capturing: language.t("sidebar.session.progress.capturing"),
      creating: language.t("sidebar.session.progress.creating"),
      setup: language.t("sidebar.session.progress.setup"),
      transferring: language.t("sidebar.session.progress.transferring"),
      forking: language.t("sidebar.session.progress.forking"),
    }
    const cleanup = vscode.onMessage((msg) => {
      if (msg.type === "agentManager.repoInfo") {
        setRepoBranch(msg.branch)
        return
      }
      if (msg.type !== "continueInWorktreeProgress") return
      const m = msg as { status: string; error?: string }
      if (m.status === "done") {
        setTransferring(false)
        setTransferDetail("")
        return
      }
      if (m.status === "error") {
        setTransferring(false)
        setTransferDetail("")
        showToast({ title: m.error ?? language.t("sidebar.session.progress.failed") })
        return
      }
      setTransferDetail(labels[m.status] ?? language.t("session.status.working"))
    })
    onCleanup(cleanup)
  }

  const decide = (response: "once" | "always" | "reject", approvedAlways: string[], deniedAlways: string[]) => {
    const perm = permissionRequest()
    if (!perm || session.respondingPermissions().has(perm.id)) return
    session.respondToPermission(perm.id, response, approvedAlways, deniedAlways)
  }

  const edit = (request: import("../../types/messages").PermissionRequest) => {
    editPermission(
      request,
      session.respondingPermissions().has(request.id),
      () => session.respondToPermission(request.id, "reject", [], []),
      (text) => {
        window.dispatchEvent(new CustomEvent("prefillPrompt", { detail: { text } }))
        window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } }))
      },
    )
  }

  const highRiskPermission = () => {
    const request = permissionRequest()
    if (!request || permissionPresentation(request) !== "high") return undefined
    return request
  }

  const startSession = () => {
    if (surface.kind() === "main-editor") {
      vscode.postMessage({
        type: "sessionSurface.openMain",
        key: { kind: "draft", id: `main-pending:${crypto.randomUUID()}` },
      })
      return
    }
    window.dispatchEvent(new CustomEvent("newTaskRequest"))
  }

  const fork = () => {
    const sid = id()
    if (!sid) return
    props.onForkSession?.(sid)
  }

  const startWorktree = () => vscode.postMessage({ type: "agentManager.createWorktree" })

  const startWorktreeFromBranch = () =>
    vscode.postMessage({ type: "agentManager.createWorktree", baseBranch: repoBranch()! })

  const openAgentManager = () => vscode.postMessage({ type: "openAgentManager" })

  const openChanges = () => vscode.postMessage({ type: "openChanges" })

  const moveToWorktree = () => {
    if (transferring()) return
    const sid = id()
    if (!sid) return
    setTransferring(true)
    setTransferDetail(language.t("sidebar.session.progress.capturing"))
    vscode.postMessage({ type: "continueInWorktree", sessionId: sid })
  }

  const worktreeTooltip = language.t("sidebar.session.newWorktree.tooltip")

  const advancedTooltip = language.t("sidebar.session.configureWorktree.tooltip")

  const moveTooltip = () => {
    const stats = session.worktreeStats()
    if (!stats?.files) return language.t("sidebar.session.moveToWorktree.tooltip.empty")
    if (stats.files === 1) return language.t("sidebar.session.moveToWorktree.tooltip.one")
    return language.t("sidebar.session.moveToWorktree.tooltip.other", { files: stats.files })
  }

  const changesTooltip = () => {
    const stats = session.worktreeStats()
    if (!stats?.files) return language.t("sidebar.session.showChanges.tooltip.empty")
    return (
      <span class="session-changes-tooltip">
        <span>{stats.files === 1 ? "1 file changed" : `${stats.files} files changed`}</span>
        <span class="session-changes-tooltip-separator">·</span>
        <span class="session-diff-add">+{stats.additions}</span>
        <span class="session-diff-del">-{stats.deletions}</span>
        <span>Open the changes view.</span>
      </span>
    )
  }

  const showAdvancedWorktree = () => vscode.postMessage({ type: "openAdvancedWorktree" })

  createEffect(() => {
    if (!isSidebar() || !server.gitInstalled()) return
    vscode.postMessage({ type: "agentManager.requestRepoInfo" })
  })

  const canStartSession = (hasChat: boolean) => hasChat

  const canFork = (hasChat: boolean) => hasChat && !isSidebar() && session.status() === "idle" && !!props.onForkSession

  const canStartWorktree = () => isSidebar() && server.gitInstalled()

  const canMoveToWorktree = (hasChat: boolean) => hasChat && canContinueInWorktree() && server.gitInstalled()

  const hasActions = (hasChat: boolean) => {
    if (isSidebar() && !canUseSidebarSessionActions()) return false
    return canStartSession(hasChat) || canFork(hasChat) || canStartWorktree() || canMoveToWorktree(hasChat)
  }

  const renderActions = (hasChat: boolean) => (
    <Show when={hasActions(hasChat)}>
      <div class="new-task-button-wrapper" classList={{ "new-task-button-wrapper--empty": !hasChat }}>
        <div class="session-actions-row">
          <Show when={canStartSession(hasChat)}>
            <Tooltip value={language.t("sidebar.session.newSession.tooltip")} placement="top" disabled>
              <Button
                variant="secondary"
                size="small"
                class="session-new-button"
                onClick={startSession}
                aria-label={language.t("sidebar.session.newSession")}
              >
                {language.t("sidebar.session.newSession")}
              </Button>
            </Tooltip>
          </Show>
          <Show when={canFork(hasChat)}>
            <Tooltip value={language.t("agentManager.tab.forkSession")} placement="top">
              <Button
                variant="ghost"
                size="small"
                onClick={fork}
                aria-label={language.t("agentManager.tab.forkSession")}
              >
                <Icon name="fork" size="small" />
                {language.t("agentManager.tab.forkSession")}
              </Button>
            </Tooltip>
          </Show>
          <Show when={canStartWorktree()}>
            <div class="session-worktree-split" ref={worktreeRef}>
              <Tooltip value={worktreeTooltip} placement="top" disabled>
                <Button
                  variant="secondary"
                  size="small"
                  class="session-worktree-main"
                  onClick={startWorktree}
                  aria-label={language.t("sidebar.session.newWorktree")}
                >
                  {language.t("sidebar.session.newWorktree")}
                </Button>
              </Tooltip>
              <DropdownMenu gutter={4} placement="top-start" getAnchorRect={() => worktreeRef?.getBoundingClientRect()}>
                <Tooltip value={advancedTooltip} placement="top" disabled>
                  <DropdownMenu.Trigger
                    class="session-worktree-split-arrow"
                    aria-label={language.t("agentManager.worktree.advancedOptions")}
                  >
                    <Icon name="chevron-down" size="small" />
                  </DropdownMenu.Trigger>
                </Tooltip>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="session-worktree-split-menu">
                    <DropdownMenu.Item disabled={!repoBranch()} onSelect={startWorktreeFromBranch}>
                      <span class="session-worktree-menu-gap" aria-hidden="true" />
                      <DropdownMenu.ItemLabel class="session-worktree-menu-label">
                        <span>{language.t("sidebar.session.newWorktree.from")}</span>
                        <span class="session-worktree-menu-branch">
                          <Icon name="branch" size="small" />
                          <strong>{repoBranch() ?? language.t("sidebar.session.currentBranch")}</strong>
                        </span>
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={showAdvancedWorktree}>
                      <Icon name="settings-gear" size="small" />
                      <DropdownMenu.ItemLabel>
                        {language.t("agentManager.dialog.configureWorktree")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </div>
          </Show>
          <Show when={canMoveToWorktree(hasChat)}>
            <>
              <Tooltip value={moveTooltip()} placement="top" disabled>
                <Button
                  variant="ghost"
                  size="small"
                  class="session-move-action"
                  aria-disabled={transferring()}
                  onClick={moveToWorktree}
                  aria-label={language.t("sidebar.session.moveToWorktree")}
                >
                  <Show when={transferring()} fallback={<Icon name="branch" size="small" />}>
                    <Spinner class="chat-spinner-small" />
                  </Show>
                  <span class="session-move-label">
                    {transferring() ? transferDetail() : language.t("sidebar.session.moveToWorktree")}
                  </span>
                </Button>
              </Tooltip>
              <Tooltip value={changesTooltip()} placement="top" class="session-move-changes-trigger">
                <Button
                  variant="ghost"
                  size="small"
                  class="session-move-changes"
                  classList={{
                    "session-move-changes--empty": !session.worktreeStats()?.files,
                    "session-move-changes--has-changes": !!session.worktreeStats()?.files,
                  }}
                  onClick={openChanges}
                  aria-label={language.t("command.session.show.changes")}
                >
                  <Icon name="layers" size="small" />
                  <Show when={session.worktreeStats()?.files}>
                    <span class="session-diff-add">+{session.worktreeStats()!.additions}</span>
                    <span class="session-diff-del">-{session.worktreeStats()!.deletions}</span>
                    <span class="session-move-dot" aria-hidden="true" />
                  </Show>
                </Button>
              </Tooltip>
            </>
          </Show>
        </div>
      </div>
    </Show>
  )

  return (
    <TurnChangesProvider enabled={!deepSeekHarness.active()}>
    <TranscriptSearchProvider>
      <div
        class="chat-view"
        classList={{ "chat-view--surface-deleted": surface.state()?.phase === "deleted" }}
        data-ui="qa-shell"
      >
        <Show when={isSidebar() && !props.readonly && tabs && showTabStrip(tabs.ids())}>
          <SessionTabStrip />
        </Show>
        <Show when={deepSeekHarness.active()} fallback={<TaskHeader readonly={readonly()} navigation={!readonly()} />}>
          <DeepSeekHarnessTaskHeader />
        </Show>
        <SessionSurfaceBanner readonly={props.readonly === true} />
        <div class="chat-messages-wrapper" data-ui="qa-conversation">
          <div class="chat-messages">
            <Show
              when={!readonly() && !deepSeekHarness.active() && requirements.visible()}
              fallback={
                <Show
                  when={deepSeekHarness.active()}
                  fallback={
                    <MessageList
                      onSelectSession={props.onSelectSession}
                      onShowHistory={props.onShowHistory}
                      onForkMessage={props.onForkMessage}
                      forkState={props.forkState}
                      questions={standaloneQuestions}
                      suggestions={standaloneSuggestions}
                      readonly={readonly()}
                      emptyState={props.emptyState}
                      announce={isSidebar()}
                      sessionID={pendingSessionID}
                    />
                  }
                >
                  <DeepSeekHarnessConversation />
                </Show>
              }
            >
              <AgentRequirements />
            </Show>
          </div>
        </div>

        <Show when={dock()}>
          <div class="chat-input" data-ui="qa-dock">
            <Show when={!deepSeekHarness.active()}>
              <PermissionDialogController
                request={() => (readonly() ? undefined : highRiskPermission())}
                responding={(permissionId) => session.respondingPermissions().has(permissionId)}
                onDecide={decide}
                onEdit={edit}
              />
              <Show when={server.connectionState() === "error" && server.errorMessage()}>
                <StartupErrorBanner errorMessage={server.errorMessage()!} errorDetails={server.errorDetails()!} />
              </Show>
              <Show
                when={
                  !readonly() && permissionRequest() && permissionPresentation(permissionRequest()!) === "standard"
                    ? permissionRequest()
                    : undefined
                }
                keyed
              >
                {(perm) => (
                  <PermissionDock
                    request={perm}
                    responding={session.respondingPermissions().has(perm.id)}
                    onDecide={decide}
                    onEdit={() => edit(perm)}
                  />
                )}
              </Show>
              <Show when={!readonly() && idle() && !blocked() && hasActions(hasMessages())}>
                {renderActions(hasMessages())}
              </Show>
              <Show when={!readonly() && !deepSeekHarness.active()}>
                <TurnChangesDock />
                <PromptInput
                  blocked={blocked}
                  blockedReason={requirementReason}
                  suggesting={suggesting}
                  questioning={questioning}
                  boxId={props.promptBoxId}
                  pendingSessionID={pendingSessionID()}
                />
              </Show>
            </Show>
            <Show when={!readonly() && deepSeekHarness.active()}>
              <DeepSeekHarnessComposer />
            </Show>
          </div>
        </Show>
      </div>
    </TranscriptSearchProvider>
    </TurnChangesProvider>
  )
}

type SurfaceStatusKey =
  | "session.surface.status.disconnected"
  | "session.surface.status.opening"
  | "session.surface.status.returning"
  | "session.surface.status.restoring"
  | "session.surface.status.deleted"
  | "session.surface.owner.main"
  | "session.surface.mirror"

const SessionSurfaceBanner: Component<{ readonly: boolean }> = (props) => {
  const surface = useSessionSurface()
  const server = useServer()
  const language = useLanguage()
  const mirrored = () =>
    !props.readonly && !!surface.state() && !surface.canMutate() && surface.state()?.phase !== "deleted"
  const visible = () => surface.kind() === "main-editor" || mirrored()
  const status = () =>
    language.t(
      surfaceStatusKey(
        surface.kind() === "main-editor" && surface.state()?.phase === "sidebar"
          ? "opening-main"
          : surface.state()?.phase,
        surface.canMutate(),
        server.connectionState() === "error",
      ),
    )
  return (
    <>
      <Show when={visible()}>
        <div class="session-surface-bar" data-phase={surface.state()?.phase}>
          <span class="session-surface-status" role="status" aria-live="polite">
            <Icon name={surface.canMutate() ? "check" : "eye"} size="small" />
            {status()}
          </span>
          <div class="session-surface-actions">
            <Show when={mirrored()}>
              <Button variant="ghost" size="small" onClick={surface.focusOwner}>
                {language.t("session.surface.focusMain")}
              </Button>
            </Show>
            <Show when={surface.state()?.phase !== "deleted"}>
              <Button
                variant="secondary"
                size="small"
                disabled={surface.state()?.phase === "returning-sidebar"}
                onClick={surface.returnToSidebar}
              >
                {language.t("session.surface.returnSidebar")}
              </Button>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={surface.state()?.phase === "deleted"}>
        <div class="session-surface-deleted" role="status">
          <strong>{language.t("session.surface.deleted.title")}</strong>
          <span>{language.t("session.surface.deleted.detail")}</span>
        </div>
      </Show>
    </>
  )
}

function surfaceStatusKey(
  phase: SessionSurfacePhase | undefined,
  canMutate: boolean,
  disconnected: boolean,
): SurfaceStatusKey {
  if (disconnected) return "session.surface.status.disconnected"
  if (phase === "opening-main") return "session.surface.status.opening"
  if (phase === "returning-sidebar") return "session.surface.status.returning"
  if (phase === "restoring") return "session.surface.status.restoring"
  if (phase === "deleted") return "session.surface.status.deleted"
  return canMutate ? "session.surface.owner.main" : "session.surface.mirror"
}
