import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  onCleanup,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js"
import type { PendingInteraction } from "@deepseek-ai/dsh-client-runtime/client"
import { useVSCode } from "./vscode"
import type { ModelSelection } from "../types/messages"
import {
  type DeepSeekHarnessEventMessage,
  type DeepSeekHarnessExtensionMessage,
  type DeepSeekHarnessModel,
  type DeepSeekHarnessSnapshot,
  type DeepSeekHarnessWebviewMessage,
} from "../../../src/shared/deepseek-harness"
import {
  DeepSeekHarnessRelay,
  OfficialDeepSeekHarnessClient,
  type OfficialConversation,
} from "./deepseek-harness-official-client"
import { useSessionSurface } from "./session-surface"

export interface DeepSeekHarnessContextValue {
  active: Accessor<boolean>
  snapshot: Accessor<DeepSeekHarnessSnapshot>
  conversation: Accessor<OfficialConversation | undefined>
  operationError: Accessor<string | undefined>
  pending: Accessor<readonly PendingInteraction[]>
  readyForInput: Accessor<boolean>
  eligible: Accessor<DeepSeekHarnessModel[]>
  selectedModel: Accessor<DeepSeekHarnessModel | undefined>
  activate: (preferred?: ModelSelection | null) => void
  deactivate: () => void
  send: (text: string, mode: "queue" | "steer") => Promise<void>
  cancel: () => Promise<void>
  selectModel: (model: DeepSeekHarnessModel) => Promise<void>
  selectReasoningEffort: (effort: string) => Promise<void>
  post: (message: DeepSeekHarnessWebviewMessage) => void
}

const empty: DeepSeekHarnessSnapshot = {
  state: "stopped",
  active: false,
  sessions: [],
  models: [],
  providerOptions: [],
  selectionState: "checking",
  connectionGeneration: 0,
  running: false,
}

export const DeepSeekHarnessContext = createContext<DeepSeekHarnessContextValue>()

export const DeepSeekHarnessProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const surface = useSessionSurface()
  const [snapshot, setSnapshot] = createSignal(empty)
  const [conversation, setConversation] = createSignal<OfficialConversation>()
  const [operationError, setOperationError] = createSignal<string>()
  const [active, setActive] = createSignal(false)
  const [selectedModel, setSelectedModel] = createSignal<DeepSeekHarnessModel>()
  const initial = vscode.getState<Record<string, unknown>>() ?? {}
  const [taskId, setTaskId] = createSignal(
    typeof initial.chipmateDeepSeekHarnessTaskId === "string"
      ? initial.chipmateDeepSeekHarnessTaskId
      : window.crypto.randomUUID(),
  )
  const eligible = createMemo<DeepSeekHarnessModel[]>(() =>
    snapshot()
      .providerOptions.filter((option) => option.available)
      .flatMap((option) => option.models),
  )
  const readyForInput = createMemo(() => {
    const current = snapshot()
    return (
      active() &&
      surface.canMutate() &&
      surface.hasDshLease() &&
      current.active &&
      current.state === "ready" &&
      current.selectionState === "ready" &&
      sameSelection(current.desiredSelection, current.runningSelection) &&
      current.presetState === "ready" &&
      !current.readOnlySession &&
      current.taskId === taskId() &&
      conversation()?.snapshot.sessionId === current.sessionId
    )
  })
  const canOperate = () => surface.canMutate() && surface.hasDshLease()
  const bridge = {
    postMessage: (message: DeepSeekHarnessWebviewMessage) => vscode.postMessage(message),
    onMessage: (handler: (message: DeepSeekHarnessExtensionMessage | DeepSeekHarnessEventMessage) => void) =>
      vscode.onMessage((message) => {
        if (message.type.startsWith("chipmateDeepSeekHarness."))
          handler(message as DeepSeekHarnessExtensionMessage | DeepSeekHarnessEventMessage)
      }),
  }
  const relay = new DeepSeekHarnessRelay(bridge)
  createEffect(() => relay.setTaskId(taskId()))
  const official = new OfficialDeepSeekHarnessClient(relay)
  let disposal = Promise.resolve()
  const disposeOfficial = () => {
    const task = disposal.catch(() => undefined).then(() => official.dispose())
    disposal = task
    return task
  }
  let projectionKey = ""
  let projectionTask: Promise<void> | undefined
  let resyncKey = ""
  let modelDirectoryKey = ""
  let requestedTaskId = ""

  const project = (next: DeepSeekHarnessSnapshot): void => {
    if (!surface.canMutate() || !surface.hasDshLease()) return
    const sessionId = next.sessionId
    const manifest = next.bootManifest
    if (!sessionId || !manifest) return
    if (next.state === "resyncing-session") {
      const key = `${next.connectionGeneration}:${sessionId}`
      if (resyncKey === key) return
      resyncKey = key
      void disposal
        .catch(() => undefined)
        .then(() => official.waitUntilResynced(sessionId, setConversation))
        .then(() => {
          if (resyncKey !== key) return
          vscode.postMessage({
            type: "chipmateDeepSeekHarness.projectionReady",
            taskId: taskId(),
            sessionId,
            connectionGeneration: next.connectionGeneration,
          })
        })
        .catch((error) => {
          if (resyncKey !== key) return
          const detail = safeError(error)
          setOperationError(detail)
          vscode.postMessage({
            type: "chipmateDeepSeekHarness.projectionFailed",
            taskId: taskId(),
            sessionId,
            connectionGeneration: next.connectionGeneration,
            error: detail,
          })
          window.setTimeout(() => {
            if (resyncKey !== key || snapshot().state !== "resyncing-session") return
            resyncKey = ""
            project(snapshot())
          }, 1_000)
        })
      return
    }
    if (next.state !== "projecting-session" && next.state !== "ready") return
    const key = `${manifest.rev}:${sessionId}`
    if (projectionKey === key && (projectionTask || conversation()?.snapshot.sessionId === sessionId)) return
    projectionKey = key
    relay.setGeneration(next.connectionGeneration)
    setConversation(undefined)
    setOperationError(undefined)
    const task = disposal
      .catch(() => undefined)
      .then(() => official.open(manifest, sessionId, setConversation))
      .then(() => {
        if (projectionKey !== key) return
        vscode.postMessage({
          type: "chipmateDeepSeekHarness.projectionReady",
          taskId: taskId(),
          sessionId,
          connectionGeneration: next.connectionGeneration,
        })
      })
      .catch((error) => {
        if (projectionKey !== key) return
        const detail = safeError(error)
        setOperationError(detail)
        vscode.postMessage({
          type: "chipmateDeepSeekHarness.projectionFailed",
          taskId: taskId(),
          sessionId,
          connectionGeneration: next.connectionGeneration,
          error: detail,
        })
      })
      .finally(() => {
        if (projectionTask === task) projectionTask = undefined
      })
    projectionTask = task
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "sessionSurface.dsh.detachRequested") {
      projectionKey = ""
      resyncKey = ""
      modelDirectoryKey = ""
      setConversation(undefined)
      void disposeOfficial().then(() => {
        vscode.postMessage({ type: "chipmateDeepSeekHarness.detached", taskId: message.taskId })
      })
      return
    }
    if (message.type !== "chipmateDeepSeekHarness.connectionState") return
    relay.setGeneration(message.snapshot.connectionGeneration)
    setSnapshot(message.snapshot)
    setSelectedModel(message.snapshot.selectedModel)
    project(message.snapshot)
    const nextModelDirectoryKey = [
      message.snapshot.connectionGeneration,
      message.snapshot.sessionId,
      message.snapshot.runningSelection?.providerID,
      message.snapshot.runningSelection?.modelID,
    ].join(":")
    if (nextModelDirectoryKey !== modelDirectoryKey) {
      modelDirectoryKey = nextModelDirectoryKey
      if (canOperate()) void official.refreshModelDirectory().catch(() => undefined)
    }
    if (["stopped", "crashed", "runtime-unavailable"].includes(message.snapshot.state)) {
      projectionKey = ""
      resyncKey = ""
      modelDirectoryKey = ""
      setConversation(undefined)
      void disposeOfficial()
    }
  })
  createEffect(() => {
    const state = surface.state()
    if (state?.mode === "deepseek-harness" && state.taskId) {
      setTaskId(state.taskId)
      setActive(true)
    }
    if (canOperate()) {
      if (
        state?.mode === "deepseek-harness" &&
        state.taskId &&
        snapshot().taskId !== state.taskId &&
        requestedTaskId !== state.taskId
      ) {
        requestedTaskId = state.taskId
        const selected = snapshot().desiredSelection ?? snapshot().runningSelection ?? selectedModel()
        vscode.postMessage({
          type: "chipmateDeepSeekHarness.activate",
          taskId: state.taskId,
          preferredSelection: selected ? { providerID: selected.providerID, modelID: selected.modelID } : undefined,
        })
      }
      if (snapshot().taskId === state?.taskId) requestedTaskId = ""
      project(snapshot())
      return
    }
    projectionKey = ""
    resyncKey = ""
    modelDirectoryKey = ""
    setConversation(undefined)
    void disposeOfficial()
  })
  onCleanup(() => {
    unsubscribe()
    relay.dispose()
    void disposeOfficial()
  })
  let refreshToken = ""
  createEffect(() => {
    const token = surface.state()?.token
    if (!token) return
    const signature = `${token.generation}:${token.epoch}`
    if (signature === refreshToken) return
    refreshToken = signature
    vscode.postMessage({ type: "chipmateDeepSeekHarness.refresh" })
  })
  onMount(() => {
    vscode.setState({ ...initial, chipmateDeepSeekHarnessTaskId: taskId() })
    const reset = () => {
      if (!canOperate()) return
      const next = window.crypto.randomUUID()
      setTaskId(next)
      const current = vscode.getState<Record<string, unknown>>() ?? {}
      vscode.setState({ ...current, chipmateDeepSeekHarnessTaskId: next })
      if (active()) {
        const selected = snapshot().desiredSelection ?? snapshot().runningSelection ?? selectedModel()
        vscode.postMessage({
          type: "chipmateDeepSeekHarness.activate",
          taskId: next,
          preferredSelection: selected ? { providerID: selected.providerID, modelID: selected.modelID } : undefined,
        })
      }
    }
    window.addEventListener("newTaskRequest", reset)
    onCleanup(() => window.removeEventListener("newTaskRequest", reset))
  })

  const activate = (preferred?: ModelSelection | null) => {
    if (!surface.canMutate()) return
    setActive(true)
    requestedTaskId = taskId()
    vscode.postMessage({
      type: "chipmateDeepSeekHarness.activate",
      taskId: taskId(),
      preferredSelection:
        preferred?.providerID && preferred.modelID
          ? { providerID: preferred.providerID, modelID: preferred.modelID }
          : undefined,
    })
  }

  const run = async (action: () => Promise<void>): Promise<void> => {
    setOperationError(undefined)
    try {
      await action()
    } catch (error) {
      setOperationError(safeError(error))
    }
  }

  return (
    <DeepSeekHarnessContext.Provider
      value={{
        active,
        snapshot,
        conversation,
        operationError,
        pending: () => conversation()?.snapshot.pending ?? [],
        readyForInput,
        eligible,
        selectedModel,
        activate,
        deactivate: () => {
          if (!canOperate()) return
          setActive(false)
          vscode.postMessage({ type: "chipmateDeepSeekHarness.deactivate" })
        },
        send: (text, mode) =>
          run(async () => {
            if (!canOperate()) throw new Error("当前界面没有官方 DSH 客户端租约")
            const session = official.currentSession()
            if (!session) throw new Error("官方 ConversationSnapshot 尚未就绪")
            const result = await session.prompt([{ type: "text", text }], mode)
            if (!result.ok) throw new Error(result.error.message)
          }),
        cancel: () =>
          run(async () => {
            if (!canOperate()) throw new Error("当前界面没有官方 DSH 客户端租约")
            const session = official.currentSession()
            if (!session) throw new Error("官方 ConversationSnapshot 尚未就绪")
            const result = await session.cancel()
            if (!result.ok) throw new Error(result.error.message)
          }),
        selectModel: (model) =>
          run(async () => {
            if (!canOperate()) throw new Error("当前界面没有官方 DSH 客户端租约")
            vscode.postMessage({
              type: "chipmateDeepSeekHarness.selectionRequested",
              providerID: model.providerID,
              modelID: model.modelID,
            })
          }),
        selectReasoningEffort: (effort) =>
          run(async () => {
            if (!canOperate()) throw new Error("当前界面没有官方 DSH 客户端租约")
            await official.selectReasoningEffort(effort)
          }),
        post: (message) => {
          if (canOperate()) vscode.postMessage(message)
        },
      }}
    >
      {props.children}
    </DeepSeekHarnessContext.Provider>
  )
}

function sameSelection(desired: DeepSeekHarnessModel | undefined, running: DeepSeekHarnessModel | undefined): boolean {
  return Boolean(desired && running && desired.providerID === running.providerID && desired.modelID === running.modelID)
}

export function useDeepSeekHarness(): DeepSeekHarnessContextValue {
  const context = useContext(DeepSeekHarnessContext)
  if (!context) throw new Error("useDeepSeekHarness must be used within DeepSeekHarnessProvider")
  return context
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /(api[_-]?key|authorization)\s*[:=]\s*\S+/giu,
    "$1=[已脱敏]",
  )
}
