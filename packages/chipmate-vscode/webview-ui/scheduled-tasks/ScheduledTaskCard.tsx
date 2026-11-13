import { For, Show } from "solid-js"
import { BasicTool } from "@chipmate/chipmate-ui/basic-tool"
import { Button } from "@chipmate/chipmate-ui/button"
import type { ToolProps } from "@chipmate/chipmate-ui/message-part"
import { getVSCodeAPI } from "../src/context/vscode"

const actions: Record<string, string> = {
  create: "创建定时任务",
  update: "修改定时任务",
  list: "查询定时任务",
  get: "查看定时任务",
  pause: "暂停定时任务",
  resume: "恢复定时任务",
  delete: "删除定时任务",
  run_now: "立即执行",
  runs: "查询运行历史",
  get_run: "查看运行结果",
  cancel_run: "停止本次运行",
  preview: "预览执行时间",
}
export function ScheduledTaskCard(props: ToolProps) {
  const result = () =>
    props.metadata.result as
      | { taskID?: string; id?: string; name?: string; nextAt?: number; timezone?: string; status?: string }
      | undefined
  const items = () =>
    Array.isArray(props.metadata.result)
      ? (props.metadata.result as { id?: string; name?: string; status?: string }[])
      : []
  return (
    <BasicTool {...props} icon="history" trigger={{ title: actions[String(props.input.action)] ?? "定时任务" }}>
      <div data-component="scheduled-task-card">
        <Show
          when={props.status === "completed"}
          fallback={<span>{props.status === "error" ? "操作未完成，请查看错误详情" : "正在处理任务"}</span>}
        >
          <strong>{result()?.name ?? actions[String(props.input.action)]}</strong>
          <Show when={result()?.nextAt}>
            <p>下次执行 {new Date(result()!.nextAt!).toLocaleString("zh-CN", { timeZone: result()?.timezone })}</p>
          </Show>
          <For each={items()}>
            {(item) => (
              <p>
                {item.name ?? item.id} {item.status}
              </p>
            )}
          </For>
          <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px" }}>
            <Button
              onClick={() =>
                getVSCodeAPI().postMessage({
                  type: "scheduledTaskAction",
                  action: "open",
                  taskID: result()?.taskID ?? result()?.id,
                })
              }
            >
              查看任务
            </Button>
            <Show when={result()?.id?.startsWith("schedule_")}>
              <Button
                onClick={() =>
                  getVSCodeAPI().postMessage({
                    type: "scheduledTaskAction",
                    action: "run_now",
                    taskID: result()?.taskID ?? result()?.id,
                  })
                }
              >
                立即执行
              </Button>
            </Show>
          </div>
        </Show>
      </div>
    </BasicTool>
  )
}
