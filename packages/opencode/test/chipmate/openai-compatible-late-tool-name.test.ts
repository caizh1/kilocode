import { describe, expect, test } from "bun:test"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { stepCountIs, streamText, tool } from "ai"
import { z } from "zod"

type Chunk = Record<string, unknown>

function chunk(delta: Record<string, unknown>, finish?: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  } satisfies Chunk
}

function response(chunks: Chunk[]) {
  const body = [...chunks.map((item) => `data: ${JSON.stringify(item)}`), "data: [DONE]"].join("\n\n") + "\n\n"
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

function finalResponse() {
  return response([
    chunk({ role: "assistant" }),
    chunk({ reasoning_content: "工具已经执行，继续完成回答。" }),
    chunk({ content: "处理完成" }),
    chunk({}, "stop"),
  ])
}

function harness(first: Chunk[]) {
  const requests: unknown[] = []
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)))
    if (requests.length === 1) return response(first)
    if (requests.length === 2) return finalResponse()
    throw new Error(`收到非预期的第 ${requests.length} 次模型请求`)
  }) as unknown as typeof fetch
  const provider = createOpenAICompatible({
    name: "late-tool-name-test",
    baseURL: "https://example.test/v1",
    apiKey: "test-key",
    fetch: fetcher,
  })
  return { model: provider.chatModel("qwen3.8-27b-fp8"), requests }
}

function lateToolCall() {
  return [
    chunk({ role: "assistant", content: null }),
    chunk({
      tool_calls: [{ index: 0, id: "call_bash", type: "function", function: { arguments: "" } }],
    }),
    chunk({
      tool_calls: [{ index: 0, id: "call_bash", type: "function", function: { name: "bash", arguments: "{" } }],
    }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"command"' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: ':"pwd"}' } }] }),
    chunk({}, "tool_calls"),
  ]
}

describe("OpenAI-Compatible 延迟工具名流", () => {
  test("等待后续 function.name，执行工具一次并继续下一轮推理", async () => {
    const calls: string[] = []
    const runtime = harness(lateToolCall())
    const result = streamText({
      model: runtime.model,
      prompt: "运行 pwd 后继续回答",
      maxRetries: 0,
      stopWhen: stepCountIs(2),
      tools: {
        bash: tool({
          description: "运行命令",
          inputSchema: z.object({ command: z.string() }),
          execute: async ({ command }) => {
            calls.push(command)
            return { output: "/workspace" }
          },
        }),
      },
    })

    expect(await result.text).toBe("处理完成")
    expect(calls).toEqual(["pwd"])
    expect(runtime.requests).toHaveLength(2)
  })

  test("保持首个分片已带工具名的正常行为", async () => {
    const calls: string[] = []
    const runtime = harness([
      chunk({ role: "assistant" }),
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_bash",
            type: "function",
            function: { name: "bash", arguments: '{"command":"pwd"}' },
          },
        ],
      }),
      chunk({}, "tool_calls"),
    ])
    const result = streamText({
      model: runtime.model,
      prompt: "运行 pwd 后继续回答",
      maxRetries: 0,
      stopWhen: stepCountIs(2),
      tools: {
        bash: tool({
          description: "运行命令",
          inputSchema: z.object({ command: z.string() }),
          execute: async ({ command }) => {
            calls.push(command)
            return { output: "/workspace" }
          },
        }),
      },
    })

    expect(await result.text).toBe("处理完成")
    expect(calls).toEqual(["pwd"])
    expect(runtime.requests).toHaveLength(2)
  })

  test("按 index 隔离并执行多个延迟工具调用", async () => {
    const calls: string[] = []
    const runtime = harness([
      chunk({ role: "assistant" }),
      chunk({
        tool_calls: [
          { index: 0, id: "call_first", type: "function", function: { arguments: "" } },
          { index: 1, id: "call_second", type: "function", function: { arguments: "" } },
        ],
      }),
      chunk({
        tool_calls: [
          { index: 0, function: { name: "record", arguments: '{"value":"first"}' } },
          { index: 1, function: { name: "record", arguments: '{"value":"second"}' } },
        ],
      }),
      chunk({}, "tool_calls"),
    ])
    const result = streamText({
      model: runtime.model,
      prompt: "记录两个值后继续回答",
      maxRetries: 0,
      stopWhen: stepCountIs(2),
      tools: {
        record: tool({
          description: "记录值",
          inputSchema: z.object({ value: z.string() }),
          execute: async ({ value }) => {
            calls.push(value)
            return { recorded: value }
          },
        }),
      },
    })

    expect(await result.text).toBe("处理完成")
    expect(calls.sort()).toEqual(["first", "second"])
    expect(runtime.requests).toHaveLength(2)
  })

  test("流结束仍缺少工具名时不执行工具且不自动重放", async () => {
    let executions = 0
    const runtime = harness([
      chunk({ role: "assistant" }),
      chunk({
        tool_calls: [{ index: 0, id: "call_missing", type: "function", function: { arguments: "{}" } }],
      }),
      chunk({}, "tool_calls"),
    ])
    const result = streamText({
      model: runtime.model,
      prompt: "调用工具",
      maxRetries: 0,
      stopWhen: stepCountIs(2),
      tools: {
        bash: tool({
          description: "运行命令",
          inputSchema: z.object({}),
          execute: async () => {
            executions += 1
            return { output: "不应执行" }
          },
        }),
      },
    })

    let failure: unknown
    try {
      for await (const part of result.fullStream) {
        if (part.type === "error") failure = part.error
      }
    } catch (error) {
      failure = error
    }

    expect(String(failure)).toContain("Expected 'function.name' to be a string")
    expect(executions).toBe(0)
    expect(runtime.requests).toHaveLength(1)
  })
})
