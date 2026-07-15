import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { LLMEvent, type LLMEvent as Event } from "@opencode-ai/llm"
import { Database } from "@opencode-ai/core/database/database"
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
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Reference } from "../../src/reference/reference"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { SyncEvent } from "../../src/sync"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import * as Log from "@opencode-ai/core/util/log"
import { provideTmpdirProject } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

type Script = Stream.Stream<Event, unknown>

class TestLLM extends Context.Service<
  TestLLM,
  {
    readonly reply: (...items: Event[]) => Effect.Effect<void>
  }
>()("@test/ThinkingLLM") {}

function model(): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: { context: 128000, output: 4096 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: true,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai" },
    options: {},
  } as Provider.Model
}

function usage() {
  return {
    inputTokens: 100,
    outputTokens: 41,
    totalTokens: 141,
  }
}

const llm = Layer.unwrap(
  Effect.gen(function* () {
    const queue: Script[] = []
    const reply = (...items: Event[]) => {
      queue.push(Stream.make(...items))
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

const reference = Layer.mock(Reference.Service)({
  init: () => Effect.void,
  list: () => Effect.succeed([]),
  get: () => Effect.succeed(undefined),
  ensure: () => Effect.void,
  contains: () => Effect.succeed(false),
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

function textDelta(text: string): Event {
  return LLMEvent.textDelta({ id: "text", text })
}

function agent(): Agent.Info {
  return { name: "code", mode: "primary", permission: [], options: {} }
}

describe("session processor thinking stream", () => {
  it.effect("turns text think tags into reasoning parts", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const test = yield* TestLLM
          const processors = yield* SessionProcessor.Service
          const session = yield* Session.Service

          yield* test.reply(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: "text" }),
            textDelta("visible <thi"),
            textDelta("nk>checking local context</thi"),
            textDelta("nk> answer"),
            LLMEvent.textEnd({ id: "text" }),
            LLMEvent.stepFinish({ index: 0, reason: "stop", usage: usage() }),
            LLMEvent.finish({ reason: "stop", usage: usage() }),
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
          const text = parts
            .filter((part): part is MessageV2.TextPart => part.type === "text")
            .map((part) => part.text)
            .join("")
          const reasoning = parts
            .filter((part): part is MessageV2.ReasoningPart => part.type === "reasoning")
            .map((part) => part.text)

          expect(text).toBe("visible  answer")
          expect(text).not.toContain("<think>")
          expect(reasoning).toEqual(["checking local context"])
        }),
      { git: true },
    ),
  )

  it.effect("keeps provider-native reasoning events structured", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const test = yield* TestLLM
          const processors = yield* SessionProcessor.Service
          const session = yield* Session.Service

          yield* test.reply(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.reasoningStart({ id: "reasoning" }),
            LLMEvent.reasoningDelta({ id: "reasoning", text: "<think>native</think>" }),
            LLMEvent.reasoningEnd({ id: "reasoning" }),
            LLMEvent.stepFinish({ index: 0, reason: "stop", usage: usage() }),
            LLMEvent.finish({ reason: "stop", usage: usage() }),
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

          const reasoning = (yield* MessageV2.parts(msg.id))
            .filter((part): part is MessageV2.ReasoningPart => part.type === "reasoning")
            .map((part) => part.text)

          expect(reasoning).toEqual(["<think>native</think>"])
        }),
      { git: true },
    ),
  )
})
