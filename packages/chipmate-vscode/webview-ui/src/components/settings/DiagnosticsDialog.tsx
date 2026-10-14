import { createEffect, createSignal, on, onCleanup, Show, type Component } from "solid-js"
import { AlertDialog } from "@kobalte/core/alert-dialog"
import { Button } from "@chipmate/chipmate-ui/button"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { Checkbox } from "@chipmate/chipmate-ui/checkbox"
import { useVSCode } from "../../context/vscode"
import type { DiagnosticMode, DiagnosticState } from "../../../../src/shared/diagnostics"
import "./diagnostics.css"

export const DiagnosticsDialog: Component<{ mode: DiagnosticMode | undefined; onClose: () => void }> = (props) => {
  const vscode = useVSCode()
  let trigger: HTMLElement | undefined
  const [requestId, setRequestId] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [hours, setHours] = createSignal<1 | 24 | 168>(24)
  const [includeSession, setIncludeSession] = createSignal(false)
  const [hasSession, setHasSession] = createSignal(false)
  const [server, setServer] = createSignal("正在读取…")
  const [state, setState] = createSignal<DiagnosticState>()
  const busy = () =>
    Boolean(state() && ["collecting", "packaging", "login", "uploading", "verifying"].includes(state()!.phase))
  createEffect(
    on(
      () => props.mode,
      () => {
        if (!props.mode) return
        trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
        setRequestId(crypto.randomUUID())
        setState(undefined)
        setDescription("")
        setHours(24)
        setIncludeSession(false)
        vscode.postMessage({ type: "diagnostics.context", requestId: requestId() })
      },
    ),
  )
  onCleanup(
    vscode.onMessage((message) => {
      if (!props.mode) return
      if (message.type === "diagnostics.context" && message.requestId === requestId()) {
        setServer(message.server)
        setHasSession(message.hasSession)
      }
      if (message.type === "diagnostics.state") {
        setRequestId(message.state.requestId)
        setState(message.state)
      }
    }),
  )
  const action = (
    type: "diagnostics.cancel" | "diagnostics.save" | "diagnostics.retry" | "diagnostics.copy" | "diagnostics.open",
  ) => vscode.postMessage({ type, requestId: requestId() })
  const close = () => {
    if (busy()) action("diagnostics.cancel")
    else props.onClose()
  }
  return (
    <AlertDialog
      open={Boolean(props.mode)}
      modal
      preventScroll
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay data-component="dialog-overlay" />
        <div data-component="dialog" data-fit class="diagnostics-dialog">
          <div data-slot="dialog-container">
            <AlertDialog.Content
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                requestAnimationFrame(() => trigger?.focus())
              }}
              data-slot="dialog-content"
              onEscapeKeyDown={(event) => {
                event.preventDefault()
                close()
              }}
              onInteractOutside={(event) => event.preventDefault()}
            >
              <div data-slot="dialog-header">
                <div class="diagnostics-title-row">
                  <AlertDialog.Title data-slot="dialog-title">
                    {props.mode === "export" ? "保存日志包" : "提交诊断"}
                  </AlertDialog.Title>
                  <Button variant="ghost" aria-label="关闭诊断弹窗" onClick={close}>
                    <Icon name="close" size="small" />
                  </Button>
                </div>
                <AlertDialog.Description data-slot="dialog-description">
                  自动整理诊断资料，帮助支持人员定位问题。
                </AlertDialog.Description>
              </div>
              <div class="diagnostics-body">
                <Show when={!state()}>
                  <label>
                    <span>
                      问题描述 <span class="diagnostics-muted">（选填）</span>
                    </span>
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={description()}
                      onInput={(event) => setDescription(event.currentTarget.value)}
                      placeholder="例如：索引失败，或模型请求没有响应"
                    />
                    <span class="diagnostics-counter">{[...description()].length}/500</span>
                  </label>
                  <label>
                    时间范围
                    <select
                      value={hours()}
                      onChange={(event) => setHours(Number(event.currentTarget.value) as 1 | 24 | 168)}
                    >
                      <option value="1">最近 1 小时</option>
                      <option value="24">最近 24 小时</option>
                      <option value="168">最近 7 天</option>
                    </select>
                  </label>
                  <div class="diagnostics-note">
                    自动收集运行日志、错误记录、环境与组件状态。默认不包含聊天正文、源码、文档原件或索引数据库。
                  </div>
                  <Checkbox checked={includeSession()} disabled={!hasSession()} onChange={setIncludeSession}>
                    附加当前会话内容
                  </Checkbox>
                  <p class="diagnostics-muted">
                    {hasSession()
                      ? "包含当前会话及关联子任务已有的聊天和工具文本，可能含业务内容。"
                      : "当前没有可附加的会话。"}
                  </p>
                  <Show when={props.mode === "submit"}>
                    <div>
                      <span class="diagnostics-muted">提交位置</span>
                      <div class="diagnostics-server">{server()}</div>
                    </div>
                    <p class="diagnostics-muted">仅本人和管理员可查看，7 天后自动清理。</p>
                  </Show>
                  <Show when={props.mode === "export"}>
                    <p class="diagnostics-muted">无需登录。另存的文件由你自行管理。</p>
                  </Show>
                </Show>
                <Show when={state()}>
                  {(current) => (
                    <div role="status" aria-live="polite" class="diagnostics-status">
                      <strong>{current().message}</strong>
                      <Show when={busy()}>
                        <progress aria-label={current().message} />
                      </Show>
                      <Show when={current().partial}>
                        <p>部分资料未采集或已截断，详情见包内中文摘要。</p>
                      </Show>
                      <Show when={current().phase === "submitted"}>
                        <label>
                          诊断编号<code>{current().id}</code>
                        </label>
                        <div class="diagnostics-actions">
                          <Button variant="secondary" onClick={() => action("diagnostics.copy")}>
                            复制编号
                          </Button>
                          <Button variant="secondary" onClick={() => action("diagnostics.open")}>
                            查看记录
                          </Button>
                        </div>
                      </Show>
                      <Show
                        when={
                          !busy() && current().canSave && current().phase !== "submitted" && current().phase !== "saved"
                        }
                      >
                        <div class="diagnostics-actions">
                          <Button variant="secondary" onClick={() => action("diagnostics.save")}>
                            保存日志包
                          </Button>
                          <Show when={props.mode === "submit"}>
                            <Button variant="secondary" onClick={() => action("diagnostics.retry")}>
                              查询结果并重试
                            </Button>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
                <div class="diagnostics-actions">
                  <Button variant="secondary" onClick={close}>
                    {state() && !busy() ? "完成" : "取消"}
                  </Button>
                  <Show when={!state()}>
                    <Button
                      variant="primary"
                      onClick={() => {
                        setState({ requestId: requestId(), phase: "collecting", message: "收集中" })
                        vscode.postMessage({
                          type: "diagnostics.start",
                          options: {
                            requestId: requestId(),
                            mode: props.mode!,
                            hours: hours(),
                            description: description(),
                            includeSession: includeSession(),
                          },
                        })
                      }}
                    >
                      {props.mode === "export" ? "收集并保存" : "收集并提交"}
                    </Button>
                  </Show>
                </div>
              </div>
            </AlertDialog.Content>
          </div>
        </div>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}
