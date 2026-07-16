import { expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Effect, Layer } from "effect"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

void Log.init({ print: false })

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}
const target = "/home/caizh/ufs3030_fw/gcc_build/mpbl/build/mpbl.map"
const orphan =
  `Let me start extracting info. <｜DSML｜parameter name="filePath" string="true">${target}</｜DSML｜parameter> ` +
  `<｜DSML｜parameter name="limit" string="false">500</｜DSML｜parameter> ` +
  `<｜DSML｜parameter name="offset" string="false">5780</｜DSML｜parameter> </｜DSML｜invoke>`
const warning = "The model returned an incomplete tool call twice. No tool was executed; automatic DSML repair stopped."

function config(url: string) {
  return {
    $schema: "https://app.kilo.ai/config.json",
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: url,
        },
      },
    },
    experimental: {
      dsml_tool_call_repair: {
        enabled: true,
        model: "test/test-model",
      },
    },
  }
}

const boot = Effect.fn("test.boot")(function* () {
  const test = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* Effect.promise(() => Bun.write(path.join(test.directory, "opencode.json"), JSON.stringify(config(llm.url))))

  const prompt = yield* SessionPrompt.Service
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({
    title: "Pinned",
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  })
  yield* prompt.prompt({
    sessionID: chat.id,
    model: ref,
    agent: "build",
    noReply: true,
    tools: { invalid: false },
    parts: [{ type: "text", text: "inspect the map" }],
  })
  return { llm, prompt, sessions, chat }
})

function retries(messages: SessionV1.WithParts[]) {
  return messages
    .flatMap((message) => message.parts)
    .filter(
      (part): part is SessionV1.ToolPart & { state: SessionV1.ToolStateCompleted } =>
        part.type === "tool" && part.tool === "invalid" && part.state.status === "completed",
    )
}

const it = testEffect(Layer.mergeAll(TestLLMServer.layer, SessionPrompt.defaultLayer, Session.defaultLayer))

it.instance(
  "continues the session after repairing an orphan that ends after invoke",
  () =>
    Effect.gen(function* () {
      const app = yield* boot()
      yield* app.llm.push(reply().text(orphan).stop(), reply().text("continued").stop())

      const result = yield* app.prompt.loop({ sessionID: app.chat.id })

      expect(yield* app.llm.calls).toBe(2)
      expect(yield* app.llm.pending).toBe(0)
      expect(result.info.role).toBe("assistant")
      if (result.info.role === "assistant") {
        expect(result.info.finish).toBe("stop")
        expect(result.parts.some((part) => part.type === "text" && part.text === "continued")).toBe(true)
      }

      const messages = yield* app.sessions.messages({ sessionID: app.chat.id })
      const invalid = retries(messages)
      expect(invalid).toHaveLength(1)
      expect(invalid[0].state.input).toMatchObject({ tool: "kilo_dsml_orphan_retry" })
      expect(invalid[0].state.output).toContain("The arguments provided to the tool are invalid")
      expect(invalid[0].state.output).toContain("Reissue exactly one normal structured tool call")
      expect(invalid[0].state.output).not.toContain(target)

      const saved = JSON.stringify(messages)
      expect(saved).toContain("Let me start extracting info.")
      expect(saved).not.toContain("<｜DSML｜parameter")
      expect(saved).not.toContain(target)

      const inputs = yield* app.llm.inputs
      expect(inputs).toHaveLength(2)
      expect(inputs.every((input) => !JSON.stringify(input.tools).includes("invalid"))).toBe(true)
      expect(JSON.stringify(inputs[1]?.messages)).toContain("kilo_dsml_orphan_retry")
      expect(JSON.stringify(inputs[1]?.messages)).toContain("The arguments provided to the tool are invalid")
      expect(JSON.stringify(inputs[1]?.messages)).not.toContain(target)
    }),
  { git: true },
)

it.instance(
  "stops after the second terminal orphan without a third provider request",
  () =>
    Effect.gen(function* () {
      const app = yield* boot()
      yield* app.llm.push(reply().text(orphan).stop(), reply().text(orphan).stop())

      const result = yield* app.prompt.loop({ sessionID: app.chat.id })

      expect(yield* app.llm.calls).toBe(2)
      expect(yield* app.llm.pending).toBe(0)
      expect(result.info.role).toBe("assistant")
      if (result.info.role === "assistant") {
        expect(result.info.finish).toBe("stop")
        expect(result.parts.some((part) => part.type === "text" && part.text.includes(warning))).toBe(true)
      }

      const messages = yield* app.sessions.messages({ sessionID: app.chat.id })
      expect(retries(messages)).toHaveLength(1)
      const saved = JSON.stringify(messages)
      expect(saved).toContain(warning)
      expect(saved).not.toContain("<｜DSML｜parameter")
      expect(saved).not.toContain(target)
    }),
  { git: true },
)
