import path from "node:path"
import { afterAll, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { disposeTestRuntime, tmpdir } from "../fixture/fixture"

afterAll(disposeTestRuntime)
test("QA 工具通过真实入口创建任务，后台执行产出结果并从统一接口读取", async () => {
  const before = process.env.CHIPMATE_CLIENT
  process.env.CHIPMATE_CLIENT = "vscode"
  let offered = false
  let executed = false
  const model = { providerID: "alibaba", modelID: "qwen-plus" }
  const definition = {
    name: "测试摘要",
    prompt: "执行定时报告",
    timezone: "Asia/Shanghai",
    schedule: { kind: "interval", minutes: 1, anchor: new Date(Date.now() + 60_000).toISOString() },
    agent: "ask",
    model,
    timeoutMinutes: 60,
  }
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        messages: { role: string; content?: unknown }[]
        tools?: { function: { name: string } }[]
      }
      const last = JSON.stringify(body.messages.findLast((item) => item.role === "user")?.content)
      const already = body.messages.some((item) => item.role === "tool")
      offered ||= !!body.tools?.some((item) => item.function.name === "scheduled_task")
      if (last.includes("等待人工选择")) {
        if (already) return stream({ content: "人工回答后已完成" }, "stop")
        return stream(
          {
            tool_calls: [
              {
                index: 0,
                id: "确认选项",
                type: "function",
                function: {
                  name: "question",
                  arguments: JSON.stringify({
                    questions: [
                      {
                        header: "确认",
                        question: "选择本次输出",
                        options: [{ label: "继续", description: "完成本次运行" }],
                      },
                    ],
                  }),
                },
              },
            ],
          },
          "tool_calls",
        )
      }
      if (last.includes("执行定时报告")) {
        executed = true
        expect(body.tools?.some((item) => item.function.name === "scheduled_task")).toBe(false)
        return stream({ content: "定时报告已完成" }, "stop")
      }
      if (!already)
        return stream(
          {
            tool_calls: [
              {
                index: 0,
                id: "创建计划",
                type: "function",
                function: {
                  name: "scheduled_task",
                  arguments: JSON.stringify({
                    action: "create",
                    definition: {
                      name: definition.name,
                      prompt: definition.prompt,
                      timezone: definition.timezone,
                      schedule: definition.schedule,
                    },
                  }),
                },
              },
            ],
          },
          "tool_calls",
        )
      return stream({ content: "定时任务已创建" }, "stop")
    },
  })
  await using directory = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "chipmate.json"),
        JSON.stringify({
          enabled_providers: [model.providerID],
          provider: { alibaba: { options: { apiKey: "fixture-key", baseURL: `${provider.url.origin}/v1` } } },
          permission: { scheduled_task: "allow" },
        }),
      )
    },
  })
  const api = async (url: string, body?: unknown) => {
    const response = await Server.Default().app.request(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-chipmate-directory": directory.path },
      body: JSON.stringify(body),
    })
    const result = await response.text()
    if (!response.ok) throw new Error(`${response.status} ${result}`)
    return result ? JSON.parse(result) : undefined
  }
  try {
    await api("/scheduled-task/register", { clientID: "测试窗口", profile: "测试配置", active: true })
    const session = await api("/session", { title: "QA 创建定时任务" })
    await api(`/session/${session.id}/message`, {
      agent: "ask",
      model,
      parts: [{ type: "text", text: "创建定时任务" }],
    })
    expect(offered).toBe(true)
    const listed = await api("/scheduled-task/command", { clientID: "测试窗口", command: { action: "list" } })
    expect(listed.state.tasks).toHaveLength(1)
    const task = listed.state.tasks[0]
    expect(task.agent).toBe("ask")
    expect(task.model).toEqual(model)
    expect(task.timeoutMinutes).toBe(60)
    await api("/scheduled-task/command", {
      clientID: "测试窗口",
      command: { action: "run_now", taskID: task.id, key: "运行一次" },
    })
    await api("/scheduled-task/tick", { clientID: "测试窗口" })
    const deadline = Date.now() + 20_000
    let history = listed
    while (Date.now() < deadline) {
      history = await api("/scheduled-task/command", { clientID: "测试窗口", command: { action: "runs" } })
      if (history.state.runs.some((run: { status: string }) => run.status === "completed")) break
      await Bun.sleep(50)
    }
    expect(executed).toBe(true)
    expect(history.state.runs[0].status).toBe("completed")
    expect(history.state.runs[0].sessionID).toBeTruthy()
    const paused = await api("/scheduled-task/command", {
      clientID: "测试窗口",
      command: { action: "pause", taskID: task.id, version: task.version },
    })
    expect(paused.state.tasks[0].status).toBe("paused")
    const created = await api("/scheduled-task/command", {
      clientID: "测试窗口",
      command: {
        action: "create",
        key: "提问测试",
        definition: { ...definition, name: "人工确认", prompt: "等待人工选择" },
      },
    })
    const questionTask = created.state.tasks.find((item: { name: string }) => item.name === "人工确认")
    await api("/scheduled-task/command", {
      clientID: "测试窗口",
      command: { action: "run_now", taskID: questionTask.id, key: "提问运行" },
    })
    await api("/scheduled-task/tick", { clientID: "测试窗口" })
    let pending: { id: string }[] = []
    for (let attempt = 0; attempt < 100; attempt++) {
      pending = await api("/question")
      if (pending.length) break
      await Bun.sleep(30)
    }
    expect(pending.length).toBe(1)
    await Bun.sleep(600)
    const waiting = await api("/scheduled-task/command", { clientID: "测试窗口", command: { action: "runs" } })
    const waitingRun = waiting.state.runs.find((item: { taskID: string }) => item.taskID === questionTask.id)
    expect(waitingRun.status).toBe("waiting")
    await api(`/session/${waitingRun.sessionID}/prompt_async`, {
      agent: "ask",
      model,
      parts: [{ type: "text", text: "排队的人工作业" }],
    })
    await Bun.sleep(200)
    expect((await api("/question")).map((item: { id: string }) => item.id)).toEqual([pending[0].id])
    await api(`/question/${pending[0].id}/reply`, { answers: [["继续"]] })
    for (let attempt = 0; attempt < 100; attempt++) {
      const done = await api("/scheduled-task/command", { clientID: "测试窗口", command: { action: "runs" } })
      if (done.state.runs.find((item: { taskID: string }) => item.taskID === questionTask.id).status === "completed")
        break
      await Bun.sleep(30)
    }
    expect(await api("/question")).toEqual([])
    let messages = []
    for (let attempt = 0; attempt < 100; attempt++) {
      messages = await api(`/session/${waitingRun.sessionID}/message`)
      const user = messages.findLast((item: { info: { role: string } }) => item.info.role === "user")
      if (
        messages.some(
          (item: { info: { role: string; parentID?: string; finish?: string } }) =>
            item.info.role === "assistant" && item.info.parentID === user.info.id && item.info.finish === "stop",
        )
      )
        break
      await Bun.sleep(30)
    }
    const user = messages.findLast((item: { info: { role: string } }) => item.info.role === "user")
    expect(user.parts.some((part: { text?: string }) => part.text === "排队的人工作业")).toBe(true)
    expect(
      messages.some(
        (item: { info: { role: string; parentID?: string; finish?: string } }) =>
          item.info.role === "assistant" && item.info.parentID === user.info.id && item.info.finish === "stop",
      ),
    ).toBe(true)
  } finally {
    process.env.CHIPMATE_CLIENT = before
    await provider.stop(true)
  }
}, 60_000)

function stream(delta: object, reason: string) {
  const chunk = (value: object) =>
    `data: ${JSON.stringify({ id: "测试", object: "chat.completion.chunk", choices: [value] })}\n\n`
  return new Response(
    chunk({ delta: { role: "assistant", ...delta } }) +
      chunk({ delta: {}, finish_reason: reason }) +
      "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}
