import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@chipmate/chipmate-ui/button"
import { TextField } from "@chipmate/chipmate-ui/text-field"
import { Select } from "@chipmate/chipmate-ui/select"
import { acquireAppearanceApi } from "../appearance/api"
import type {
  ScheduledTask,
  ScheduledRun,
  TaskDefinition,
  ScheduleRule,
  SchedulerCommand,
  SchedulerMessage,
  SchedulerViewState,
} from "../../src/shared/scheduled-task"

const labels: Record<string, string> = {
  enabled: "已启用",
  paused: "已暂停",
  finished: "已结束",
  queued: "排队中",
  running: "运行中",
  waiting: "等待用户",
  completed: "成功",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
  skipped: "已跳过",
}
const date = (value?: number | null) => (value ? new Date(value).toLocaleString("zh-CN") : "—")
const schedule = (rule: ScheduleRule) =>
  rule.kind === "interval"
    ? `每 ${rule.minutes} 分钟`
    : rule.kind === "once"
      ? new Date(rule.at).toLocaleString("zh-CN")
      : rule.kind === "monthly"
        ? `每月 ${rule.day} 日 ${rule.time}`
        : `星期 ${rule.days.join("、")} ${rule.time}`
const api = acquireAppearanceApi() as { postMessage(message: SchedulerMessage): void }
const blank = (): TaskDefinition => ({
  name: "",
  prompt: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  schedule: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" },
  agent: "ask",
  model: { providerID: "", modelID: "" },
  timeoutMinutes: 60,
})

function Choice(props: { label: string; value: string; values: string[]; change(value: string): void }) {
  return (
    <label class="schedule-field">
      <span>{props.label}</span>
      <Select options={props.values} current={props.value} onSelect={(value) => value && props.change(value)} />
    </label>
  )
}

export function SchedulerApp() {
  const [state, setState] = createSignal<SchedulerViewState>({
    tasks: [],
    runs: [],
    directories: [],
    serverTime: Date.now(),
  })
  const [directory, setDirectory] = createSignal("")
  const [editing, setEditing] = createSignal<"new" | ScheduledTask>()
  const [draft, setDraft] = createSignal(blank())
  const [kind, setKind] = createSignal("工作日")
  const [selected, setSelected] = createSignal<string>()
  const [detail, setDetail] = createSignal<ScheduledRun>()
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [preview, setPreview] = createSignal<string[]>([])
  const patch = (value: Partial<TaskDefinition>) => {
    setDraft({ ...draft(), ...value })
    setPreview([])
  }
  const send = (command: SchedulerCommand, target = directory()) => {
    setError("")
    setBusy(true)
    api.postMessage({
      type: "scheduler.command",
      directory: target,
      command: { ...command, key: command.key ?? crypto.randomUUID() },
    })
  }
  const open = (task?: ScheduledTask) => {
    setEditing(task ?? "new")
    setDraft(task ? structuredClone(task) : blank())
    setPreview([])
    if (task) {
      setDirectory(task.directory)
      api.postMessage({ type: "scheduler.options", directory: task.directory })
    }
    const value = task?.schedule
    setKind(
      value?.kind === "interval"
        ? "间隔"
        : value?.kind === "once"
          ? "一次性"
          : value?.kind === "monthly"
            ? "每月"
            : value?.kind === "weekly" && value.days.length === 7
              ? "每天"
              : value?.kind === "weekly" && value.days.length !== 5
                ? "每周"
                : "工作日",
    )
    if (!task && state().options?.models[0]) chooseModel(state().options!.models[0].id)
  }
  const chooseModel = (id: string) => {
    const index = id.indexOf("/")
    patch({ model: { providerID: id.slice(0, index), modelID: id.slice(index + 1) } })
  }
  const changeKind = (value: string) => {
    setKind(value)
    patch({
      schedule:
        value === "间隔"
          ? { kind: "interval", minutes: 30, anchor: new Date().toISOString() }
          : value === "一次性"
            ? { kind: "once", at: new Date(Date.now() + 3600_000).toISOString() }
            : value === "每月"
              ? { kind: "monthly", day: 1, time: "09:00" }
              : {
                  kind: "weekly",
                  days: value === "每天" ? [1, 2, 3, 4, 5, 6, 7] : value === "每周" ? [1] : [1, 2, 3, 4, 5],
                  time: "09:00",
                },
    })
  }
  const changeRule = (value: object) => patch({ schedule: { ...draft().schedule, ...value } as ScheduleRule })
  const listener = (event: MessageEvent) => {
    if (event.data.type === "scheduler.state") {
      const value = event.data.value as SchedulerViewState
      setState(value)
      if (!directory() && value.directories[0]) setDirectory(value.directories[0])
      if (value.selected) {
        setSelected(value.selected)
        const task = value.tasks.find((item) => item.id === value.selected)
        if (task) setDirectory(task.directory)
      }
    }
    if (event.data.type === "scheduler.result") {
      setBusy(false)
      if (Array.isArray(event.data.value)) setPreview(event.data.value)
      else if (event.data.value?.version) setEditing(undefined)
    }
    if (event.data.type === "scheduler.error") {
      setError(event.data.message)
      setBusy(false)
    }
  }
  onMount(() => {
    window.addEventListener("message", listener)
    api.postMessage({ type: "scheduler.ready" })
  })
  onCleanup(() => window.removeEventListener("message", listener))
  return (
    <main data-component="scheduled-tasks">
      <header class="schedule-header">
        <div>
          <h1>定时任务</h1>
          <p>在对话中创建和管理，运行结果汇集于此。</p>
        </div>
        <Button variant="primary" disabled={!directory()} onClick={() => open()}>
          新建任务
        </Button>
      </header>
      <Show when={error()}>
        <div role="alert" class="schedule-error">
          {error()}
        </div>
      </Show>
      <Choice
        label="当前项目"
        value={directory()}
        values={state().directories}
        change={(value) => {
          setDirectory(value)
          api.postMessage({ type: "scheduler.options", directory: value })
        }}
      />
      <Show
        when={editing()}
        fallback={
          <>
            <section aria-label="任务列表" class="schedule-list">
              <Show
                when={state().tasks.some((task) => task.directory === directory())}
                fallback={
                  <div class="schedule-empty">
                    <h2>暂无定时任务</h2>
                    <p>在 QA 中告诉 Agent 工作内容和时间，或选择“新建任务”。</p>
                  </div>
                }
              >
                <For each={state().tasks.filter((task) => task.directory === directory())}>
                  {(task) => (
                    <article class="schedule-row" data-selected={selected() === task.id}>
                      <div class="schedule-summary">
                        <button class="schedule-title" onClick={() => setSelected(task.id)}>
                          {task.name}
                        </button>
                        <span>
                          {schedule(task.schedule)} · {task.timezone}
                        </span>
                        <small>下次 {date(task.nextAt)}</small>
                      </div>
                      <span class="schedule-status" data-status={task.status}>
                        {labels[task.status]}
                      </span>
                      <div class="schedule-actions">
                        <Button
                          disabled={busy()}
                          onClick={() => send({ action: "run_now", taskID: task.id }, task.directory)}
                        >
                          立即执行
                        </Button>
                        <Button onClick={() => open(task)}>编辑</Button>
                        <Button
                          disabled={busy()}
                          onClick={() =>
                            send(
                              {
                                action: task.status === "enabled" ? "pause" : "resume",
                                taskID: task.id,
                                version: task.version,
                              },
                              task.directory,
                            )
                          }
                        >
                          {task.status === "enabled" ? "暂停" : "恢复"}
                        </Button>
                        <Button
                          disabled={busy()}
                          onClick={() =>
                            send({ action: "delete", taskID: task.id, version: task.version }, task.directory)
                          }
                        >
                          删除
                        </Button>
                      </div>
                    </article>
                  )}
                </For>
              </Show>
            </section>
            <section aria-label="运行历史">
              <div class="schedule-header">
                <h2>运行历史</h2>
                <Show when={selected()}>
                  <Button onClick={() => setSelected(undefined)}>全部任务</Button>
                </Show>
              </div>
              <For
                each={state().runs.filter(
                  (run) => (!selected() || run.taskID === selected()) && run.directory === directory(),
                )}
              >
                {(run) => (
                  <article class="schedule-row">
                    <div class="schedule-summary">
                      <button class="schedule-title" onClick={() => setDetail(run)}>
                        {run.snapshot.name}
                      </button>
                      <small>{date(run.scheduledAt)}</small>
                      <Show when={run.reason}>
                        <span>{run.reason}</span>
                      </Show>
                    </div>
                    <span class="schedule-status" data-status={run.status}>
                      {labels[run.status]}
                    </span>
                    <div class="schedule-actions">
                      <Show when={run.sessionID}>
                        <Button
                          onClick={() =>
                            api.postMessage({
                              type: "scheduler.openSession",
                              sessionID: run.sessionID!,
                              directory: directory(),
                            })
                          }
                        >
                          {run.status === "waiting" ? "处理请求" : "打开结果会话"}
                        </Button>
                      </Show>
                      <Show when={["queued", "running", "waiting"].includes(run.status)}>
                        <Button disabled={busy()} onClick={() => send({ action: "cancel_run", runID: run.id })}>
                          停止本次
                        </Button>
                      </Show>
                    </div>
                  </article>
                )}
              </For>
            </section>
            <Show when={detail()}>
              {(run) => (
                <section class="schedule-detail">
                  <div class="schedule-header">
                    <h2>运行详情</h2>
                    <Button onClick={() => setDetail(undefined)}>关闭详情</Button>
                  </div>
                  <p>
                    {labels[run().status]} · {date(run().startedAt)} — {date(run().endedAt)}
                  </p>
                  <pre>{run().snapshot.prompt}</pre>
                  <p>{run().reason}</p>
                  <p>运行标识 {run().id}</p>
                </section>
              )}
            </Show>
          </>
        }
      >
        <form
          class="schedule-editor"
          onSubmit={(event) => {
            event.preventDefault()
            const task = editing()
            send({
              action: task === "new" ? "create" : "update",
              taskID: task === "new" ? undefined : task?.id,
              version: task === "new" ? undefined : task?.version,
              definition: draft(),
            })
          }}
        >
          <h2>{editing() === "new" ? "新建定时任务" : "编辑定时任务"}</h2>
          <TextField label="任务名称" value={draft().name} onChange={(name) => patch({ name })} required />
          <TextField
            multiline
            label="任务指令"
            value={draft().prompt}
            onChange={(prompt) => patch({ prompt })}
            required
          />
          <div class="schedule-grid">
            <Choice
              label="执行计划"
              value={kind()}
              values={["每天", "工作日", "每周", "每月", "间隔", "一次性"]}
              change={changeKind}
            />
            <TextField label="时区" value={draft().timezone} onChange={(timezone) => patch({ timezone })} />
          </div>
          <Show when={draft().schedule.kind === "weekly" || draft().schedule.kind === "monthly"}>
            <TextField
              label="执行时间 HH:mm"
              value={(draft().schedule as { time: string }).time}
              onChange={(time) => changeRule({ time })}
            />
          </Show>
          <Show when={kind() === "每周"}>
            <TextField
              label="星期（1～7，以逗号分隔）"
              value={(draft().schedule as { days: number[] }).days?.join(",")}
              onChange={(value) => changeRule({ days: value.split(/[,，]/).map(Number) })}
            />
          </Show>
          <Show when={kind() === "每月"}>
            <TextField
              label="每月日期"
              value={String((draft().schedule as { day: number }).day)}
              onChange={(value) => changeRule({ day: Number(value) })}
            />
          </Show>
          <Show when={kind() === "间隔"}>
            <TextField
              label="间隔分钟"
              value={String((draft().schedule as { minutes: number }).minutes)}
              onChange={(value) => changeRule({ minutes: Number(value) })}
            />
          </Show>
          <Show when={kind() === "一次性"}>
            <TextField
              label="执行日期时间（包含时区偏移）"
              value={(draft().schedule as { at: string }).at}
              onChange={(at) => changeRule({ at })}
            />
          </Show>
          <div class="schedule-grid">
            <Choice
              label="执行 Agent"
              value={draft().agent}
              values={state().options?.agents ?? ["ask"]}
              change={(agent) => patch({ agent })}
            />
            <Choice
              label="模型"
              value={`${draft().model.providerID}/${draft().model.modelID}`}
              values={state().options?.models.map((item) => item.id) ?? []}
              change={chooseModel}
            />
          </div>
          <Choice
            label="会话方式"
            value={draft().sessionID ? "继续指定会话" : "每次新建会话"}
            values={["每次新建会话", "继续指定会话"]}
            change={(value) =>
              patch({ sessionID: value === "继续指定会话" ? state().options?.sessions[0]?.id : undefined })
            }
          />
          <Show when={draft().sessionID}>
            <Choice
              label="目标会话"
              value={draft().sessionID!}
              values={state().options?.sessions.map((item) => item.id) ?? []}
              change={(sessionID) => patch({ sessionID })}
            />
          </Show>
          <TextField
            label="主动执行超时（分钟）"
            value={String(draft().timeoutMinutes)}
            onChange={(value) => patch({ timeoutMinutes: Number(value) })}
          />
          <div class="schedule-preview">
            <Button disabled={busy()} onClick={() => send({ action: "preview", definition: draft() })}>
              预览未来 5 次
            </Button>
            <For each={preview()}>{(value) => <span>{value}</span>}</For>
          </div>
          <div class="schedule-actions">
            <Button onClick={() => setEditing(undefined)}>取消</Button>
            <Button
              variant="primary"
              type="submit"
              disabled={busy() || !draft().name.trim() || !draft().prompt.trim() || !draft().model.modelID}
            >
              保存
            </Button>
          </div>
        </form>
      </Show>
    </main>
  )
}
