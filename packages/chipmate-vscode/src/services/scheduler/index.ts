import * as vscode from "vscode"
import { createHash, randomUUID } from "node:crypto"
import { realpathSync } from "node:fs"
import type { ChipMateConnectionService } from "../cli-backend"
import type {
  SchedulerCommand,
  SchedulerState,
  SchedulerViewState,
  SchedulerOptions,
  SchedulerMessage,
} from "../../shared/scheduled-task"
import { SchedulerPanel } from "./panel"

export interface SchedulerLogin {
  snapshot(): { authenticated: boolean }
  require(): Promise<{ server: string; userId: string }>
  onDidChange(listener: () => void): vscode.Disposable
}

export function registerScheduler(
  context: vscode.ExtensionContext,
  connection: ChipMateConnectionService,
  login?: SchedulerLogin,
) {
  const states = new Map<string, SchedulerState>()
  const owners = new Map<string, string>()
  const announced = new Set<string>()
  const baseProfile = createHash("sha256").update(context.globalStorageUri.fsPath).digest("hex")
  let profile = baseProfile
  let selected: string | undefined
  let options: SchedulerOptions | undefined
  let disposed = false
  let pending: Promise<void> | undefined
  const roots = () =>
    vscode.workspace.isTrusted && (!login || login.snapshot().authenticated)
      ? (vscode.workspace.workspaceFolders ?? [])
          .filter((folder) => folder.uri.scheme === "file")
          .map((folder) => realpathSync(folder.uri.fsPath))
      : []
  const publish = () =>
    panel.state({
      tasks: [...states.values()].flatMap((s) => s.tasks),
      runs: [...states.values()].flatMap((s) => s.runs).sort((a, b) => b.createdAt - a.createdAt),
      serverTime: Date.now(),
      directories: roots(),
      selected,
      options,
    })
  const call = async (directory: string, action: string, body: object) => {
    if (!("active" in body && body.active === false)) await connection.getClientAsync(directory)
    const config = connection.getServerConfig()
    if (!config) throw new Error("等待后端连接")
    const id = config.clientID ?? owners.get(directory) ?? randomUUID()
    owners.set(directory, id)
    const response = await fetch(
      `${config.baseUrl}/scheduled-task/${action}?directory=${encodeURIComponent(directory)}`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`chipmate:${config.password}`).toString("base64")}`,
          "content-type": "application/json",
          "x-chipmate-client-id": id,
        },
        body: JSON.stringify({ ...body, clientID: id }),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!response.ok) throw new Error(`定时服务请求失败（${response.status}）`)
    const value = (await response.json()) as { state: SchedulerState; result?: unknown; error?: string }
    states.set(directory, value.state)
    publish()
    if (value.error) throw new Error(value.error)
    return value.result
  }
  const cycle = () =>
    (pending ??= (async () => {
      if (disposed) return
      const directories = roots()
      if (directories.length && login) {
        const identity = await login.require()
        profile = createHash("sha256")
          .update(JSON.stringify([baseProfile, identity.server, identity.userId]))
          .digest("hex")
      }
      for (const [directory] of states) {
        if (directories.includes(directory)) continue
        await call(directory, "register", { profile, active: false }).catch((error) =>
          console.warn("[ChipMate New] 定时任务注销失败", String(error)),
        )
        states.delete(directory)
        owners.delete(directory)
      }
      for (const directory of directories) {
        await call(directory, "register", { profile, active: true })
        await call(directory, "tick", {})
        for (const run of states.get(directory)!.runs) {
          if (
            !run.owner.startsWith(`${owners.get(directory)}:`) ||
            !["waiting", "failed", "interrupted"].includes(run.status)
          )
            continue
          const key = `${run.id}:${run.status}`
          if (announced.has(key)) continue
          announced.add(key)
          void vscode.window
            .showInformationMessage(
              `${run.snapshot.name} · ${run.status === "waiting" ? "等待处理" : "执行未完成"}`,
              "查看任务",
            )
            .then((choice) => {
              if (choice) panel.open()
            })
        }
      }
      publish()
    })()
      .catch((error) => {
        panel.error(error)
        console.warn("[ChipMate New] 定时任务同步失败", String(error))
      })
      .finally(() => {
        pending = undefined
      }))

  const loadOptions = async (directory: string) => {
    const client = await connection.getClientAsync(directory)
    const [agents, providers, sessions] = await Promise.all([
      client.app.agents({ directory }),
      client.provider.list({ directory }),
      client.session.list({ directory }),
    ])
    options = {
      agents: (agents.data ?? []).filter((item) => item.mode !== "subagent" && !item.hidden).map((item) => item.name),
      models: (providers.data?.all ?? [])
        .filter((item) => providers.data?.connected.includes(item.id))
        .flatMap((item) =>
          Object.values(item.models).map((model) => ({
            id: `${item.id}/${model.id}`,
            label: `${item.name} · ${model.name}`,
          })),
        ),
      sessions: (sessions.data ?? [])
        .filter((item) => !item.parentID && !item.metadata?.ephemeral)
        .map((item) => ({ id: item.id, title: item.title })),
    }
    publish()
  }
  const receive = async (message: SchedulerMessage) => {
    if (message.type === "scheduler.ready") {
      await cycle()
      publish()
      if (roots()[0]) await loadOptions(roots()[0])
      return
    }
    if (!roots().includes(message.directory)) throw new Error("请打开并信任目标项目")
    if (message.type === "scheduler.options") {
      await loadOptions(message.directory)
      return
    }
    if (message.type === "scheduler.openSession") {
      await vscode.commands.executeCommand("chipmate.v2.openInTab", { sessionID: message.sessionID })
      return
    }
    const result = await call(message.directory, "command", { command: message.command })
    panel.result(result)
    await cycle()
  }
  const panel = new SchedulerPanel(context.extensionUri, receive)
  const timer = setInterval(() => {
    void cycle()
  }, 5_000)
  timer.unref()
  context.subscriptions.push(
    panel,
    {
      dispose: connection.onEvent((event) => {
        if (event.type === "scheduled_task.changed" || event.type === "scheduled_run.changed") void cycle()
      }),
    },
    vscode.commands.registerCommand("chipmate.v2.scheduledTasks", (id?: string) => {
      selected = id
      panel.open()
      publish()
      void cycle()
    }),
    vscode.commands.registerCommand(
      "chipmate.v2.scheduledTaskAction",
      async (input: { action: "open" | "run_now"; taskID?: string; directory?: string }) => {
        if (input.action === "open") {
          selected = input.taskID
          panel.open()
          publish()
          return
        }
        if (!input.directory || !roots().includes(input.directory)) throw new Error("请打开目标项目")
        await call(input.directory, "command", {
          command: { action: "run_now", taskID: input.taskID, key: randomUUID() },
        })
        await cycle()
      },
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void cycle()
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void cycle()
    }),
    {
      dispose: () => {
        disposed = true
        clearInterval(timer)
        for (const directory of states.keys())
          void call(directory, "register", { profile, active: false }).catch((error) =>
            console.warn("[ChipMate New] 定时任务关闭通知失败", String(error)),
          )
      },
    },
  )
  if (login)
    context.subscriptions.push(
      login.onDidChange(() => {
        void cycle()
      }),
    )
  void cycle()
}
