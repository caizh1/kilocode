import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { Deferred, Effect, Fiber, Layer, ManagedRuntime } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as Stream from "effect/Stream"
import { LLMEvent, type LLMEvent as Event } from "@opencode-ai/llm"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { disposeTestRuntime, provideTestInstance } from "../fixture/fixture"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ChipMateCompactionChunks } from "../../src/chipmate/session/compaction-chunks"
import { ChipMateCompactionStatus } from "../../src/chipmate/session/compaction-status"
import { ChipMateSessionCompaction } from "../../src/chipmate/session/compaction"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionCompaction } from "../../src/session/compaction"
import * as SessionProcessorModule from "../../src/session/processor"
import type { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Session as SessionNs } from "../../src/session/session"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { ProviderTest } from "../fake/provider"
import { tmpdir } from "../fixture/fixture"
import { Flag } from "@opencode-ai/core/flag/flag"
import { AppRuntime } from "../../src/effect/app-runtime"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { makeRuntime } from "../../src/effect/run-service"
import { remove as cleanup } from "./cleanup"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Provider } from "../../src/provider/provider"
import { Token } from "../../src/util/token"

const providerID = ProviderV2.ID.make("test")
const modelID = ModelV2.ID.make("test-model")
const ref = { providerID, modelID }
const agents = Layer.mock(Agent.Service)({
  get: () => Effect.succeed({ name: "compaction", mode: "primary", permission: [], options: {} } satisfies Agent.Info),
})
const previous = Flag.CHIPMATE_DB
const dbfile = path.join(os.tmpdir(), `chipmate-compaction-chunks-${process.pid}-${crypto.randomUUID()}.db`)
const layer = LayerNode.compile(LayerNode.group([SessionNs.node, SessionProjector.node]))
const runtime = makeRuntime(SessionNs.Service, layer)

beforeAll(async () => {
  await fs.rm(dbfile, { force: true })
  Flag.CHIPMATE_DB = dbfile
})

afterAll(async () => {
  await runtime.dispose()
  await AppRuntime.dispose()
  await disposeTestRuntime()
  Flag.CHIPMATE_DB = previous
  await Promise.all([dbfile, `${dbfile}-wal`, `${dbfile}-shm`].map(cleanup))
})

const store = {
  updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.promise(() => svc.updateMessage(msg)),
  updatePart: <T extends MessageV2.Part>(part: T) => Effect.promise(() => svc.updatePart(part)),
}

const svc = {
  create(input?: SessionNs.CreateInput) {
    return runtime.runPromise((svc) => svc.create(input))
  },
  messages(input: Parameters<SessionNs.Interface["messages"]>[0]) {
    return runtime.runPromise((svc) => svc.messages(input))
  },
  updateMessage<T extends MessageV2.Info>(msg: T) {
    return runtime.runPromise((svc) => svc.updateMessage(msg))
  },
  updatePart<T extends MessageV2.Part>(part: T) {
    return runtime.runPromise((svc) => svc.updatePart(part))
  },
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

async function user(sessionID: SessionID, text: string, variant?: string) {
  const msg = await svc.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { ...ref, variant },
    time: { created: Date.now() },
  })
  await svc.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
}

async function assistant(sessionID: SessionID, parentID: MessageID, root: string, text: string) {
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID,
    providerID,
    parentID,
    time: { created: Date.now() },
    finish: "stop",
  }
  await svc.updateMessage(msg)
  await svc.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
}

function llm() {
  const queue: Array<Stream.Stream<Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<Event, unknown>)> = []

  return {
    push(stream: Stream.Stream<Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<Event, unknown>)) {
      queue.push(stream)
    },
    layer: Layer.succeed(
      LLM.Service,
      LLM.Service.of({
        stream: (input) => {
          const item = queue.shift() ?? Stream.empty
          const stream = typeof item === "function" ? item(input) : item
          return stream.pipe(Stream.mapEffect((event) => Effect.succeed(event)))
        },
      }),
    ),
  }
}

function reply(text: string, capture?: (input: LLM.StreamInput) => void) {
  return (input: LLM.StreamInput) => {
    capture?.(input)
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    return Stream.make(
      LLMEvent.textStart({ id: "txt-0" }),
      LLMEvent.textDelta({ id: "txt-0", text }),
      LLMEvent.textEnd({ id: "txt-0" }),
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage }),
      LLMEvent.finish({ reason: "stop", usage }),
    )
  }
}

function lengthReply(text: string, capture?: (input: LLM.StreamInput) => void) {
  return (input: LLM.StreamInput) => {
    capture?.(input)
    const usage = { inputTokens: 1, outputTokens: 1_000, totalTokens: 1_001 }
    return Stream.make(
      LLMEvent.reasoningStart({ id: "reasoning-0" }),
      LLMEvent.reasoningDelta({ id: "reasoning-0", text: "内部推理".repeat(1_700) }),
      LLMEvent.reasoningEnd({ id: "reasoning-0" }),
      LLMEvent.textStart({ id: "txt-0" }),
      LLMEvent.textDelta({ id: "txt-0", text }),
      LLMEvent.textEnd({ id: "txt-0" }),
      LLMEvent.stepFinish({ index: 0, reason: "length", usage }),
      LLMEvent.finish({ reason: "length", usage }),
    )
  }
}

function lengthTextReply(text: string, capture?: (input: LLM.StreamInput) => void) {
  return (input: LLM.StreamInput) => {
    capture?.(input)
    const usage = { inputTokens: 1, outputTokens: 1_000, totalTokens: 1_001 }
    return Stream.make(
      LLMEvent.textStart({ id: "txt-0" }),
      LLMEvent.textDelta({ id: "txt-0", text }),
      LLMEvent.textEnd({ id: "txt-0" }),
      LLMEvent.stepFinish({ index: 0, reason: "length", usage }),
      LLMEvent.finish({ reason: "length", usage }),
    )
  }
}

function emptyStopReply(capture?: (input: LLM.StreamInput) => void) {
  return (input: LLM.StreamInput) => {
    capture?.(input)
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    return Stream.make(
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage }),
      LLMEvent.finish({ reason: "stop", usage }),
    )
  }
}

function reasoningStopReply(capture?: (input: LLM.StreamInput) => void) {
  return (input: LLM.StreamInput) => {
    capture?.(input)
    const usage = { inputTokens: 1, outputTokens: 379, totalTokens: 380 }
    return Stream.make(
      LLMEvent.reasoningStart({ id: "reasoning-0" }),
      LLMEvent.reasoningDelta({ id: "reasoning-0", text: "内部推理".repeat(440) }),
      LLMEvent.reasoningEnd({ id: "reasoning-0" }),
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage }),
      LLMEvent.finish({ reason: "stop", usage }),
    )
  }
}

function blockingReply(ready: Deferred.Deferred<void>, capture?: (input: LLM.StreamInput) => void) {
  return (input: LLM.StreamInput) => {
    capture?.(input)
    return Stream.concat(
      Stream.make(
        LLMEvent.reasoningStart({ id: "reasoning-0" }),
        LLMEvent.reasoningDelta({ id: "reasoning-0", text: "partial reasoning" }),
        LLMEvent.textStart({ id: "txt-0" }),
        LLMEvent.textDelta({ id: "txt-0", text: "partial summary" }),
      ),
      Stream.fromEffect(Deferred.succeed(ready, undefined).pipe(Effect.flatMap(() => Effect.never))),
    )
  }
}

function fakeRuntime(
  outputTokenMax?: number,
  error?: MessageV2.Assistant["error"],
  empty = false,
  reasoningOnly = false,
  withNone = false,
  reasoningCall?: number,
  reasoningStage?: "chunk" | "reduce",
  context = 10_000,
  contextOverflowCall?: number,
) {
  const calls: string[] = []
  const outputs: number[] = []
  const variants: Array<string | undefined> = []
  const processor = Layer.effect(
    SessionProcessorModule.SessionProcessor.Service,
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      return SessionProcessorModule.SessionProcessor.Service.of({
        create: Effect.fn("TestSessionProcessor.create")((input) =>
          Effect.succeed({
            get message() {
              return input.assistantMessage
            },
            updateToolCall: Effect.fn("TestSessionProcessor.updateToolCall")(() => Effect.succeed(undefined)),
            metadata: Effect.fn("TestSessionProcessor.metadata")(() => Effect.void),
            completeToolCall: Effect.fn("TestSessionProcessor.completeToolCall")(() => Effect.void),
            process: Effect.fn("TestSessionProcessor.process")((stream: LLM.StreamInput) =>
              Effect.gen(function* () {
                outputs.push(input.model.limit.output)
                calls.push(JSON.stringify(stream.messages))
                variants.push(stream.user.model.variant)
                const currentError =
                  error ??
                  (contextOverflowCall === calls.length
                    ? new MessageV2.ContextOverflowError({ message: "provider context overflow" }).toObject()
                    : undefined)
                if (currentError) {
                  input.assistantMessage.error = currentError
                  input.assistantMessage.finish = "error"
                  yield* sessions.updateMessage(input.assistantMessage)
                  return "stop" as const
                }
                const text = stream.messages.some((msg) =>
                  JSON.stringify(msg).includes("Create a new anchored summary"),
                )
                  ? "final summary"
                  : calls.length === 1
                    ? "chunk one"
                    : "chunk two"
                const reduce = stream.messages.some((msg) =>
                  JSON.stringify(msg).includes("Create a new anchored summary"),
                )
                const exhaust =
                  reasoningCall !== undefined
                    ? calls.length === reasoningCall
                    : reasoningStage === "reduce"
                      ? reduce
                      : reasoningStage === "chunk"
                        ? !reduce
                        : true
                if (!empty || stream.user.model.variant === "none")
                  yield* sessions.updatePart({
                    id: PartID.ascending(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    type: "text",
                    text,
                  })
                if (reasoningOnly && stream.user.model.variant !== "none" && exhaust) {
                  yield* sessions.updatePart({
                    id: PartID.ascending(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    type: "reasoning",
                    text: "内部推理".repeat(1_700),
                    time: { start: Date.now(), end: Date.now() },
                  })
                  input.assistantMessage.tokens.reasoning = 2_040
                  input.assistantMessage.finish = "length"
                } else {
                  input.assistantMessage.finish = "stop"
                }
                return "continue" as const
              }),
            ),
          } satisfies SessionProcessor.Handle),
        ),
      })
    }),
  )
  const processorNode = LayerNode.make({
    service: SessionProcessorModule.SessionProcessor.Service,
    layer: processor,
    deps: [SessionNs.node],
  })
  const model = ProviderTest.model({
    providerID,
    id: modelID,
    limit: { context, output: 1_000 },
    variants: {
      high: { thinking: { type: "enabled" } },
      xhigh: { thinking: { type: "enabled" } },
      ...(withNone ? { none: { thinking: { type: "disabled" } } } : {}),
    },
  })
  return {
    calls,
    outputs,
    variants,
    rt: ManagedRuntime.make(
      LayerNode.compile(
        LayerNode.group([SessionCompaction.node, SessionNs.node, SessionProjector.node, Bus.node, EventV2Bridge.node]),
        [
          [SessionProcessorModule.SessionProcessor.node, processorNode],
          [Provider.node, ProviderTest.fake({ model }).layer],
          [Agent.node, agents],
          [RuntimeFlags.node, RuntimeFlags.layer({ outputTokenMax })],
          [
            Config.node,
            Layer.mock(Config.Service)({
              get: () => Effect.succeed({ compaction: { reserved: 1_000 } }),
              directories: () => Effect.succeed([]),
            }),
          ],
        ],
      ),
    ),
  }
}

async function failure(error?: MessageV2.Assistant["error"], empty = false, reasoningOnly = false, withNone = false) {
  await using tmp = await tmpdir()
  return provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const session = await svc.create({})
      await user(session.id, "oversized " + "x".repeat(80_000))
      await Effect.runPromise(
        ChipMateSessionCompaction.create({
          session: store,
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        }),
      )
      const marker = (await svc.messages({ sessionID: session.id })).at(-1)!
      await svc.updatePart(
        ChipMateCompactionStatus.create({
          sessionID: session.id,
          messageID: marker.info.id,
          source: "manual",
        }),
      )

      const { rt, calls, variants } = fakeRuntime(undefined, error, empty, reasoningOnly, withNone)
      try {
        const msgs = await svc.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        const result = await rt.runPromise(
          SessionCompaction.Service.use((svc) =>
            svc.process({
              parentID: parent!,
              messages: msgs,
              sessionID: session.id,
              auto: false,
            }),
          ),
        )
        const all = await svc.messages({ sessionID: session.id })
        const summary = all.find((msg) => msg.info.role === "assistant" && msg.info.summary)
        return { result, summary, messages: all, calls, variants }
      } finally {
        await rt.dispose()
      }
    },
  })
}

function liveRuntime(layer: Layer.Layer<LLM.Service>, context = 10_000, withNone = false) {
  const model = ProviderTest.model({
    providerID,
    id: modelID,
    limit: { context, output: 1_000 },
    variants: {
      high: { thinking: { type: "enabled" } },
      xhigh: { thinking: { type: "enabled" } },
      ...(withNone ? { none: { thinking: { type: "disabled" } } } : {}),
    },
  })
  return ManagedRuntime.make(
    LayerNode.compile(
      LayerNode.group([
        SessionCompaction.node,
        SessionProcessorModule.SessionProcessor.node,
        SessionNs.node,
        SessionProjector.node,
        Bus.node,
        SessionStatus.node,
      ]),
      [
        [SessionSummary.node, summary],
        [Provider.node, ProviderTest.fake({ model }).layer],
        [LLM.node, layer],
        [RuntimeFlags.node, RuntimeFlags.layer()],
        [
          Config.node,
          Layer.mock(Config.Service)({
            get: () => Effect.succeed({ compaction: { reserved: 1_000 } }),
            directories: () => Effect.succeed([]),
          }),
        ],
      ],
    ),
  )
}

afterEach(() => {
  mock.restore()
})

describe("ChipMateCompactionChunks", () => {
  test("splits oversized history into chronological chunks", async () => {
    const model = ProviderTest.model({ providerID, id: modelID, limit: { context: 7_000, output: 1_000 } })
    const sessionID = SessionID.make("ses_chunks_split")
    const messages: MessageV2.WithParts[] = Array.from({ length: 4 }, (_, index) => ({
      info: {
        id: MessageID.ascending(),
        role: "user",
        sessionID,
        agent: "build",
        model: ref,
        time: { created: Date.now() },
      },
      parts: [
        {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID,
          type: "text",
          text: `${index}: ${"x".repeat(8_000)}`,
        },
      ],
    }))

    const chunks = await Effect.runPromise(ChipMateCompactionChunks.split({ messages, model, size: 2_000 }))

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap((chunk) => chunk.messages.map((msg) => msg.info.id))).toEqual(
      messages.map((msg) => msg.info.id),
    )
  })

  test("uses runtime output cap for fallback selection and chunk budget", () => {
    const model = ProviderTest.model({ providerID, id: modelID, limit: { context: 10_000, output: 8_000 } })
    const cfg = {} as Config.Info
    const outputTokenMax = 512

    expect(ChipMateCompactionChunks.needed({ cfg, model, tokens: 5_000, outputTokenMax })).toBe(false)
    expect(ChipMateCompactionChunks.budget({ cfg, model, outputTokenMax })).toBe(6_000)
  })

  test("caps fallback chunks for providers that reject large compaction payloads", () => {
    const model = ProviderTest.model({ providerID, id: modelID, limit: { context: 1_000_000, output: 384_000 } })
    const cfg = {} as Config.Info

    expect(ChipMateCompactionChunks.budget({ cfg, model, outputTokenMax: 32_000 })).toBe(48_000)
  })

  test("uses the safe remaining context as the dynamic worker output budget", () => {
    const model = ProviderTest.model({ providerID, id: modelID, limit: { context: 32_000, output: 32_000 } })

    expect(ChipMateCompactionChunks.outputBudget({ model, estimatedInputTokens: 20_000 })).toMatchObject({
      kind: "available",
      requestedOutputTokenLimit: 32_000,
      effectiveOutputTokenLimit: 9_952,
      capacityKnown: true,
    })
  })

  test("keeps the 48K input cap and configured output cap when capacity metadata is unknown", () => {
    const model = ProviderTest.model({ providerID, id: modelID, limit: { context: 0, output: 0 } })
    const cfg = {} as Config.Info

    expect(ChipMateCompactionChunks.budget({ cfg, model })).toBe(48_000)
    expect(ChipMateCompactionChunks.outputBudget({ model, estimatedInputTokens: 40_000 })).toMatchObject({
      kind: "available",
      requestedOutputTokenLimit: 32_000,
      effectiveOutputTokenLimit: 32_000,
      capacityKnown: false,
    })
    expect(ChipMateCompactionChunks.needed({ cfg, model, tokens: 40_000 })).toBe(true)
    expect(ChipMateCompactionChunks.outputBudget({ model, estimatedInputTokens: 48_001 })).toMatchObject({
      kind: "context_overflow",
      requestedOutputTokenLimit: 32_000,
      capacityKnown: false,
    })
  })

  test("honors a lower runtime cap in a known 128K context", () => {
    const model = ProviderTest.model({ providerID, id: modelID, limit: { context: 128_000, output: 64_000 } })

    expect(
      ChipMateCompactionChunks.outputBudget({ model, estimatedInputTokens: 50_000, outputTokenMax: 8_000 }),
    ).toMatchObject({
      kind: "available",
      requestedOutputTokenLimit: 8_000,
      effectiveOutputTokenLimit: 8_000,
      capacityKnown: true,
    })
  })

  test("rejects input-limit overflow and unsafe remaining context before calling a worker", () => {
    const inputLimited = ProviderTest.model({
      providerID,
      id: modelID,
      limit: { context: 128_000, input: 32_000, output: 8_000 },
    })
    const noHeadroom = ProviderTest.model({
      providerID,
      id: modelID,
      limit: { context: 32_000, output: 8_000 },
    })

    expect(ChipMateCompactionChunks.outputBudget({ model: inputLimited, estimatedInputTokens: 32_001 }).kind).toBe(
      "context_overflow",
    )
    expect(ChipMateCompactionChunks.outputBudget({ model: noHeadroom, estimatedInputTokens: 29_000 }).kind).toBe(
      "context_overflow",
    )
  })

  test("splits only the failed unit after an unknown-capacity provider context overflow", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "unknown capacity " + "x".repeat(200_000))
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )
        const { rt, calls } = fakeRuntime(undefined, undefined, false, false, false, undefined, undefined, 0, 1)
        try {
          const messages = await svc.messages({ sessionID: session.id })
          const parentID = messages.at(-1)?.info.id
          expect(parentID).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((service) =>
              service.process({ parentID: parentID!, messages, sessionID: session.id, auto: false }),
            ),
          )
          const initialCounts = calls.flatMap((call) => {
            const match = call.match(/Summarize conversation chunk \d+ of (\d+)/)
            return match ? [Number(match[1])] : []
          })

          expect(result).toBe("continue")
          expect(calls.length).toBeGreaterThan(Math.max(...initialCounts))
          expect(calls.every((call) => ChipMateCompactionChunks.adjustedTokens(Token.estimate(call)) <= 48_000)).toBe(
            true,
          )
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("publishes monotonic chunk and reduce progress before committing", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "progress " + "x".repeat(80_000))
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )
        const initial = (await svc.messages({ sessionID: session.id })).at(-1)!
        await svc.updatePart(
          ChipMateCompactionStatus.create({
            sessionID: session.id,
            messageID: initial.info.id,
            source: "manual",
          }),
        )
        const { rt } = fakeRuntime()
        try {
          const messages = await svc.messages({ sessionID: session.id })
          const marker = messages.at(-1)!
          const statusPart = ChipMateCompactionStatus.find(marker.parts)!
          const progress: ChipMateCompactionStatus.Value[] = []
          const off = await rt.runPromise(
            EventV2Bridge.Service.use((events) =>
              events.listen((event) => {
                if (event.type !== MessageV2.Event.PartUpdated.type) return Effect.void
                const part = (event.data as typeof MessageV2.Event.PartUpdated.data.Type).part as SessionV1.Part
                if (part.id !== statusPart.id) return Effect.void
                const value = ChipMateCompactionStatus.value(part)
                if (value) progress.push(value)
                return Effect.void
              }),
            ),
          )
          const result = await rt.runPromise(
            SessionCompaction.Service.use((service) =>
              service.process({ parentID: marker.info.id, messages, sessionID: session.id, auto: false }),
            ),
          )
          await rt.runPromise(off)

          expect(result).toBe("continue")
          expect(progress.some((value) => value.phase === "chunk" && (value.totalUnits ?? 0) >= 2)).toBe(true)
          expect(progress.some((value) => value.phase === "reduce")).toBe(true)
          expect(progress.at(-1)).toMatchObject({ state: "succeeded", phase: "committing" })
          for (const phase of ["chunk", "reduce"] as const) {
            const batches = Map.groupBy(
              progress.filter((value) => value.phase === phase && value.totalUnits !== undefined),
              (value) => `${value.attempt}:${value.reduceDepth ?? -1}:${value.totalUnits}`,
            )
            for (const values of batches.values()) {
              const completed = values.map((value) => value.completedUnits ?? 0)
              expect(completed).toEqual([...completed].sort((a, b) => a - b))
              expect(completed.every((value, index) => value <= (values[index]?.totalUnits ?? 0))).toBe(true)
            }
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("preserves gateway errors from chunk workers", async () => {
    const error = new MessageV2.APIError({
      message: "The operation was aborted",
      statusCode: 504,
      isRetryable: true,
      responseBody: '{"error_type":"timeout"}',
    }).toObject()

    const result = await failure(error, false, false, true)

    expect(result.result).toBe("stop")
    expect(result.summary?.info.role).toBe("assistant")
    if (result.summary?.info.role !== "assistant") return
    expect(result.summary.info.finish).toBe("error")
    expect(result.summary.info.error).toEqual(error)
    expect(result.variants.some((variant) => variant === "none")).toBe(false)
  })

  test("never retries terminal provider failures with thinking disabled", () => {
    const errors: MessageV2.Assistant["error"][] = [
      new MessageV2.AbortedError({ message: "cancelled" }).toObject(),
      new SessionV1.AuthError({ providerID: "test", message: "unauthorized" }).toObject(),
      new MessageV2.APIError({ message: "unauthorized", statusCode: 401, isRetryable: false }).toObject(),
      new MessageV2.APIError({ message: "forbidden", statusCode: 403, isRetryable: false }).toObject(),
      new MessageV2.APIError({ message: "rate limited", statusCode: 429, isRetryable: true }).toObject(),
      new MessageV2.APIError({ message: "gateway timeout", statusCode: 504, isRetryable: true }).toObject(),
      new SessionV1.ContentFilterError({ message: "filtered" }).toObject(),
    ]

    for (const error of errors) {
      expect(ChipMateCompactionChunks.retryWithoutThinking({ kind: "failure", error })).toBe(false)
    }
  })

  test("keeps context overflow on the terminal compaction path", async () => {
    const result = await failure(
      new MessageV2.ContextOverflowError({
        message: "worker context overflow",
      }).toObject(),
    )

    expect(result.result).toBe("stop")
    expect(result.summary?.info.role).toBe("assistant")
    if (result.summary?.info.role !== "assistant") return
    expect(result.summary.info.error?.name).toBe("ContextOverflowError")
    if (result.summary.info.error?.name !== "ContextOverflowError") return
    expect(result.summary.info.error.data.message).toBe(
      "Compaction chunk input still exceeds the model context limit after deterministic splitting",
    )
  })

  test("retries a terminal context overflow once with none and does not start a third pass", async () => {
    const result = await failure(
      new MessageV2.ContextOverflowError({
        message: "worker context overflow",
      }).toObject(),
      false,
      false,
      true,
    )

    const fallback = result.variants.findIndex((variant) => variant === "none")
    expect(result.result).toBe("stop")
    expect(fallback).toBeGreaterThan(0)
    expect(result.variants.slice(0, fallback).every((variant) => variant === undefined)).toBe(true)
    expect(result.variants.slice(fallback).every((variant) => variant === "none")).toBe(true)
    expect(result.summary?.info.role).toBe("assistant")
    if (result.summary?.info.role !== "assistant") return
    expect(result.summary.info.error?.name).toBe("ContextOverflowError")
  })

  test("reports empty chunk worker responses as API errors", async () => {
    const result = await failure(undefined, true)

    expect(result.result).toBe("stop")
    expect(result.summary?.info.role).toBe("assistant")
    if (result.summary?.info.role !== "assistant") return
    expect(result.summary.info.finish).toBe("error")
    expect(result.summary.info.error?.name).toBe("APIError")
    if (result.summary.info.error?.name !== "APIError") return
    expect(result.summary.info.error.data.message).toBe("Compaction worker returned an empty response")
    expect(result.summary.info.error.data.isRetryable).toBe(false)
  })

  test("restarts the whole chunk pipeline with none after empty worker responses", async () => {
    const result = await failure(undefined, true, false, true)

    const fallback = result.variants.findIndex((variant) => variant === "none")
    expect(result.result).toBe("continue")
    expect(fallback).toBeGreaterThan(0)
    expect(result.variants.slice(0, fallback).every((variant) => variant === undefined)).toBe(true)
    expect(result.variants.slice(fallback).every((variant) => variant === "none")).toBe(true)
    expect(result.summary?.info.role).toBe("assistant")
    if (result.summary?.info.role !== "assistant") return
    expect(result.summary.info.variant).toBe("none")
    const text = result.summary.parts.filter((part): part is MessageV2.TextPart => part.type === "text")
    expect(text.map((part) => part.text)).toEqual(["final summary"])
    const marker = result.messages.find((message) => message.parts.some((part) => part.type === "compaction"))
    expect(ChipMateCompactionStatus.value(ChipMateCompactionStatus.find(marker?.parts ?? []))).toMatchObject({
      state: "succeeded",
      attempt: 2,
      attemptMode: "none",
      phase: "committing",
    })
  })

  test("reports a non-retryable compatibility error when reasoning exhausts a model without none", async () => {
    const result = await failure(undefined, true, true)

    expect(result.result).toBe("stop")
    expect(result.summary?.info.role).toBe("assistant")
    if (result.summary?.info.role !== "assistant") return
    expect(result.summary.info.error?.name).toBe("APIError")
    if (result.summary.info.error?.name !== "APIError") return
    expect(result.summary.info.error.data.message).toBe(
      "Compaction reasoning exhausted the output budget, but this model has no none variant",
    )
    expect(result.summary.info.error.data.isRetryable).toBe(false)
  })

  test("does not retry when the selected variant is already none", async () => {
    const stub = llm()
    const variants: Array<string | undefined> = []
    stub.push(lengthReply("partial summary", (input) => variants.push(input.user.model.variant)))

    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "short history")
        await assistant(session.id, first.id, tmp.path, "short response")
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: { ...ref, variant: "none" } as typeof ref,
            auto: false,
          }),
        )

        const rt = liveRuntime(stub.layer, 100_000, true)
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )
          const all = await svc.messages({ sessionID: session.id })
          const summary = all.find((message) => message.info.role === "assistant" && message.info.summary)
          const text = summary?.parts.filter((part): part is MessageV2.TextPart => part.type === "text") ?? []

          expect(result).toBe("stop")
          expect(variants).toEqual(["none"])
          expect(text).toHaveLength(0)
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role !== "assistant") return
          expect(summary.info.error?.name).toBe("APIError")
          if (summary.info.error?.name !== "APIError") return
          expect(summary.info.error.data.message).toBe(
            "Compaction reasoning exhausted the output budget while thinking was already disabled",
          )
          expect(summary.info.error.data.isRetryable).toBe(false)
        } finally {
          await rt.dispose()
        }
      },
    })
  }, 30_000)

  test("manual compaction inherits the last supported real-user variant across compaction markers", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "large history " + "x".repeat(80_000), "xhigh")
        for (let index = 0; index < 2; index++) {
          await Effect.runPromise(
            ChipMateSessionCompaction.create({
              session: store,
              sessionID: session.id,
              agent: "build",
              model: ref,
              auto: false,
            }),
          )
        }

        const { rt, variants } = fakeRuntime()
        try {
          const messages = await svc.messages({ sessionID: session.id })
          const parentID = messages.at(-1)?.info.id
          expect(parentID).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((service) =>
              service.process({ parentID: parentID!, messages, sessionID: session.id, auto: false }),
            ),
          )
          const all = await svc.messages({ sessionID: session.id })
          const summary = all.findLast((message) => message.info.role === "assistant" && message.info.summary)

          expect(result).toBe("continue")
          expect(variants.length).toBeGreaterThan(1)
          expect(variants.every((variant) => variant === "xhigh")).toBe(true)
          expect(summary?.info.role === "assistant" ? summary.info.variant : undefined).toBe("xhigh")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("manual compaction does not inherit an unsupported variant", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "large history " + "x".repeat(80_000), "unsupported")
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

        const { rt, variants } = fakeRuntime()
        try {
          const messages = await svc.messages({ sessionID: session.id })
          const parentID = messages.at(-1)?.info.id
          expect(parentID).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((service) =>
              service.process({ parentID: parentID!, messages, sessionID: session.id, auto: false }),
            ),
          )
          expect(variants.length).toBeGreaterThan(1)
          expect(variants.every((variant) => variant === undefined)).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("restarts the whole chunk pipeline with none and discards the first pass output", async () => {
    const result = await failure(undefined, false, true, true)

    expect(result.result).toBe("continue")
    const fallback = result.variants.findIndex((variant) => variant === "none")
    expect(fallback).toBeGreaterThan(0)
    expect(result.variants.slice(0, fallback)).toEqual(Array(fallback).fill(undefined))
    expect(result.variants.slice(fallback)).toEqual(Array(result.variants.length - fallback).fill("none"))
    expect(result.summary?.info.role).toBe("assistant")
    if (result.summary?.info.role !== "assistant") return
    expect(result.summary.info.variant).toBe("none")
    const text = result.summary.parts.filter((part): part is MessageV2.TextPart => part.type === "text")
    expect(text.map((part) => part.text)).toEqual(["final summary"])
    const compact = result.messages.findLast(
      (message) => message.info.role === "user" && message.parts.some((part) => part.type === "compaction"),
    )
    expect(compact?.info.role === "user" ? compact.info.model.variant : undefined).toBeUndefined()
    expect(result.messages.filter((message) => message.info.role === "assistant" && message.info.summary)).toHaveLength(
      1,
    )
  })

  test("waits for concurrent chunk workers and reruns every chunk when one exhausts reasoning", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        for (let index = 0; index < 4; index++) {
          const input = await user(session.id, `request ${index} ` + "x".repeat(10_000))
          await assistant(session.id, input.id, tmp.path, `response ${index} ` + "y".repeat(10_000))
        }
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: { ...ref, variant: "high" } as typeof ref,
            auto: false,
          }),
        )

        const { rt, variants } = fakeRuntime(undefined, undefined, false, true, true, 2)
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )
          const all = await svc.messages({ sessionID: session.id })
          const summary = all.find((message) => message.info.role === "assistant" && message.info.summary)
          const selected = variants.filter((variant) => variant === "high")
          const none = variants.filter((variant) => variant === "none")

          expect(result).toBe("continue")
          expect(selected.length).toBeGreaterThan(1)
          expect(none.length).toBeGreaterThanOrEqual(selected.length)
          expect(variants.slice(0, selected.length)).toEqual(Array(selected.length).fill("high"))
          expect(variants.slice(selected.length).every((variant) => variant === "none")).toBe(true)
          expect(summary?.info.role === "assistant" ? summary.info.variant : undefined).toBe("none")
          expect(all.filter((message) => message.info.role === "assistant" && message.info.summary)).toHaveLength(1)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("restarts every chunk when the reduce stage exhausts reasoning", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        for (let index = 0; index < 3; index++) {
          const input = await user(session.id, `request ${index} ` + "x".repeat(10_000))
          await assistant(session.id, input.id, tmp.path, `response ${index} ` + "y".repeat(10_000))
        }
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: { ...ref, variant: "high" } as typeof ref,
            auto: false,
          }),
        )

        const { rt, calls, variants } = fakeRuntime(undefined, undefined, false, true, true, undefined, "reduce")
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )
          const all = await svc.messages({ sessionID: session.id })
          const summary = all.find((message) => message.info.role === "assistant" && message.info.summary)
          const reduceCalls = calls.filter((call) => call.includes("Create a new anchored summary"))
          const selected = variants.filter((variant) => variant === "high")
          const none = variants.filter((variant) => variant === "none")

          expect(result).toBe("continue")
          expect(reduceCalls).toHaveLength(2)
          expect(selected.length).toBeGreaterThan(1)
          expect(none.length).toBe(selected.length)
          expect(summary?.info.role === "assistant" ? summary.info.variant : undefined).toBe("none")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("restarts a full compaction with none and never commits length-truncated text", async () => {
    const stub = llm()
    const variants: Array<string | undefined> = []
    stub.push(lengthReply("partial summary", (input) => variants.push(input.user.model.variant)))
    stub.push(reply("complete summary", (input) => variants.push(input.user.model.variant)))

    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "short history")
        await assistant(session.id, first.id, tmp.path, "short response")
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: { ...ref, variant: "high" } as typeof ref,
            auto: false,
          }),
        )

        const rt = liveRuntime(stub.layer, 100_000, true)
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )
          const all = await svc.messages({ sessionID: session.id })
          const summaries = all.filter((message) => message.info.role === "assistant" && message.info.summary)
          const parts = summaries.flatMap((message) => message.parts)
          const text = parts.filter((part): part is MessageV2.TextPart => part.type === "text")

          expect(result).toBe("continue")
          expect(variants).toEqual(["high", "none"])
          expect(summaries).toHaveLength(1)
          expect(summaries[0]?.info.role === "assistant" ? summaries[0].info.variant : undefined).toBe("none")
          expect(text.map((part) => part.text)).toEqual(["complete summary"])
          expect(
            text.some((part) => part.metadata?.["chipmate.compaction.status"] === "retrying-without-thinking"),
          ).toBe(false)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("restarts full compaction with none when stop contains no summary text", async () => {
    const scenarios = [
      { name: "reasoning-only", first: reasoningStopReply },
      { name: "empty", first: emptyStopReply },
    ]

    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        for (const scenario of scenarios) {
          const stub = llm()
          const variants: Array<string | undefined> = []
          stub.push(scenario.first((input) => variants.push(input.user.model.variant)))
          stub.push(reply(`${scenario.name} complete summary`, (input) => variants.push(input.user.model.variant)))

          const session = await svc.create({})
          const first = await user(session.id, `${scenario.name} history`)
          await assistant(session.id, first.id, tmp.path, `${scenario.name} response`)
          await Effect.runPromise(
            ChipMateSessionCompaction.create({
              session: store,
              sessionID: session.id,
              agent: "build",
              model: { ...ref, variant: "xhigh" } as typeof ref,
              auto: false,
            }),
          )

          const rt = liveRuntime(stub.layer, 100_000, true)
          try {
            const msgs = await svc.messages({ sessionID: session.id })
            const parent = msgs.at(-1)?.info.id
            expect(parent).toBeTruthy()
            const result = await rt.runPromise(
              SessionCompaction.Service.use((svc) =>
                svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
              ),
            )
            const all = await svc.messages({ sessionID: session.id })
            const summaries = all.filter((message) => message.info.role === "assistant" && message.info.summary)
            const text = summaries.flatMap((message) =>
              message.parts.filter((part): part is MessageV2.TextPart => part.type === "text"),
            )

            expect(result).toBe("continue")
            expect(variants).toEqual(["xhigh", "none"])
            expect(summaries).toHaveLength(1)
            expect(summaries[0]?.info.role === "assistant" ? summaries[0].info.variant : undefined).toBe("none")
            expect(text.map((part) => part.text)).toEqual([`${scenario.name} complete summary`])
          } finally {
            await rt.dispose()
          }
        }
      },
    })
  })

  test("restarts length-truncated text without reasoning with none", async () => {
    const stub = llm()
    const variants: Array<string | undefined> = []
    stub.push(lengthTextReply("partial summary", (input) => variants.push(input.user.model.variant)))
    stub.push(reply("complete summary", (input) => variants.push(input.user.model.variant)))

    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "short history")
        await assistant(session.id, first.id, tmp.path, "short response")
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: { ...ref, variant: "high" } as typeof ref,
            auto: false,
          }),
        )

        const rt = liveRuntime(stub.layer, 100_000, true)
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )
          const all = await svc.messages({ sessionID: session.id })
          const summary = all.find((message) => message.info.role === "assistant" && message.info.summary)
          const text = summary?.parts.filter((part): part is MessageV2.TextPart => part.type === "text") ?? []

          expect(result).toBe("continue")
          expect(variants).toEqual(["high", "none"])
          expect(text.map((part) => part.text)).toEqual(["complete summary"])
          expect(summary?.info.role === "assistant" ? summary.info.variant : undefined).toBe("none")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("stops after the none pass also exhausts reasoning and never commits either partial summary", async () => {
    const stub = llm()
    const variants: Array<string | undefined> = []
    stub.push(lengthReply("first partial", (input) => variants.push(input.user.model.variant)))
    stub.push(lengthReply("second partial", (input) => variants.push(input.user.model.variant)))

    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "short history")
        await assistant(session.id, first.id, tmp.path, "short response")
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: { ...ref, variant: "high" } as typeof ref,
            auto: false,
          }),
        )

        const rt = liveRuntime(stub.layer, 100_000, true)
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )
          const all = await svc.messages({ sessionID: session.id })
          const summary = all.find((message) => message.info.role === "assistant" && message.info.summary)
          const text = summary?.parts.filter((part): part is MessageV2.TextPart => part.type === "text") ?? []

          expect(result).toBe("stop")
          expect(variants).toEqual(["high", "none"])
          expect(text).toHaveLength(0)
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role !== "assistant") return
          expect(summary.info.variant).toBe("none")
          expect(summary.info.error?.name).toBe("APIError")
          if (summary.info.error?.name !== "APIError") return
          expect(summary.info.error.data.message).toBe("Compaction failed again after retrying with thinking disabled")
          expect(summary.info.error.data.isRetryable).toBe(false)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("cancellation removes second-pass partial output and the transient retry marker", async () => {
    const stub = llm()
    const ready = await Effect.runPromise(Deferred.make<void>())
    const variants: Array<string | undefined> = []
    stub.push(lengthReply("first partial", (input) => variants.push(input.user.model.variant)))
    stub.push(blockingReply(ready, (input) => variants.push(input.user.model.variant)))

    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "short history")
        await assistant(session.id, first.id, tmp.path, "short response")
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: { ...ref, variant: "high" } as typeof ref,
            auto: false,
          }),
        )

        const rt = liveRuntime(stub.layer, 100_000, true)
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const fiber = rt.runFork(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )
          await Effect.runPromise(Deferred.await(ready).pipe(Effect.timeout("5 seconds")))
          await Effect.runPromise(Fiber.interrupt(fiber).pipe(Effect.timeout("5 seconds")))

          const all = await svc.messages({ sessionID: session.id })
          const summary = all.find((message) => message.info.role === "assistant" && message.info.summary)
          const leaked = summary?.parts.filter((part) => part.type === "text" || part.type === "reasoning") ?? []

          expect(variants).toEqual(["high", "none"])
          expect(leaked).toHaveLength(0)
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role !== "assistant") return
          expect(summary.info.finish).toBeUndefined()
          expect(summary.info.error).toBeUndefined()
          expect(all.filter((message) => message.info.role === "assistant" && message.info.summary)).toHaveLength(1)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("falls back to chunk workers after the first compaction overflows", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(10_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(10_000))
        const second = await user(session.id, "second " + "c".repeat(10_000))
        await assistant(session.id, second.id, tmp.path, "reply " + "d".repeat(10_000))
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

        const { rt, calls } = fakeRuntime()
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const summaries = all.filter((msg) => msg.info.role === "assistant" && msg.info.summary)
          const parts = summaries
            .flatMap((msg) => msg.parts)
            .filter((part): part is MessageV2.TextPart => part.type === "text")

          expect(result).toBe("continue")
          expect(calls.length).toBeGreaterThanOrEqual(1)
          expect(calls.at(-1)).toContain("Create a new anchored summary")
          expect(summaries).toHaveLength(1)
          expect(parts.map((part) => part.text)).toEqual(["final summary"])
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("uses chunk fallback before sending oversized normal compaction", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(10_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(10_000))
        const second = await user(session.id, "second " + "c".repeat(10_000))
        await assistant(session.id, second.id, tmp.path, "reply " + "d".repeat(10_000))
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

        const { rt, calls } = fakeRuntime()
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          expect(result).toBe("continue")
          expect(calls[0]).toContain("Summarize conversation chunk")
          expect(calls[0]).not.toContain("Create a new anchored summary")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("uses a worker even when fallback selection produces one oversized chunk", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(20_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(20_000))
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

        const { rt, calls } = fakeRuntime()
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const summaries = all.filter((msg) => msg.info.role === "assistant" && msg.info.summary)
          const parts = summaries
            .flatMap((msg) => msg.parts)
            .filter((part): part is MessageV2.TextPart => part.type === "text")

          expect(result).toBe("continue")
          expect(calls.length).toBeGreaterThan(0)
          expect(calls[0]).toContain("Summarize conversation chunk")
          expect(summaries).toHaveLength(1)
          expect(parts.map((part) => part.text)).toEqual(["final summary"])
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("serializes oversized fallback chunks before summarizing", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "single huge request " + "a".repeat(80_000))
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

        const { rt, calls } = fakeRuntime()
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          expect(result).toBe("continue")
          expect(calls[0]).toContain("transcript fragments")
          expect(calls.join("\n")).not.toContain("Text truncated for compaction")
          expect(calls.join("\n").match(/a/g)?.length).toBeGreaterThanOrEqual(80_000)
          expect(calls[0]).toContain("Summarize conversation chunk")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("caps worker output budget below the configured runtime limit", async () => {
    const { rt, calls, outputs } = fakeRuntime(512)
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(80_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(80_000))
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          expect(result).toBe("continue")
          expect(calls.length).toBeGreaterThan(0)
          expect(outputs.at(-1)).toBe(512)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("compacts oversized replay turns after overflow compaction", async () => {
    const stub = llm()
    const calls: string[] = []
    stub.push(reply("history summary"))
    for (let index = 0; index < 3; index++) {
      stub.push(reply(`replay chunk ${index + 1}`, (input) => calls.push(JSON.stringify(input.messages))))
    }
    stub.push(reply("replay summary", (input) => calls.push(JSON.stringify(input.messages))))

    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const old = await user(session.id, "old context")
        await assistant(session.id, old.id, tmp.path, "old reply")
        const large = await user(session.id, "large replay " + "x".repeat(40_000))
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: true,
            overflow: true,
          }),
        )

        const rt = liveRuntime(stub.layer)
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: true,
                overflow: true,
              }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const replay = all.findLast((msg) => msg.info.role === "user" && msg.info.id !== large.id)
          const part = replay?.parts.find((part): part is MessageV2.TextPart => part.type === "text")

          expect(result).toBe("continue")
          expect(calls).toHaveLength(4)
          expect(calls[0]).toContain("Summarize conversation chunk 1 of 3")
          expect(part?.text).toContain("compacted representation")
          expect(part?.text).toContain("replay summary")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("restarts the full transaction when replay exhausts reasoning", async () => {
    const stub = llm()
    const variants: Array<string | undefined> = []
    stub.push(reply("first history summary", (input) => variants.push(input.user.model.variant)))
    stub.push(lengthReply("partial replay", (input) => variants.push(input.user.model.variant)))
    stub.push(reply("first replay remainder 1", (input) => variants.push(input.user.model.variant)))
    stub.push(reply("first replay remainder 2", (input) => variants.push(input.user.model.variant)))
    stub.push(reply("second history summary", (input) => variants.push(input.user.model.variant)))
    for (let index = 0; index < 3; index++) {
      stub.push(reply(`second replay chunk ${index + 1}`, (input) => variants.push(input.user.model.variant)))
    }
    stub.push(reply("complete replay", (input) => variants.push(input.user.model.variant)))

    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const old = await user(session.id, "old context")
        await assistant(session.id, old.id, tmp.path, "old reply")
        const large = await user(session.id, "large replay " + "x".repeat(40_000))
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: { ...ref, variant: "high" } as typeof ref,
            auto: true,
            overflow: true,
          }),
        )

        const rt = liveRuntime(stub.layer, 10_000, true)
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: true,
                overflow: true,
              }),
            ),
          )
          const all = await svc.messages({ sessionID: session.id })
          const summary = all.find((message) => message.info.role === "assistant" && message.info.summary)
          const summaryText = summary?.parts.filter((part): part is MessageV2.TextPart => part.type === "text") ?? []
          const replay = all.findLast((message) => message.info.role === "user" && message.info.id !== large.id)
          const replayText = replay?.parts.find((part): part is MessageV2.TextPart => part.type === "text")

          expect(result).toBe("continue")
          expect(variants).toEqual(["high", "high", "high", "high", "none", "none", "none", "none", "none"])
          expect(summary?.info.role === "assistant" ? summary.info.variant : undefined).toBe("none")
          expect(summaryText.map((part) => part.text)).toEqual(["second history summary"])
          expect(replayText?.text).toContain("complete replay")
          expect(replayText?.text).not.toContain("partial replay")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("compaction must not leak maxOutputTokens into agent options", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(20_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(20_000))
        const second = await user(session.id, "second " + "c".repeat(20_000))
        await assistant(session.id, second.id, tmp.path, "reply " + "d".repeat(20_000))
        await Effect.runPromise(
          ChipMateSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

        const captured: Array<{ opts: Record<string, unknown>; modelLimitOutput: number }> = []
        const processor = Layer.effect(
          SessionProcessorModule.SessionProcessor.Service,
          Effect.gen(function* () {
            const sessions = yield* SessionNs.Service
            return SessionProcessorModule.SessionProcessor.Service.of({
              create: Effect.fn("TestSessionProcessorLeak.create")((input) =>
                Effect.succeed({
                  get message() {
                    return input.assistantMessage
                  },
                  updateToolCall: Effect.fn("TestSessionProcessorLeak.updateToolCall")(() => Effect.succeed(undefined)),
                  metadata: Effect.fn("TestSessionProcessorLeak.metadata")(() => Effect.void),
                  completeToolCall: Effect.fn("TestSessionProcessorLeak.completeToolCall")(() => Effect.void),
                  process: Effect.fn("TestSessionProcessorLeak.process")((stream: LLM.StreamInput) =>
                    Effect.gen(function* () {
                      captured.push({
                        opts: stream.agent.options as Record<string, unknown>,
                        modelLimitOutput: stream.model.limit.output,
                      })
                      const text = stream.messages.some((msg) =>
                        JSON.stringify(msg).includes("Create a new anchored summary"),
                      )
                        ? "final summary"
                        : "chunk summary"
                      yield* sessions.updatePart({
                        id: PartID.ascending(),
                        messageID: input.assistantMessage.id,
                        sessionID: input.sessionID,
                        type: "text",
                        text,
                      })
                      input.assistantMessage.finish = "stop"
                      return "continue" as const
                    }),
                  ),
                } satisfies SessionProcessor.Handle),
              ),
            })
          }),
        )

        const model = ProviderTest.model({
          providerID,
          id: modelID,
          limit: { context: 10_000, output: 1_000 },
        })
        const processorNode = LayerNode.make({
          service: SessionProcessorModule.SessionProcessor.Service,
          layer: processor,
          deps: [SessionNs.node],
        })
        const outputTokenMax = 512
        const rt = ManagedRuntime.make(
          LayerNode.compile(
            LayerNode.group([SessionCompaction.node, SessionNs.node, SessionProjector.node, Bus.node]),
            [
              [SessionProcessorModule.SessionProcessor.node, processorNode],
              [Provider.node, ProviderTest.fake({ model }).layer],
              [Agent.node, agents],
              [RuntimeFlags.node, RuntimeFlags.layer({ outputTokenMax })],
              [
                Config.node,
                Layer.mock(Config.Service)({
                  get: () => Effect.succeed({ compaction: { reserved: 1_000 } }),
                  directories: () => Effect.succeed([]),
                }),
              ],
            ],
          ),
        )

        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          expect(result).toBe("continue")
          expect(captured.length).toBeGreaterThan(0)
          // Negative assertion (the bug surfacing):
          // maxOutputTokens must not appear in agent.options that the
          // worker hands to the LLM. Today a strict OpenAI-compatible
          // upstream rejects that field with
          // Unsupported parameter(s): maxOutputTokens`.
          for (const c of captured) {
            expect(c.opts.maxOutputTokens).toBeUndefined()
          }
          // Positive assertion (budget preserved through an independent path):
          // the constrained model still threads a tightened output limit
          // through to every worker. If a future "fix" accidentally severs
          // the only budget source along with the leak, this fails.
          for (const c of captured) {
            expect(c.modelLimitOutput).toBeLessThanOrEqual(outputTokenMax)
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  }, 30_000)
})
