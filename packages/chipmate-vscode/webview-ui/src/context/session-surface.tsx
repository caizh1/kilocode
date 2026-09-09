import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js"
import type {
  ChatSurfaceKind,
  MainEditorPanelStateV1,
  SessionSurfaceDraft,
  SessionSurfaceDraftContent,
  SessionSurfaceKey,
  SessionSurfaceState,
} from "../../../src/shared/session-surface"
import { sameSessionSurfaceKey, sessionSurfaceKey } from "../../../src/shared/session-surface"
import { useVSCode } from "./vscode"

type SessionSurfaceContextValue = {
  id: Accessor<string | undefined>
  kind: Accessor<ChatSurfaceKind>
  pinnedKey: Accessor<SessionSurfaceKey | undefined>
  activeKey: Accessor<SessionSurfaceKey | undefined>
  state: Accessor<SessionSurfaceState | undefined>
  draft: Accessor<SessionSurfaceDraft | undefined>
  canMutate: Accessor<boolean>
  hasDshLease: Accessor<boolean>
  setActive: (key: SessionSurfaceKey) => void
  switchActive: (key: SessionSurfaceKey) => Promise<void>
  stageDraft: (content: SessionSurfaceDraftContent) => void
  updateDraft: (content: SessionSurfaceDraftContent) => number
  commitDraft: (content: SessionSurfaceDraftContent) => Promise<{ key: SessionSurfaceKey; revision: number }>
  flushDraft: () => Promise<{ key: SessionSurfaceKey; clientSeq: number; revision: number }>
  openMain: () => void
  returnToSidebar: () => void
  focusOwner: () => void
}

const SessionSurfaceContext = createContext<SessionSurfaceContextValue>()

export const SessionSurfaceProvider: ParentComponent<{ unmanaged?: boolean; ackTimeoutMs?: number }> = (props) => {
  const vscode = useVSCode()
  const [id, setId] = createSignal<string>()
  const [kind, setKind] = createSignal<ChatSurfaceKind>("sidebar")
  const [pinnedKey, setPinnedKey] = createSignal<SessionSurfaceKey>()
  const [activeKey, setActiveKey] = createSignal<SessionSurfaceKey>()
  const [state, setState] = createSignal<SessionSurfaceState>()
  const [draft, setDraft] = createSignal<SessionSurfaceDraft>()
  let clientSeq = vscode.getState<{ sessionSurfaceClientSeq?: number }>()?.sessionSurfaceClientSeq ?? 0
  type PendingAck = {
    key: SessionSurfaceKey
    timeout: ReturnType<typeof setTimeout>
    resolve: (value: { key: SessionSurfaceKey; clientSeq: number; revision: number }) => void
    reject: (reason: Error) => void
  }
  type StagedDraft = {
    content: SessionSurfaceDraftContent
    serialized: string
    sentContent?: string
    sentSeq: number
    ackedSeq: number
    revision: number
  }
  const stagedDrafts = new Map<string, StagedDraft>()
  const terminalSequences = new Map<number, { key: SessionSurfaceKey; status: "acked" | "rejected" }>()
  const pendingAcks = new Map<number, Set<PendingAck>>()

  const rememberTerminal = (sequence: number, key: SessionSurfaceKey, status: "acked" | "rejected") => {
    terminalSequences.set(sequence, { key, status })
    if (terminalSequences.size <= 256) return
    const oldest = terminalSequences.keys().next().value
    if (oldest !== undefined) terminalSequences.delete(oldest)
  }

  const rejectPendingAcks = (message: string, key?: SessionSurfaceKey, sequence?: number) => {
    for (const [clientSequence, pending] of pendingAcks) {
      if (sequence !== undefined && clientSequence !== sequence) continue
      for (const waiter of pending) {
        if (key && !sameSessionSurfaceKey(key, waiter.key)) continue
        clearTimeout(waiter.timeout)
        waiter.reject(new Error(message))
        pending.delete(waiter)
      }
      if (pending.size === 0) pendingAcks.delete(clientSequence)
    }
  }

  const resolvePendingAcks = (key: SessionSurfaceKey, sequence: number, revision: number) => {
    const pending = pendingAcks.get(sequence)
    if (!pending) return
    for (const waiter of pending) {
      if (!sameSessionSurfaceKey(key, waiter.key)) continue
      clearTimeout(waiter.timeout)
      waiter.resolve({ key, clientSeq: sequence, revision })
      pending.delete(waiter)
    }
    if (pending.size === 0) pendingAcks.delete(sequence)
  }

  const waitForAck = (key: SessionSurfaceKey, sequence: number, timeoutMessage: string) =>
    new Promise<{ key: SessionSurfaceKey; clientSeq: number; revision: number }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = pendingAcks.get(sequence)
        if (pending) {
          for (const waiter of pending) {
            if (waiter.resolve !== resolve) continue
            pending.delete(waiter)
            break
          }
          if (pending.size === 0) pendingAcks.delete(sequence)
        }
        reject(new Error(timeoutMessage))
      }, props.ackTimeoutMs ?? 5000)
      const waiter: PendingAck = { key, timeout, resolve, reject }
      const pending = pendingAcks.get(sequence) ?? new Set<PendingAck>()
      pending.add(waiter)
      pendingAcks.set(sequence, pending)
    })

  const applyState = (next: SessionSurfaceState) => {
    const key = activeKey()
    if (key && !sameSessionSurfaceKey(key, next.key)) return false
    batch(() => {
      if (!key) setActiveKey(next.key)
      setState(next)
    })
    vscode.setSessionSurfaceCredential(next.token ? { key: next.key, token: next.token } : undefined)
    persistPanelState()
    return true
  }

  const clearBinding = () => {
    rejectPendingAcks("会话所有权已切换")
    vscode.setSessionSurfaceCredential(undefined)
    setState(undefined)
    setDraft(undefined)
  }

  const persistPanelState = () => {
    if (kind() !== "main-editor") return
    const key = activeKey() ?? pinnedKey()
    if (!key) return
    const current = vscode.getState<Record<string, unknown>>() ?? {}
    const value: MainEditorPanelStateV1 = {
      sessionSurfaceVersion: 1,
      key,
      directory: state()?.directory,
      mode: state()?.mode ?? "qa",
      taskId: state()?.taskId,
      title: state()?.title,
      draftRevision: draft()?.revision ?? state()?.draftRevision ?? 0,
    }
    vscode.setState({ ...current, ...value })
  }

  type ExtensionMessage = Parameters<Parameters<typeof vscode.onMessage>[0]>[0]
  const applyDraftSnapshot = (next: SessionSurfaceDraft) => {
    if (activeKey() && !sameSessionSurfaceKey(activeKey(), next.key)) return
    const id = sessionSurfaceKey(next.key)
    const staged = stagedDrafts.get(id)
    const current = draft()
    const revision = Math.max(staged?.revision ?? 0, current?.revision ?? 0)
    if (next.revision < revision) return
    if (staged && (staged.ackedSeq < staged.sentSeq || staged.serialized !== staged.sentContent)) {
      staged.revision = Math.max(staged.revision, next.revision)
      setDraft({ ...next, content: staged.content })
      persistPanelState()
      return
    }
    const serialized = JSON.stringify(next.content)
    stagedDrafts.set(id, {
      content: next.content,
      serialized,
      sentContent: serialized,
      sentSeq: staged?.sentSeq ?? 0,
      ackedSeq: staged?.sentSeq ?? 0,
      revision: next.revision,
    })
    setDraft(next)
    persistPanelState()
  }

  const applyDraftRejection = (message: Extract<ExtensionMessage, { type: "sessionSurface.draft.rejected" }>) => {
    const terminal = terminalSequences.get(message.clientSeq)
    if (terminal?.status === "acked" && sameSessionSurfaceKey(terminal.key, message.key)) return
    rememberTerminal(message.clientSeq, message.key, "rejected")
    const staged = stagedDrafts.get(sessionSurfaceKey(message.key))
    if (staged?.sentSeq === message.clientSeq) staged.sentContent = undefined
    rejectPendingAcks("草稿提交被拒绝，请重试", message.key, message.clientSeq)
    if (sameSessionSurfaceKey(activeKey(), message.key)) applyState(message.state)
  }

  const applyDraftAck = (message: Extract<ExtensionMessage, { type: "sessionSurface.draft.ack" }>) => {
    const terminal = terminalSequences.get(message.clientSeq)
    if (terminal?.status === "rejected" && sameSessionSurfaceKey(terminal.key, message.key)) return
    rememberTerminal(message.clientSeq, message.key, "acked")
    const current = vscode.getState<Record<string, unknown>>() ?? {}
    vscode.setState({ ...current, sessionSurfaceClientSeq: Math.max(clientSeq, message.clientSeq) })
    const staged = stagedDrafts.get(sessionSurfaceKey(message.key))
    if (staged) {
      staged.ackedSeq = Math.max(staged.ackedSeq, message.clientSeq)
      staged.revision = Math.max(staged.revision, message.revision)
    }
    if (sameSessionSurfaceKey(activeKey(), message.key)) {
      const currentDraft = draft()
      if (currentDraft && currentDraft.revision < message.revision) {
        setDraft({ ...currentDraft, revision: message.revision, content: staged?.content ?? currentDraft.content })
      }
      persistPanelState()
    }
    resolvePendingAcks(message.key, message.clientSeq, message.revision)
  }

  const handleDraftMessage = (message: ExtensionMessage) => {
    if (message.type === "sessionSurface.draft.snapshot") {
      applyDraftSnapshot(message.draft)
      return true
    }
    if (message.type === "sessionSurface.draft.flushRequested") {
      const key = activeKey()
      if (key && !sameSessionSurfaceKey(key, message.key)) {
        vscode.postMessage({ type: "sessionSurface.draft.flushFailed", key: message.key })
        return true
      }
      void flushDraft().catch(() => {
        vscode.postMessage({ type: "sessionSurface.draft.flushFailed", key: message.key })
      })
      return true
    }
    if (message.type === "sessionSurface.draft.rejected") {
      applyDraftRejection(message)
      return true
    }
    if (message.type !== "sessionSurface.draft.ack") return false
    applyDraftAck(message)
    return true
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "sessionSurface.bootstrap") {
      clearBinding()
      batch(() => {
        setKind(message.kind)
        setPinnedKey(message.pinnedKey)
        if (message.pinnedKey) setActiveKey(message.pinnedKey)
        setId(message.surfaceId)
      })
      persistPanelState()
      return
    }
    if (message.type === "sessionSurface.state") {
      applyState(message.state)
      return
    }
    if (handleDraftMessage(message)) return
    if (message.type === "sessionSurface.mutationRejected") {
      if (!sameSessionSurfaceKey(activeKey(), message.key)) return
      applyState(message.state)
      return
    }
    if (message.type === "sessionSurface.select") {
      if (kind() === "main-editor") setPinnedKey(message.key)
      setActive(message.key)
    }
  })
  onCleanup(() => {
    rejectPendingAcks("会话界面已关闭")
    vscode.setSessionSurfaceCredential(undefined)
    unsubscribe()
  })

  const setActive = (key: SessionSurfaceKey) => {
    if (kind() === "main-editor" && pinnedKey() && !sameSessionSurfaceKey(pinnedKey(), key)) return
    clearBinding()
    setActiveKey(key)
    vscode.postMessage({ type: "sessionSurface.active", key })
    persistPanelState()
  }

  let switchQueue = Promise.resolve()
  const switchActive = (key: SessionSurfaceKey) => {
    const next = switchQueue
      .catch(() => undefined)
      .then(async () => {
        if (sameSessionSurfaceKey(activeKey(), key)) return
        if (activeKey()) await flushDraft()
        setActive(key)
      })
    switchQueue = next.catch(() => undefined)
    return next
  }

  let readySignature = ""
  createEffect(() => {
    const key = kind() === "main-editor" ? pinnedKey() : activeKey()
    if (!key) return
    const ownershipEpoch = state()?.token?.epoch
    const signature = `${key.kind}:${key.id}:${draft()?.revision ?? 0}:${ownershipEpoch ?? "mirror"}`
    if (signature === readySignature) return
    readySignature = signature
    vscode.postMessage({ type: "sessionSurface.ready", key, draftRevision: draft()?.revision ?? 0, ownershipEpoch })
  })

  const stageDraft = (content: SessionSurfaceDraftContent) => {
    const key = activeKey()
    if (!key) return
    const id = sessionSurfaceKey(key)
    const previous = stagedDrafts.get(id)
    stagedDrafts.set(id, {
      content,
      serialized: JSON.stringify(content),
      sentContent: previous?.sentContent,
      sentSeq: previous?.sentSeq ?? 0,
      ackedSeq: previous?.ackedSeq ?? 0,
      revision: Math.max(previous?.revision ?? 0, draft()?.revision ?? 0),
    })
  }

  const updateDraft = (content: SessionSurfaceDraftContent) => {
    stageDraft(content)
    const key = activeKey()
    const token = state()?.token
    if (!key || !token) return clientSeq
    clientSeq++
    const staged = stagedDrafts.get(sessionSurfaceKey(key))
    if (staged) {
      staged.sentSeq = clientSeq
      staged.sentContent = staged.serialized
    }
    vscode.postMessage({ type: "sessionSurface.draft.update", key, clientSeq, token, content })
    return clientSeq
  }

  const commitDraft = (content: SessionSurfaceDraftContent) => {
    const key = activeKey()
    if (props.unmanaged && key) return Promise.resolve({ key, revision: draft()?.revision ?? 0 })
    const current = state()
    if (!key || !current?.token || !sameSessionSurfaceKey(key, current.key)) {
      return Promise.reject(new Error("当前会话尚未取得写入权限"))
    }
    const sequence = updateDraft(content)
    return waitForAck(key, sequence, "草稿提交超时，请重试").then(({ key: committedKey, revision }) => ({
      key: committedKey,
      revision,
    }))
  }

  const flushDraft = () => {
    const key = activeKey()
    if (props.unmanaged && key) {
      return Promise.resolve({ key, clientSeq, revision: draft()?.revision ?? 0 })
    }
    const current = state()
    if (!key || !current?.token || !sameSessionSurfaceKey(key, current.key)) {
      return Promise.reject(new Error("当前会话尚未取得写入权限"))
    }
    const staged = stagedDrafts.get(sessionSurfaceKey(key))
    const sequence =
      staged && staged.serialized !== staged.sentContent ? updateDraft(staged.content) : (staged?.sentSeq ?? 0)
    const pending = waitForAck(key, sequence, "草稿保存超时，已保留当前输入")
    vscode.postMessage({ type: "sessionSurface.draft.flush", key, clientSeq: sequence, token: current.token })
    return pending
  }

  const canMutate = createMemo(() => {
    if (props.unmanaged) return true
    const current = state()
    if (!current?.token || current.phase === "deleted") return false
    if (!sameSessionSurfaceKey(activeKey(), current.key)) return false
    return current.phase === "sidebar" || current.phase === "main"
  })

  const value: SessionSurfaceContextValue = {
    id,
    kind,
    pinnedKey,
    activeKey,
    state,
    draft,
    canMutate,
    hasDshLease: () => props.unmanaged === true || state()?.dshLease === true,
    setActive,
    switchActive,
    stageDraft,
    updateDraft,
    commitDraft,
    flushDraft,
    openMain: () => {
      const key = activeKey()
      if (key) vscode.postMessage({ type: "sessionSurface.openMain", key })
    },
    returnToSidebar: () => {
      const key = activeKey()
      if (key) vscode.postMessage({ type: "sessionSurface.returnToSidebar", key })
    },
    focusOwner: () => {
      const key = activeKey()
      if (key) vscode.postMessage({ type: "sessionSurface.focusOwner", key })
    },
  }

  return <SessionSurfaceContext.Provider value={value}>{props.children}</SessionSurfaceContext.Provider>
}

export function useSessionSurface(): SessionSurfaceContextValue {
  const context = useContext(SessionSurfaceContext)
  if (!context) throw new Error("useSessionSurface must be used within a SessionSurfaceProvider")
  return context
}
