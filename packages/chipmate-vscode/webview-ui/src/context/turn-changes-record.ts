import { createSignal, onCleanup } from "solid-js"
import type { useVSCode } from "./vscode"
import type { TurnChangesSummary, TurnChangesDetail, TurnChangesResult } from "../../../src/shared/turn-changes"

export function pendingChanges(summary?: TurnChangesSummary) {
  return !!summary && ["running", "stopping", "settling"].includes(summary.phase)
}

// 每个会话轮次只创建一份订阅；收起视图不影响记录更新。
export function createTurnRecord(
  vscode: Pick<ReturnType<typeof useVSCode>, "postMessage" | "onMessage">,
  sessionID: string,
  messageID: string,
) {
  const [summary, setSummary] = createSignal<TurnChangesSummary>()
  const [detail, setDetail] = createSignal<TurnChangesDetail>()
  const [selected, setSelected] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  let request: string | undefined
  let mutation: string | undefined
  let refresh = false
  const target = () => ({ sessionID, messageID })
  const load = (fileID?: string) => {
    if (mutation) {
      refresh = true
      return
    }
    request = crypto.randomUUID()
    setLoading(true)
    vscode.postMessage({ type: "turnChangesRequest", ...target(), requestID: request, fileID })
  }
  const apply = (result: TurnChangesResult, changed: boolean) => {
    if (!result.ok) setError(result.message ?? "操作未完成")
    const value = result.summary
    if (value && value.sessionID === sessionID && value.messageID === messageID) {
      if (value.revision >= (summary()?.revision ?? 0)) setSummary(value)
      if (changed) {
        setDetail(undefined)
        setSelected(undefined)
      } else if (selected() && detail()?.revision !== value.revision) load(selected())
    }
    if (result.detail && result.detail.fileID === selected() && result.detail.revision >= (summary()?.revision ?? 0))
      setDetail(result.detail)
  }
  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "turnChangesResult" && message.type !== "turnChangesUpdated") return
    if (message.sessionID !== sessionID || message.messageID !== messageID) return
    if (message.type === "turnChangesUpdated") {
      load()
      return
    }
    if (message.requestID !== request && message.requestID !== mutation) return
    const changed = message.requestID === mutation
    if (changed) {
      mutation = undefined
      setBusy(false)
    }
    setLoading(false)
    apply(message.result, changed)
    if (changed && refresh) {
      refresh = false
      load()
    }
  })
  onCleanup(unsubscribe)
  const mutate = (action: "revert" | "restore", fileID?: string, hunkID?: string) => {
    const value = summary()
    if (!value || busy()) return
    mutation = crypto.randomUUID()
    setBusy(true)
    setError(undefined)
    vscode.postMessage({
      type: "turnChangesMutate",
      ...target(),
      requestID: mutation,
      revision: Number(value.revision),
      action,
      fileID,
      hunkID,
    })
  }
  load()
  return { summary, detail, selected, setSelected, setDetail, error, setError, busy, loading, load, mutate }
}
