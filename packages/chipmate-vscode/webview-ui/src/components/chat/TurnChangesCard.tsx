import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { Button } from "@chipmate/chipmate-ui/button"
import { Diff } from "@chipmate/chipmate-ui/diff"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { useVSCode } from "../../context/vscode"
import { useSession } from "../../context/session"
import { pendingChanges, useTurnChanges } from "../../context/turn-changes"
import "../../styles/turn-changes.css"

export function TurnChangesCard(props: {
  sessionID: string
  messageID: string
  live?: boolean
  readonly?: boolean
  legacy?: number
}) {
  const vscode = useVSCode()
  const session = useSession()
  const changes = useTurnChanges()
  const record = createMemo(() => changes.record(props.sessionID, props.messageID))
  const summary = () => record().summary()
  const detail = () => record().detail()
  const selected = () => record().selected()
  const setSelected = (value: string | undefined) => record().setSelected(value)
  const setDetail = (value: undefined) => record().setDetail(value)
  const error = () => record().error()
  const setError = (value: string | undefined) => record().setError(value)
  const busy = () => record().busy()
  const loading = () => record().loading()
  const load = (fileID?: string) => record().load(fileID)
  const mutate = (action: "revert" | "restore", fileID?: string, hunkID?: string) =>
    record().mutate(action, fileID, hunkID)
  const [expanded, setExpanded] = createSignal(false)
  createEffect(() => {
    props.sessionID
    props.messageID
    setExpanded(false)
  })
  const disabled = () => props.readonly || busy() || session.status() !== "idle"
  const label = createMemo(() => {
    const value = summary()
    if (!value) return "本轮修改"
    if (value.phase === "stopping") return "正在停止"
    if (value.phase === "settling") return "正在整理修改"
    if (value.phase === "running") return "正在记录修改"
    if (value.files.length && value.files.every((file) => file.state === "reverted")) return "本轮修改已撤销"
    if (value.files.some((file) => file.state !== "kept")) return "本轮修改已部分撤销"
    return value.outcome === "interrupted" ? "本轮已停止" : value.outcome === "error" ? "本轮异常结束" : "本轮修改"
  })
  const open = (fileID: string) => {
    if (selected() === fileID) {
      setSelected(undefined)
      setDetail(undefined)
      return
    }
    setSelected(fileID)
    setDetail(undefined)
    setError(undefined)
    load(fileID)
  }
  const files = () => summary()?.files ?? []
  const reason = () => summary()?.reason
  const canRevert = () => summary()?.canRevert === true
  const canRestore = () => summary()?.canRestore === true
  const visible = () =>
    !changes.running(props.sessionID, props.messageID) &&
    !pendingChanges(summary()) &&
    (files().length || reason() || props.legacy || error())
  const shown = () => (expanded() ? files() : [])
  return (
    <Show when={visible()}>
      <section data-component="turn-changes" aria-label="本轮文件修改" aria-busy={busy() || loading()}>
        <div data-slot="turn-changes-header">
          <span data-slot="turn-changes-title">
            <Icon name="code" size="small" />
            {label()}
            <Show when={files().length}> · {files().length} 个文件</Show>
            <Show when={files().length}>
              <span data-slot="turn-changes-counts">
                +{files().reduce((n, file) => n + file.additions, 0)} −
                {files().reduce((n, file) => n + file.deletions, 0)}
              </span>
            </Show>
          </span>
          <div data-slot="turn-changes-actions">
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                setExpanded(!expanded())
                load()
              }}
            >
              {expanded() ? "收起审阅" : "审阅"}
            </Button>
            <Show when={canRestore()}>
              <Button size="small" variant="ghost" disabled={disabled()} onClick={() => mutate("restore")}>
                恢复本次撤销
              </Button>
            </Show>
            <Button size="small" variant="ghost" disabled={disabled() || !canRevert()} onClick={() => mutate("revert")}>
              {busy() ? "正在处理" : "撤销本轮"}
            </Button>
          </div>
        </div>
        <Show when={reason()}>
          <p data-slot="turn-changes-notice">{reason()}</p>
        </Show>
        <Show when={!summary() && props.legacy}>
          <p data-slot="turn-changes-notice">
            此历史轮次缺少完整撤销记录。
            <Button
              size="small"
              variant="ghost"
              onClick={() => vscode.postMessage({ type: "openChanges", turnId: props.messageID })}
            >
              审阅已有差异
            </Button>
          </p>
        </Show>
        <For each={shown()}>
          {(file) => (
            <div data-slot="turn-changes-file">
              <div data-slot="turn-changes-file-header">
                <button
                  type="button"
                  data-slot="turn-changes-file-name"
                  title={file.oldFile ? `${file.oldFile} → ${file.file}` : file.file}
                  aria-expanded={selected() === file.id}
                  onClick={() => open(file.id)}
                >
                  <Icon name={selected() === file.id ? "chevron-down" : "chevron-right"} size="small" />
                  <span>{file.oldFile ? `${file.oldFile} → ${file.file}` : file.file}</span>
                </button>
                <span data-slot="turn-changes-kind">
                  {{ added: "新增", deleted: "删除", modified: "修改", renamed: "重命名" }[file.status]}
                </span>
                <span data-slot="turn-changes-counts">
                  +{file.additions} −{file.deletions}
                </span>
                <Show when={file.state !== "kept"}>
                  <span>{file.state === "reverted" ? "已撤销" : "部分撤销"}</span>
                </Show>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={disabled() || !canRevert() || file.state === "reverted"}
                  onClick={() => mutate("revert", file.id)}
                >
                  撤销文件
                </Button>
              </div>
              <Show when={selected() === file.id}>
                <Show when={detail()} fallback={<p role="status">正在读取差异…</p>}>
                  {(value) => (
                    <div data-slot="turn-changes-detail">
                      <Show when={value().reason}>
                        <p>{value().reason}</p>
                      </Show>
                      <Show
                        when={value().hunks.length}
                        fallback={
                          <Show when={value().patch}>
                            <Diff
                              before={{ name: file.file, contents: "" }}
                              after={{ name: file.file, contents: "" }}
                              patch={value().patch}
                              diffStyle="unified"
                            />
                          </Show>
                        }
                      >
                        <For each={value().hunks}>
                          {(hunk) => (
                            <div data-slot="turn-changes-hunk">
                              <div data-slot="turn-changes-actions">
                                <span>第 {hunk.line} 行附近</span>
                                <Button
                                  size="small"
                                  variant="ghost"
                                  disabled={
                                    disabled() ||
                                    !canRevert() ||
                                    hunk.undone ||
                                    value().revision !== summary()?.revision
                                  }
                                  onClick={() => mutate("revert", file.id, hunk.id)}
                                >
                                  {hunk.undone ? "已撤销" : "撤销此处"}
                                </Button>
                              </div>
                              <Diff
                                before={{ name: file.file, contents: "" }}
                                after={{ name: file.file, contents: "" }}
                                patch={hunk.patch}
                                diffStyle="unified"
                              />
                            </div>
                          )}
                        </For>
                      </Show>
                    </div>
                  )}
                </Show>
              </Show>
            </div>
          )}
        </For>
        <Show when={error()}>
          <p role="alert" data-slot="turn-changes-error">
            {error()}
            <Button
              size="small"
              variant="ghost"
              disabled={busy()}
              onClick={() => {
                setError(undefined)
                load()
              }}
            >
              刷新记录
            </Button>
          </p>
        </Show>
      </section>
    </Show>
  )
}
