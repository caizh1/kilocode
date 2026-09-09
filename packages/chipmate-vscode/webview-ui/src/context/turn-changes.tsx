import {
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  untrack,
  useContext,
  type ParentComponent,
} from "solid-js"
import { useVSCode } from "./vscode"
import { useSession } from "./session"
import { activeUserMessageID, messageTurns } from "./session-queue"

import { createTurnRecord } from "./turn-changes-record"
export { pendingChanges } from "./turn-changes-record"

type RecordState = ReturnType<typeof createTurnRecord>
const Context = createContext<{
  record: (sessionID: string, messageID: string) => RecordState
  active: () => { sessionID: string; messageID: string } | undefined
  running: (sessionID: string, messageID: string) => boolean
}>()

export const TurnChangesProvider: ParentComponent<{ enabled?: boolean }> = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const records = new Map<string, RecordState>()
  const disposals: (() => void)[] = []
  const record = (sessionID: string, messageID: string) => {
    const key = `${sessionID}:${messageID}`
    const existing = records.get(key)
    if (existing) return existing
    const value = createRoot((dispose) => {
      disposals.push(dispose)
      return createTurnRecord(vscode, sessionID, messageID)
    })
    records.set(key, value)
    return value
  }
  onCleanup(() => disposals.forEach((dispose) => dispose()))
  const executing = createMemo(() =>
    activeUserMessageID(session.messages(), session.statusInfo(), (msg) => session.getParts(msg.id)),
  )
  const [held, setHeld] = createSignal<{ sessionID: string; messageID: string }>()
  createEffect(() => {
    const sessionID = props.enabled === false ? undefined : session.currentSessionID()
    const id = executing()
    const previous = untrack(held)
    if (!sessionID) {
      setHeld(undefined)
      return
    }
    if (id) {
      setHeld({ sessionID, messageID: id })
      return
    }
    if (previous?.sessionID === sessionID) return
    const latest = messageTurns(session.messages(), session.revert() ?? undefined, (msg) =>
      session.getParts(msg.id),
    ).findLast((turn) => turn.assistant.length)
    setHeld(latest ? { sessionID, messageID: latest.user.id } : undefined)
  })
  const active = createMemo(() => {
    const target = held()
    return target?.sessionID === session.currentSessionID() ? target : undefined
  })
  createEffect(() => {
    if (props.enabled === false) return
    const target = active()
    session.status()
    const sessionID = session.currentSessionID()
    untrack(() => {
      if (target) record(target.sessionID, target.messageID)
      for (const [key, value] of records) if (sessionID && key.startsWith(`${sessionID}:`)) value.load()
    })
  })
  // 更新时不推断当前轮归属，防止历史撤销事件抢占输入框控件。
  const running = (sessionID: string, messageID: string) =>
    sessionID === session.currentSessionID() && executing() === messageID && session.status() !== "idle"
  return <Context.Provider value={{ record, active, running }}>{props.children}</Context.Provider>
}

export function useTurnChanges() {
  const value = useContext(Context)
  if (!value) throw new Error("本轮修改上下文未初始化")
  return value
}
