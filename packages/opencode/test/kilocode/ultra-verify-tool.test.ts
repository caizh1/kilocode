import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

const root = path.resolve(import.meta.dir, "../..")
const schema = z.object({
  max: z.number(),
  calls: z.array(
    z.object({
      type: z.string(),
      prompt: z.string(),
      readonly: z.boolean(),
      internal: z.boolean(),
    }),
  ),
  phase: z.string(),
  answer: z.string(),
  sessions: z.number(),
})

const script = `
import { Effect } from "effect"
import { Agent } from "./src/agent/agent.ts"
import { UltraVerify } from "./src/kilocode/agent/ultra-verify.ts"
import { UltraVerifyTool } from "./src/kilocode/tool/ultra-verify.ts"
import { MessageID, SessionID } from "./src/session/schema.ts"
import { Parameters } from "./src/tool/task.ts"
import { Tool } from "./src/tool/tool.ts"
import { Truncate } from "./src/tool/truncate.ts"
import { disposeAllInstances, disposeTestRuntime, provideInstance, testInstanceStoreLayer, tmpdir } from "./test/fixture/fixture.ts"

await using dir = await tmpdir({})
const sessionID = SessionID.make("ses_ultra_verify_tool")
const userID = MessageID.make("msg_ultra_verify_tool_user")
const calls = []
let active = 0
let max = 0
let count = 0
const task = {
  id: "task",
  description: "test task",
  parameters: Parameters,
  execute(params, ctx) {
    return Effect.gen(function* () {
      active++
      max = Math.max(max, active)
      calls.push({
        type: params.subagent_type,
        prompt: params.prompt,
        readonly: ctx.extra?.ultraCouncilReadOnly === true,
        internal: ctx.extra?.ultraVerificationInternal === true,
      })
      if (params.subagent_type === "explore") yield* Effect.sleep("30 millis")
      active--
      count++
      const output =
        params.subagent_type === "ultra-code-baseline"
          ? "Frozen Code answer"
          : params.subagent_type === "explore"
            ? "Verifier " + count + " source findings"
            : "Independent synthesized answer"
      return {
        title: params.description,
        metadata: { sessionId: "ses_child_" + count },
        output: "<task_result>\\n" + output + "\\n</task_result>",
      }
    })
  },
}
const result = await Effect.runPromise(
  provideInstance(dir.path)(
    Effect.gen(function* () {
      const info = yield* UltraVerifyTool(task)
      const tool = yield* Tool.init(info)
      const ctx = {
        sessionID,
        messageID: MessageID.make("msg_ultra_verify_tool_assistant"),
        agent: "ultra",
        abort: new AbortController().signal,
        callID: "call_ultra_verify",
        messages: [
          {
            info: {
              id: userID,
              sessionID,
              role: "user",
              time: { created: 1 },
              agent: "ultra",
              model: { providerID: "test", modelID: "model" },
            },
            parts: [
              {
                id: "prt_user",
                messageID: userID,
                sessionID,
                type: "text",
                text: "Trace the request path.",
              },
            ],
          },
        ],
        metadata: () => Effect.void,
        ask: () => Effect.void,
        extra: {},
      }
      const output = yield* tool.execute({ requestKind: "analysis" }, ctx)
      const state = UltraVerify.load({ sessionID, messageID: userID, messages: ctx.messages })
      return {
        max,
        calls,
        phase: output.metadata.ultraVerify.phase,
        answer: JSON.parse(output.output.slice("ULTRA_VERIFY_RESULT\\n".length)).answer,
        sessions: output.metadata.ultraVerify.sessions.length,
      }
    }),
  ).pipe(
    Effect.provide(Agent.defaultLayer),
    Effect.provide(Truncate.defaultLayer),
    Effect.provide(testInstanceStoreLayer),
  ),
)
await disposeAllInstances()
await disposeTestRuntime()
process.stdout.write(JSON.stringify(result), () => process.exit(0))
`

describe("Ultra verification tool", () => {
  test("runs one Code author, three parallel verifiers, and one Ask synthesizer", async () => {
    const storage = path.join(os.tmpdir(), `chipmate-ultra-verify-tool-${Math.random().toString(36).slice(2)}`)
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: root,
      env: {
        ...process.env,
        KILO_PRODUCT_PROFILE: "chipmate-v2",
        KILO_STORAGE_ROOT: storage,
        KILO_VSCODE_GLOBAL_STORAGE: storage,
        KILO_CONFIG_CONTENT: "{}",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]).finally(() => fs.rm(storage, { recursive: true, force: true }))
    expect(status, stderr).toBe(0)
    const start = stdout.lastIndexOf('{"max":')
    const output = schema.parse(JSON.parse(stdout.slice(start)))
    expect(output.max).toBe(3)
    expect(output.calls.map((item) => item.type)).toEqual([
      "ultra-code-baseline",
      "explore",
      "explore",
      "explore",
      "ultra-synthesizer",
    ])
    expect(output.calls.every((item) => item.readonly)).toBe(true)
    expect(output.calls[0]?.internal).toBe(true)
    expect(output.calls.at(-1)?.internal).toBe(true)
    expect(output.calls.slice(1, 4).every((item) => item.prompt.includes("Code 的有界工具调查轨迹"))).toBe(true)
    expect(output.calls.slice(1, 4).every((item) => !item.prompt.includes("深化调查"))).toBe(true)
    expect(output.calls.at(-1)?.prompt).toContain("不使用 Council、投票或结构化协议")
    expect(output.phase).toBe("complete")
    expect(output.answer).toBe("Independent synthesized answer")
    expect(output.sessions).toBe(5)
  })
})
