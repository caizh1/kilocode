import { afterAll, expect, test } from "bun:test"
import path from "node:path"
import { Server } from "../../../src/server/server"
import { tmpdir, disposeTestRuntime } from "../../fixture/fixture"
import type { Result } from "../../../src/chipmate/turn-changes/schema"

afterAll(async () => {
  await disposeTestRuntime()
})

const wait = async (predicate: () => Promise<boolean>, milliseconds = 20_000) => {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(30)
  }
  throw new Error("等待真实调用链超时")
}

test.each(["write", "bash"] as const)(
  "真实提示入口执行 %s，停止后经正式接口审阅、撤销及恢复",
  async (tool) => {
    const proxy = { NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy }
    process.env.NO_PROXY = [proxy.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",")
    process.env.no_proxy = process.env.NO_PROXY
    let calls = 0
    let filepath = ""
    const provider = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (request) => {
        if (!new URL(request.url).pathname.endsWith("/chat/completions")) return new Response("不存在", { status: 404 })
        await request.json()
        calls++
        if (calls > 1)
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(": 等待用户停止\n\n"))
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          )
        const chunks = [
          {
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_write",
                  type: "function",
                  function: {
                    name: tool,
                    arguments: JSON.stringify(
                      tool === "write"
                        ? { filePath: filepath, content: "const value = 2\n" }
                        : {
                            command: "printf 'const value = 2\\n' > main.ts",
                            workdir: path.dirname(filepath),
                            description: "修改验收文件",
                          },
                    ),
                  },
                },
              ],
            },
          },
          { delta: {}, finish_reason: "tool_calls" },
        ]
        return new Response(
          chunks
            .map(
              (choice) =>
                `data: ${JSON.stringify({ id: "本轮验收", object: "chat.completion.chunk", choices: [choice] })}\n\n`,
            )
            .join("") + "data: [DONE]\n\n",
          { headers: { "Content-Type": "text/event-stream" } },
        )
      },
    })
    try {
      await using temporary = await tmpdir({
        git: true,
        init: async (directory) => {
          filepath = path.join(directory, "main.ts")
          await Bun.write(filepath, "const value = 1\n")
          await Bun.write(
            path.join(directory, "chipmate.json"),
            JSON.stringify({
              enabled_providers: ["alibaba"],
              provider: { alibaba: { options: { apiKey: "test-key", baseURL: `${provider.url.origin}/v1` } } },
              agent: { code: { model: "alibaba/qwen-plus" } },
              permission: "allow",
            }),
          )
        },
      })
      await (async () => {
        const api = async (url: string, body?: unknown) => {
          const response = await Server.Default().app.request(url, {
            method: body === undefined ? "GET" : "POST",
            headers: { "x-chipmate-directory": temporary.path, "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
          if (!response.ok) throw new Error(`接口失败 ${response.status}：${await response.text()}`)
          const text = await response.text()
          return text ? JSON.parse(text) : undefined
        }
        const session = await api("/session", { title: "中途停止验收" })
        await api(`/session/${session.id}/prompt_async`, {
          agent: "code",
          model: { providerID: "alibaba", modelID: "qwen-plus" },
          parts: [{ type: "text", text: "把 main.ts 的 value 修改为 2，然后等待我的下一步指示" }],
        })
        try {
          await wait(async () => (await Bun.file(filepath).text()).includes("2") && calls > 1)
        } catch (error) {
          console.error(
            "真实入口诊断",
            JSON.stringify({
              calls,
              messages: await api(`/session/${session.id}/message`),
              questions: await api("/question"),
              permissions: await api("/permission"),
              status: await api("/session/status"),
            }),
          )
          throw error
        }
        await api(`/session/${session.id}/abort`, {})
        const messages = await api(`/session/${session.id}/message`)
        const user = messages.find((message: { info: { role: string } }) => message.info.role === "user")
        const url = `/session/${session.id}/turn-changes/${user.info.id}`
        let review: Result | undefined
        await wait(async () => {
          review = await api(url)
          return review?.summary?.phase === "ready"
        })
        expect(review?.summary?.outcome).toBe("interrupted")
        expect(review?.summary?.files.map((file) => file.file)).toEqual(["main.ts"])
        expect(review?.summary?.canRevert).toBe(true)
        const detail: Result = await api(`${url}/file/${review!.summary!.files[0]!.id}`)
        expect(detail.detail?.patch).toContain("+const value = 2")
        const undo: Result = await api(url, {
          revision: review!.summary!.revision,
          requestID: "真实撤销",
          action: "revert",
        })
        expect(undo.ok).toBe(true)
        expect(await Bun.file(filepath).text()).toBe("const value = 1\n")
        const restore: Result = await api(url, {
          revision: undo.summary!.revision,
          requestID: "真实恢复",
          action: "restore",
        })
        expect(restore.ok).toBe(true)
        expect(await Bun.file(filepath).text()).toBe("const value = 2\n")
        expect(await api(`/session/${session.id}/message`)).toEqual(messages)
        await Server.Default().app.request(`/session/${session.id}`, {
          method: "DELETE",
          headers: { "x-chipmate-directory": temporary.path },
        })
      })()
    } finally {
      provider.stop(true)
      for (const key of ["NO_PROXY", "no_proxy"] as const) {
        if (proxy[key] === undefined) delete process.env[key]
        else process.env[key] = proxy[key]
      }
    }
  },
  60_000,
)
