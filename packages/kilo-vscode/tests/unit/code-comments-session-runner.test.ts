import { describe, expect, it } from "bun:test"
import { CodeCommentCancelledError, CodeCommentSessionRunner } from "../../src/services/code-comments/session-runner"

function runtime(options: { cancel?: boolean } = {}) {
  const calls = {
    create: [] as unknown[],
    prompt: [] as unknown[],
    abort: [] as unknown[],
    delete: [] as unknown[],
  }
  let listener: ((event: unknown) => void) | undefined
  let cancellation: (() => void) | undefined
  const assistant = {
    info: {
      role: "assistant",
      providerID: "provider",
      modelID: "main",
      structured: undefined,
    },
    parts: [{ type: "text", text: "结论：无需注释\n理解：函数已经足够直白。" }],
  }
  const client = {
    session: {
      create: async (input: unknown) => {
        calls.create.push(input)
        return { data: { id: "temporary-session" } }
      },
      promptAsync: async (input: unknown) => {
        calls.prompt.push(input)
        queueMicrotask(() => {
          if (options.cancel) {
            cancellation?.()
            return
          }
          listener?.({
            type: "session.status",
            properties: { sessionID: "temporary-session", status: { type: "busy" } },
          })
          listener?.({
            type: "session.status",
            properties: { sessionID: "temporary-session", status: { type: "idle" } },
          })
        })
      },
      messages: async () => ({ data: [assistant] }),
      abort: async (input: unknown) => {
        calls.abort.push(input)
      },
      delete: async (input: unknown) => {
        calls.delete.push(input)
      },
    },
  }
  const connection = {
    getClientAsync: async () => client,
    onEventFiltered: (filter: (event: unknown) => boolean, handler: (event: unknown) => void) => {
      listener = (event) => {
        if (filter(event)) handler(event)
      }
      return () => {
        listener = undefined
      }
    },
  }
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (callback: () => void) => {
      cancellation = callback
      return { dispose: () => (cancellation = undefined) }
    },
  }
  return { calls, connection, token }
}

describe("高可信代码注释临时 Code 会话", () => {
  it("使用只读权限和原始 Code QA，并在成功后删除会话", async () => {
    const state = runtime()
    const runner = new CodeCommentSessionRunner(state.connection as never, () => undefined)

    const result = await runner.run({
      directory: "/repo",
      activeFile: "/repo/main.c",
      prompt: "分析当前函数",
      stage: "primary",
      functionHash: "hash",
      timeoutMs: 1000,
      token: state.token as never,
    })

    expect(result).toEqual({
      output: "结论：无需注释\n理解：函数已经足够直白。",
      providerID: "provider",
      modelID: "main",
      sessionID: "temporary-session",
    })
    const create = state.calls.create[0] as {
      agent: string
      metadata: Record<string, unknown>
      permission: Array<{ permission: string; action: string }>
    }
    expect(create.agent).toBe("code")
    expect(create.metadata.ephemeral).toBe(true)
    expect(create.permission).toContainEqual({ permission: "*", pattern: "*", action: "deny" })
    expect(create.permission).toContainEqual({ permission: "read", pattern: "*", action: "allow" })
    const prompt = state.calls.prompt[0] as {
      format?: unknown
      system: string
      tools: Record<string, boolean>
      editorContext: { activeFile: string }
    }
    expect(prompt.format).toBeUndefined()
    expect(prompt.system).toContain("先理解函数")
    expect(prompt.tools.edit).toBe(false)
    expect(prompt.tools.bash).toBe(false)
    expect(prompt.tools.question).toBe(false)
    expect(prompt.tools.read).toBe(true)
    expect(prompt.editorContext.activeFile).toBe("/repo/main.c")
    expect(state.calls.delete).toEqual([{ sessionID: "temporary-session", directory: "/repo" }])
  })

  it("取消时中止并删除临时会话", async () => {
    const state = runtime({ cancel: true })
    const runner = new CodeCommentSessionRunner(state.connection as never, () => undefined)

    const task = runner.run({
      directory: "/repo",
      activeFile: "/repo/main.c",
      prompt: "分析当前函数",
      stage: "primary",
      functionHash: "hash",
      timeoutMs: 1000,
      token: state.token as never,
    })

    await expect(task).rejects.toBeInstanceOf(CodeCommentCancelledError)
    expect(state.calls.abort).toEqual([{ sessionID: "temporary-session", directory: "/repo" }])
    expect(state.calls.delete).toEqual([{ sessionID: "temporary-session", directory: "/repo" }])
  })
})
