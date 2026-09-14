import { createSignal, onCleanup } from "solid-js"
import type { useVSCode } from "./vscode"
import type { TurnChangesSummary, TurnChangesDetail, TurnChangesResult } from "../../../src/shared/turn-changes"

export function pendingChanges(summary?: TurnChangesSummary) {
  return !!summary && ["running", "stopping", "settling"].includes(summary.phase)
}

// 状态属于会话轮次，虚拟行卸载或切换会话不会丢失审阅位置。
export function createTurnRecord(
  vscode: Pick<ReturnType<typeof useVSCode>, "postMessage" | "onMessage">,
  sessionID: string,
  messageID: string,
  availability = { active: true, connected: true },
) {
  const [summary, setSummary] = createSignal<TurnChangesSummary>()
  const [detail, setDetail] = createSignal<TurnChangesDetail>()
  const [selected, select] = createSignal<string>()
  const [expanded, expand] = createSignal(false)
  const [readError, setReadError] = createSignal<string>()
  const [fileError, setFileError] = createSignal<string>()
  const [mutationError, setMutationError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [reading, setReading] = createSignal(false)
  const [readingFile, setReadingFile] = createSignal(false)
  const [fresh, setFresh] = createSignal(false)
  const [enabled, setEnabled] = createSignal(availability.active && availability.connected)
  let disposed = false
  let request: string | undefined
  let fileRequest: { id: string; fileID: string; revision: number } | undefined
  let mutation: string | undefined
  let refresh = false
  const target = { sessionID, messageID }
  const available = () => !disposed && enabled()
  const loading = () => reading() || readingFile()
  const ready = () => available() && fresh() && !busy() && !loading()
  const error = () => mutationError() ?? readError() ?? fileError()

  const cancelFile = () => {
    fileRequest = undefined
    setReadingFile(false)
  }
  const cancelReads = () => {
    request = undefined
    setReading(false)
    cancelFile()
  }
  const readFile = () => {
    const fileID = selected()
    const value = summary()
    if (!available() || mutation || request || !expanded() || !fileID || !value || fileRequest) return
    if (detail()?.fileID === fileID && detail()?.revision === value.revision) return
    fileRequest = { id: crypto.randomUUID(), fileID, revision: value.revision }
    setReadingFile(true)
    vscode.postMessage({ type: "turnChangesRequest", ...target, requestID: fileRequest.id, fileID })
  }
  const load = (fileID?: string) => {
    if (disposed) return
    if (fileID) {
      if (selected() === fileID) readFile()
      return
    }
    setFresh(false)
    if (!available() || mutation || request) {
      refresh = true
      return
    }
    refresh = false
    request = crypto.randomUUID()
    setReading(true)
    vscode.postMessage({ type: "turnChangesRequest", ...target, requestID: request })
  }
  const setSelected = (fileID: string | undefined) => {
    if (disposed || selected() === fileID) return
    select(fileID)
    setDetail(undefined)
    setFileError(undefined)
    cancelFile()
    readFile()
  }
  const setExpanded = (value: boolean) => {
    if (disposed || expanded() === value) return
    expand(value)
    if (value) load()
    else cancelFile()
  }
  const applySummary = (value: TurnChangesSummary | undefined) => {
    if (
      value &&
      (value.sessionID !== sessionID || value.messageID !== messageID || value.revision < (summary()?.revision ?? 0))
    )
      return false
    setSummary(value)
    if (!value?.files.some((file) => file.id === selected())) setSelected(undefined)
    if (!value || detail()?.revision !== value.revision) {
      setDetail(undefined)
      if (!value || fileRequest?.revision !== value.revision) cancelFile()
    }
    return true
  }
  const receiveSummary = (result: TurnChangesResult) => {
    if (!result.ok) {
      setReadError(result.message ?? "修改记录读取失败")
      return
    }
    if (!applySummary(result.summary)) return
    setReadError(undefined)
    setFresh(!refresh && available())
  }
  const receiveFile = (fileID: string, result: TurnChangesResult) => {
    if (!result.ok) {
      setFileError(result.message ?? "文件差异读取失败")
      return
    }
    const value = result.detail
    if (value?.fileID !== fileID || fileID !== selected()) return
    if (value.revision !== summary()?.revision) {
      setFresh(false)
      if (value.revision > (summary()?.revision ?? 0)) load()
      return
    }
    setDetail(value)
    setFileError(undefined)
  }
  const unsubscribe = vscode.onMessage((message) => {
    if (disposed || (message.type !== "turnChangesResult" && message.type !== "turnChangesUpdated")) return
    if (message.sessionID !== sessionID || message.messageID !== messageID) return
    if (message.type === "turnChangesUpdated") {
      load()
      return
    }
    if (message.requestID === mutation) {
      mutation = undefined
      setBusy(false)
      setMutationError(message.result.ok ? undefined : (message.result.message ?? "操作未完成"))
      if (message.result.summary) applySummary(message.result.summary)
      // 操作结果只归还所属轮次；重新读取最新权限，不自动重放写入。
      load()
      return
    }
    if (message.requestID === request) {
      request = undefined
      setReading(false)
      receiveSummary(message.result)
      if (refresh) load()
      else if (message.result.ok) readFile()
      return
    }
    if (message.requestID !== fileRequest?.id) return
    const fileID = fileRequest.fileID
    cancelFile()
    receiveFile(fileID, message.result)
  })
  const setAvailability = (nextActive: boolean, nextConnected: boolean) => {
    const previous = available()
    setEnabled(nextActive && nextConnected)
    if (!available()) {
      cancelReads()
      setFresh(false)
      refresh = true
      if (!nextConnected && mutation) {
        mutation = undefined
        setBusy(false)
        setMutationError("连接已断开，操作结果待核对；连接恢复后将自动刷新记录")
      }
      return
    }
    if (!previous) load()
  }
  const mutate = (action: "revert" | "restore", fileID?: string, hunkID?: string) => {
    const value = summary()
    if (!value || !ready() || (action === "revert" ? !value.canRevert : !value.canRestore)) return
    mutation = crypto.randomUUID()
    setBusy(true)
    setFresh(false)
    setMutationError(undefined)
    cancelReads()
    vscode.postMessage({
      type: "turnChangesMutate",
      ...target,
      requestID: mutation,
      revision: value.revision,
      action,
      fileID,
      hunkID,
    })
  }
  onCleanup(() => {
    disposed = true
    unsubscribe()
    cancelReads()
    mutation = undefined
    refresh = false
    setBusy(false)
    setFresh(false)
  })
  load()
  return {
    summary,
    detail,
    selected,
    setSelected,
    expanded,
    setExpanded,
    error,
    busy,
    loading,
    ready,
    load,
    mutate,
    setAvailability,
  }
}
