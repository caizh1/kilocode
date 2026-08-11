import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { LLMEvent, Usage, type LLMEvent as Event } from "@opencode-ai/llm"
import { Database } from "@opencode-ai/core/database/database"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Reference } from "@opencode-ai/core/reference"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { Agent as AgentSvc, type Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Image } from "../../src/image/image"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import type { Provider } from "../../src/provider/provider"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { SyncEvent } from "../../src/sync"
import { provideTmpdirProject } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const ref = {
  providerID: ProviderV2.ID.make("chipmate"),
  modelID: ModelV2.ID.make("deepseek-v4-flash"),
}

class TestLLM extends Context.Service<
  TestLLM,
  {
    readonly reply: (...events: Event[]) => Effect.Effect<void>
  }
>()("@test/SessionProcessorThinkingLLM") {}

function model(): Provider.Model {
  return {
    id: ref.modelID,
    providerID: ref.providerID,
    name: "DeepSeek V4 Flash",
    limit: { context: 128000, output: 4096 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: true,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: { field: "reasoning_content" },
    },
    api: {
      id: "deepseek-v4-flash",
      npm: "@ai-sdk/openai-compatible",
      url: "https://example.test/v1",
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "",
  }
}

function agent(): Agent.Info {
  return {
    name: "code",
    mode: "primary",
    permission: [],
    options: {},
  }
}

const llm = Layer.unwrap(
  Effect.gen(function* () {
    const queue: Stream.Stream<Event, unknown>[] = []
    const reply = (...events: Event[]) => {
      queue.push(Stream.make(...events))
      return Effect.void
    }
    return Layer.mergeAll(
      Layer.succeed(
        LLM.Service,
        LLM.Service.of({
          stream: () => queue.shift() ?? Stream.empty,
        }),
      ),
      Layer.succeed(TestLLM, TestLLM.of({ reply })),
    )
  }),
)

const reference = Layer.mock(Reference.Service, {
  list: () => Effect.succeed([]),
})
const status = Layer.mergeAll(SessionStatus.defaultLayer, Bus.layer)
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.defaultLayer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  RuntimeFlags.layer(),
  reference,
  SessionSummary.defaultLayer,
  Image.defaultLayer,
  SyncEvent.defaultLayer,
  EventV2Bridge.defaultLayer,
  Database.defaultLayer,
  status,
  llm,
).pipe(Layer.provideMerge(infra))
const env = SessionProcessor.layer.pipe(Layer.provideMerge(deps), Layer.provide(reference))

const it = testEffect(env)

describe("session processor DeepSeek V4 thinking compatibility", () => {
  it.effect("stores content think tags as reasoning before the final answer", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const test = yield* TestLLM
          const processors = yield* SessionProcessor.Service
          const session = yield* Session.Service
          const usage = new Usage({ inputTokens: 19, outputTokens: 2, totalTokens: 21, reasoningTokens: 0 })

          yield* test.reply(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: "text" }),
            LLMEvent.textDelta({ id: "text", text: "<think>\n我们" }),
            LLMEvent.textDelta({ id: "text", text: "需要计算。" }),
            LLMEvent.textDelta({ id: "text", text: "\n</think>\n" }),
            LLMEvent.textDelta({ id: "text", text: "323" }),
            LLMEvent.textEnd({ id: "text" }),
            LLMEvent.stepFinish({ index: 0, reason: "stop", usage }),
            LLMEvent.finish({ reason: "stop", usage }),
          )

          const chat = yield* session.create({})
          const parent = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: chat.id,
            agent: "code",
            model: ref,
            time: { created: Date.now() },
          })
          const msg: MessageV2.Assistant = {
            id: MessageID.ascending(),
            role: "assistant",
            sessionID: chat.id,
            parentID: parent.id,
            mode: "code",
            agent: "code",
            path: { cwd: path.resolve(dir), root: path.resolve(dir) },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ref.modelID,
            providerID: ref.providerID,
            time: { created: Date.now() },
          }
          yield* session.updateMessage(msg)

          const mdl = model()
          const handle = yield* processors.create({
            assistantMessage: msg,
            sessionID: chat.id,
            model: mdl,
          })

          yield* handle.process({
            user: parent as MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [],
            tools: {},
          })

          const parts = yield* MessageV2.parts(msg.id)
          expect(parts.map((part) => part.type)).toEqual(["step-start", "reasoning", "text", "step-finish"])
          expect(parts.find((part) => part.type === "reasoning")?.text).toBe("\n我们需要计算。\n")
          expect(parts.find((part) => part.type === "text")?.text).toBe("323")
        }),
      { git: true },
    ),
  )
})
