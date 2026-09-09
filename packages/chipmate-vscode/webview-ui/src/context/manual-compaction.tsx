import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js"
import { ManualCompactionDialog } from "../components/chat/ManualCompactionDialog"
import { useDeepSeekHarness } from "./deepseek-harness"
import { useServer } from "./server"
import { useSession } from "./session"
import { useSessionSurface } from "./session-surface"

interface ManualCompactionContextValue {
  available: Accessor<boolean>
  request: () => void
}

const unavailable: ManualCompactionContextValue = {
  available: () => false,
  request: () => undefined,
}

const ManualCompactionContext = createContext<ManualCompactionContextValue>(unavailable)

export const ManualCompactionProvider: ParentComponent = (props) => {
  const session = useSession()
  const server = useServer()
  const surface = useSessionSurface()
  const deepSeekHarness = useDeepSeekHarness()
  const [target, setTarget] = createSignal<string>()
  const [acknowledged, setAcknowledged] = createSignal(false)
  let restoreTarget: HTMLElement | undefined
  let restoreFrame = 0

  const eligible = (sessionID: string | undefined) =>
    !!sessionID &&
    server.isConnected() &&
    surface.canMutate() &&
    !deepSeekHarness.active() &&
    session.status() === "idle" &&
    session.visibleMessages().length > 0 &&
    !!session.selected(sessionID)

  const available = createMemo(() => eligible(session.currentSessionID()))

  const restoreFocus = () => {
    const element = restoreTarget
    restoreTarget = undefined
    if (!element?.isConnected) return
    if (restoreFrame) cancelAnimationFrame(restoreFrame)
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = 0
      element.focus()
    })
  }

  const close = () => {
    if (!target()) return
    setTarget(undefined)
    setAcknowledged(false)
    restoreFocus()
  }

  const request = () => {
    const sessionID = session.currentSessionID()
    if (target() || !eligible(sessionID)) return
    restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    setAcknowledged(false)
    setTarget(sessionID)
  }

  const confirm = () => {
    const sessionID = target()
    if (!sessionID || !acknowledged()) return
    const valid = session.currentSessionID() === sessionID && eligible(sessionID)
    setTarget(undefined)
    setAcknowledged(false)
    restoreFocus()
    if (valid) session.compact()
  }

  createEffect(() => {
    const sessionID = target()
    if (!sessionID) return
    if (session.currentSessionID() === sessionID && eligible(sessionID)) return
    close()
  })

  onCleanup(() => {
    if (restoreFrame) cancelAnimationFrame(restoreFrame)
  })

  return (
    <ManualCompactionContext.Provider value={{ available, request }}>
      {props.children}
      <ManualCompactionDialog
        open={!!target()}
        acknowledged={acknowledged()}
        onAcknowledgedChange={setAcknowledged}
        onCancel={close}
        onConfirm={confirm}
      />
    </ManualCompactionContext.Provider>
  )
}

export const useManualCompaction = () => useContext(ManualCompactionContext)
