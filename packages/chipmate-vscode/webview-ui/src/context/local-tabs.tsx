import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type ParentComponent,
  useContext,
} from "solid-js"
import { useServer } from "./server"
import { useSession } from "./session"
import { useVSCode } from "./vscode"
import {
  PENDING_TAB_PREFIX,
  addPendingTab,
  addSessionTab,
  closeOtherTabs,
  closeTab,
  insertSessionTabAfter,
  isPendingTab,
  openSessionTab,
  reconcileTabs,
  restoreTabs,
  tabsForCreatedSession,
  type LocalTabState,
} from "../utils/local-tabs"
import {
  deletePendingDraft,
  discardPendingDraft,
  isPendingSend,
  promotePendingDraftDiscard,
} from "../utils/draft-store"
import { moveTab, reorderTabs } from "../utils/tab-order"
import { useSessionSurface } from "./session-surface"
import { sameSessionSurfaceKey, type SessionSurfaceKey } from "../../../src/shared/session-surface"
import { showToast } from "@chipmate/chipmate-ui/toast"

interface LocalTabsState extends Record<string, unknown> {
  sidebarSessionTabIDs?: string[]
  sidebarActiveSessionTabID?: string
}

interface LocalTabsValue {
  ids: Accessor<string[]>
  active: Accessor<string | undefined>
  pending: Accessor<string | undefined>
  add: () => Promise<string | undefined>
  open: (id: string) => Promise<boolean>
  openAfter: (source: string, id: string) => Promise<boolean>
  select: (id: string) => Promise<boolean>
  close: (id: string) => Promise<boolean>
  closeOthers: (id: string) => Promise<boolean>
  previewCloud: (id: string) => void
  reorder: (from: string, to: string) => boolean
  move: (id: string, offset: -1 | 1) => number | undefined
  persist: () => void
}

const LocalTabsContext = createContext<LocalTabsValue>()

const same = (left: string[], right: string[]) => left.length === right.length && left.every((id, i) => right[i] === id)

export const LocalTabsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const session = useSession()
  const surface = useSessionSurface()
  const saved = vscode.getState<LocalTabsState>()
  const pending = () => `${PENDING_TAB_PREFIX}${crypto.randomUUID()}`
  const init = restoreTabs(saved?.sidebarSessionTabIDs, saved?.sidebarActiveSessionTabID, pending)
  const [ids, setIds] = createSignal(init.ids)
  const [active, setActive] = createSignal(init.active)
  const [cloud, setCloud] = createSignal<string>()
  const fresh = new Set<string>()
  const current = (): LocalTabState => ({ ids: ids(), active: active() })
  const apply = (next: LocalTabState) => {
    if (!same(ids(), next.ids)) setIds(next.ids)
    if (active() !== next.active) setActive(next.active)
  }
  const surfaceKey = (id: string | undefined): SessionSurfaceKey | undefined => {
    if (!id) return
    const pinned = surface.pinnedKey()
    if (surface.kind() === "main-editor" && pinned?.id === id) return pinned
    const bound = surface.activeKey()
    if (bound?.id === id) return bound
    if (isPendingTab(id)) return { kind: "draft", id }
    return { kind: "session", id }
  }
  const bindSurface = (id: string | undefined) => {
    const key = surfaceKey(id)
    if (!key || sameSessionSurfaceKey(surface.activeKey(), key)) return key
    surface.setActive(key)
    return key
  }
  const isDraftTab = (id: string) => surfaceKey(id)?.kind === "draft"
  const focusDirect = (id: string | undefined) => {
    setCloud(undefined)
    const key = surfaceKey(id)
    if (!key) {
      session.clearCurrentSession()
      return
    }
    const pinned = surface.pinnedKey()
    if (surface.kind() === "main-editor" && pinned && !sameSessionSurfaceKey(pinned, key)) {
      vscode.postMessage({ type: "sessionSurface.openMain", key })
      return
    }
    bindSurface(id)
    if (key.kind === "draft") {
      session.clearCurrentSession()
      return
    }
    session.selectSession(key.id)
  }
  const focusBound = (id: string | undefined) => {
    setCloud(undefined)
    const key = surfaceKey(id)
    if (!key || key.kind === "draft") {
      session.clearCurrentSession()
      return
    }
    session.selectSession(key.id)
  }
  let transitionQueue = Promise.resolve()
  const enqueue = <Result,>(operation: () => Promise<Result>) => {
    const result = transitionQueue.catch(() => undefined).then(operation)
    transitionQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  const real = createMemo(() => ids().filter((id) => !isDraftTab(id)))
  const activePending = createMemo(() => {
    const id = active()
    return id && isDraftTab(id) ? id : undefined
  })

  const select = (id: string) =>
    enqueue(async () => (ids().includes(id) ? transitionNow({ ...current(), active: id }) : false))

  const transitionNow = async (next: LocalTabState) => {
    const key = surfaceKey(next.active)
    if (!key) {
      apply(next)
      focusBound(next.active)
      return true
    }
    const pinned = surface.pinnedKey()
    if (surface.kind() === "main-editor" && pinned && !sameSessionSurfaceKey(pinned, key)) {
      vscode.postMessage({ type: "sessionSurface.openMain", key })
      return true
    }
    try {
      await surface.switchActive(key)
    } catch (error) {
      showToast({
        variant: "error",
        title: "草稿保存失败，未切换会话",
        description: error instanceof Error ? error.message : "当前输入已保留，请重试",
      })
      window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { preserveCollapsed: true } }))
      return false
    }
    apply(next)
    focusBound(next.active)
    return true
  }

  const transition = (next: () => LocalTabState) => enqueue(() => transitionNow(next()))

  const open = (id: string) => transition(() => openSessionTab(current(), id))

  const openAfter = (source: string, id: string) =>
    transition(() => insertSessionTabAfter(current(), source, id)).then((switched) => {
      if (switched) persist()
      return switched
    })

  const add = async () => {
    const id = pending()
    return (await transition(() => addPendingTab(current(), id))) ? id : undefined
  }

  const close = (id: string) =>
    enqueue(async () => {
      const before = active()
      const wasDraft = isDraftTab(id)
      const next = closeTab(current(), id, pending)
      const switchRequired = before === id || before !== next.active
      const switched = switchRequired
        ? wasDraft
          ? (apply(next), focusDirect(next.active), true)
          : await transitionNow(next)
        : (apply(next), true)
      if (!switched) return false
      if (isDraftTab(id)) {
        if (session.isSubmitting(id) || isPendingSend(id)) discardPendingDraft(id)
        queueMicrotask(() => deletePendingDraft(id))
      }
      return true
    })

  const closeOthers = (id: string) =>
    enqueue(async () => {
      const before = active()
      const removed = ids().filter((tab) => tab !== id && isDraftTab(tab))
      const next = closeOtherTabs(current(), id)
      const discardedCurrent = before !== id && before !== undefined && isDraftTab(before)
      const switched =
        before === next.active
          ? (apply(next), true)
          : discardedCurrent
            ? (apply(next), focusDirect(next.active), true)
            : await transitionNow(next)
      if (!switched) return false
      for (const pending of removed) {
        if (session.isSubmitting(pending) || isPendingSend(pending)) discardPendingDraft(pending)
      }
      queueMicrotask(() => removed.forEach(deletePendingDraft))
      return true
    })
  const previewCloud = (id: string) => setCloud(id)
  const reorder = (from: string, to: string) => {
    const next = reorderTabs(ids(), from, to)
    if (!next) return false
    setIds(next)
    return true
  }
  const move = (id: string, offset: -1 | 1) => {
    const next = moveTab(ids(), id, offset)
    if (!next) return undefined
    setIds(next)
    return next.indexOf(id)
  }

  let restored = false
  createEffect(() => {
    if (restored || !server.isConnected()) return
    restored = true
    if (real().length > 0) session.loadSessions()
    const id = active()
    if (id && !isDraftTab(id)) session.selectSession(id)
  })

  let surfaceBound = false
  createEffect(() => {
    if (surfaceBound || !surface.id() || surface.kind() !== "sidebar") return
    const id = active()
    if (!id) return
    surfaceBound = true
    bindSurface(id)
  })

  createEffect(() => {
    const key = surface.pinnedKey()
    if (!key || surface.kind() !== "main-editor") return
    apply({ ids: [key.id], active: key.id })
    focusDirect(key.id)
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const persist = () => {
    const tabs = real()
    const tab = active()
    const selected = tab && !isDraftTab(tab) ? tab : undefined
    const prev = vscode.getState<LocalTabsState>() ?? {}
    vscode.setState({ ...prev, sidebarSessionTabIDs: tabs, sidebarActiveSessionTabID: selected })
  }
  createEffect(() => {
    real()
    active()
    clearTimeout(timer)
    timer = setTimeout(persist, 300)
  })
  onCleanup(() => clearTimeout(timer))

  createEffect(() => {
    vscode.postMessage({ type: "sidebar.openSessions", sessionIDs: real() })
  })

  onMount(() => {
    const cleanup = vscode.onMessage((message) => {
      if (message.type === "openCloudSession") {
        setCloud(message.sessionId)
        return
      }
      if (message.type === "sessionSurface.select") {
        const key = message.key
        if (key.kind === "session") {
          apply(openSessionTab(current(), key.id))
          focusDirect(key.id)
          return
        }
        if (!ids().includes(key.id)) apply(addPendingTab(current(), key.id))
        setActive(key.id)
        focusDirect(key.id)
        return
      }
      if (message.type === "sessionCreated") {
        if (message.draftID && promotePendingDraftDiscard(message.draftID, message.session.id)) return
        const next = tabsForCreatedSession(current(), message.session.id, message.draftID, message.activate, isDraftTab)
        if (!next) return
        fresh.add(message.session.id)
        apply(next)
        focusDirect(next.active)
        return
      }
      if (message.type === "cloudSessionImported") {
        const activate = cloud() === message.cloudSessionId
        fresh.add(message.session.id)
        apply(activate ? openSessionTab(current(), message.session.id) : addSessionTab(current(), message.session.id))
        if (activate) setCloud(undefined)
        return
      }
      if (message.type === "sessionsLoaded") {
        const pinned = surface.pinnedKey()
        if (surface.kind() === "main-editor" && pinned) {
          apply({ ids: [pinned.id], active: pinned.id })
          focusBound(pinned.id)
          return
        }
        const before = active()
        const listed = message.sessions.map((item) => item.id)
        for (const id of listed) fresh.delete(id)
        const next = reconcileTabs(
          current(),
          [...listed, ...(message.preserveSessionIds ?? []), ...fresh],
          pending,
          isDraftTab,
        )
        apply(next)
        if (before !== next.active) focusDirect(next.active)
        return
      }
      if (message.type === "sessionDeleted") {
        fresh.delete(message.sessionID)
        const before = active()
        const next = closeTab(current(), message.sessionID, pending)
        apply(next)
        if (before !== next.active) focusDirect(next.active)
      }
    })
    onCleanup(cleanup)
  })

  return (
    <LocalTabsContext.Provider
      value={{
        ids,
        active,
        pending: activePending,
        add,
        open,
        openAfter,
        select,
        close,
        closeOthers,
        previewCloud,
        reorder,
        move,
        persist,
      }}
    >
      {props.children}
    </LocalTabsContext.Provider>
  )
}

export function useLocalTabs(): LocalTabsValue | undefined {
  return useContext(LocalTabsContext)
}
