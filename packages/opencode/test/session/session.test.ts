import { describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Deferred, Effect, Exit, Layer } from "effect"
import { Session as SessionNs } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
type SessionModel = NonNullable<SessionNs.Info["model"]> // chipmate_change
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { GlobalBus } from "@/bus/global"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionNs.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

const awaitDeferred = <T>(deferred: Deferred.Deferred<T>, message: string) =>
  Effect.race(
    Deferred.await(deferred),
    Effect.sleep("2 seconds").pipe(Effect.flatMap(() => Effect.fail(new Error(message)))),
  )

const remove = (id: SessionID) => SessionNs.use.remove(id)

describe("session.created event", () => {
  it.instance("should emit session.created event when session is created", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const events = yield* EventV2Bridge.Service
      const received = yield* Deferred.make<SessionNs.Info>()

      const unsub = yield* events.listen((event) => {
        if (event.type === SessionNs.Event.Created.type)
          Deferred.doneUnsafe(
            received,
            Effect.succeed((event.data as typeof SessionNs.Event.Created.data.Type).info as SessionNs.Info),
          )
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsub)

      const info = yield* session.create({})
      const receivedInfo = yield* awaitDeferred(received, "timed out waiting for session.created")

      expect(receivedInfo.id).toBe(info.id)
      expect(receivedInfo.projectID).toBe(info.projectID)
      expect(receivedInfo.directory).toBe(info.directory)
      expect(receivedInfo.path).toBe(info.path)
      expect(receivedInfo.title).toBe(info.title)

      yield* session.remove(info.id)
    }),
  )

  it.instance("session.created event should be emitted before session.updated", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const source = yield* EventV2Bridge.Service
      const events: string[] = []
      const received = yield* Deferred.make<string[]>()
      const push = (event: string) => {
        events.push(event)
        if (events.includes("created") && events.includes("updated")) {
          Deferred.doneUnsafe(received, Effect.succeed(events))
        }
      }

      const unsubscribe = yield* source.listen((event) => {
        if (event.type === SessionNs.Event.Created.type) push("created")
        if (event.type === SessionNs.Event.Updated.type) push("updated")
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)

      const info = yield* session.create({})
      yield* session.setTitle({ sessionID: info.id, title: "updated" })
      const receivedEvents = yield* awaitDeferred(received, "timed out waiting for session created/updated events")

      expect(receivedEvents).toContain("created")
      expect(receivedEvents).toContain("updated")
      expect(receivedEvents.indexOf("created")).toBeLessThan(receivedEvents.indexOf("updated"))

      yield* session.remove(info.id)
    }),
  )

  it.instance("emits legacy global sync payload", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const received = yield* Deferred.make<{ syncEvent: EventV2.SerializedEvent }>()
      const listener = (event: { payload: { type?: string; syncEvent?: EventV2.SerializedEvent } }) => {
        if (event.payload.type === "sync" && event.payload.syncEvent)
          Deferred.doneUnsafe(received, Effect.succeed({ syncEvent: event.payload.syncEvent }))
      }
      GlobalBus.on("event", listener)
      yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", listener)))

      const info = yield* session.create({})
      const event = yield* awaitDeferred(received, "timed out waiting for legacy global sync event")

      expect(event.syncEvent).toMatchObject({
        type: EventV2.versionedType(SessionNs.Event.Created.type, 1),
        seq: 0,
        aggregateID: info.id,
        data: { sessionID: info.id },
      })

      yield* session.remove(info.id)
    }),
  )
})

describe("step-finish token propagation via event", () => {
  it.instance(
    "non-zero tokens propagate through PartUpdated event",
    () =>
      Effect.gen(function* () {
        const session = yield* SessionNs.Service
        const events = yield* EventV2Bridge.Service
        const info = yield* session.create({})

        const messageID = MessageID.ascending()
        yield* session.updateMessage({
          id: messageID,
          sessionID: info.id,
          role: "user",
          time: { created: Date.now() },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as SessionV1.Info)

        // Event subscribers receive readonly Schema.Type payloads; `SessionV1.Part`
        // is the mutable domain type. Cast bridges the two — safe because the
        // test only reads the value afterwards.
        const received = yield* Deferred.make<SessionV1.Part>()
        const unsub = yield* events.listen((event) => {
          if (event.type === MessageV2.Event.PartUpdated.type)
            Deferred.doneUnsafe(
              received,
              Effect.succeed((event.data as typeof MessageV2.Event.PartUpdated.data.Type).part as SessionV1.Part),
            )
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsub)

        const tokens = {
          total: 1500,
          input: 500,
          output: 800,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        }

        const partInput = {
          id: PartID.ascending(),
          messageID,
          sessionID: info.id,
          type: "step-finish" as const,
          reason: "stop",
          cost: 0.005,
          tokens,
        }

        yield* session.updatePart(partInput)
        const receivedPart = yield* awaitDeferred(received, "timed out waiting for message.part.updated")

        expect(receivedPart.type).toBe("step-finish")
        const finish = receivedPart as SessionV1.StepFinishPart
        expect(finish.tokens.input).toBe(500)
        expect(finish.tokens.output).toBe(800)
        expect(finish.tokens.reasoning).toBe(200)
        expect(finish.tokens.total).toBe(1500)
        expect(finish.tokens.cache.read).toBe(100)
        expect(finish.tokens.cache.write).toBe(50)
        expect(finish.cost).toBe(0.005)
        expect(receivedPart).not.toBe(partInput)

        yield* session.remove(info.id)
      }),
    { timeout: 30000 },
  )
})

describe("Session", () => {
  it.live("remove works without an instance", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const dir = yield* tmpdirScoped({ git: true })
      const info = yield* provideInstance(dir)(session.create({ title: "remove-without-instance" }))

      const removeExit = yield* remove(info.id).pipe(Effect.exit)
      expect(Exit.isSuccess(removeExit)).toBe(true)

      const getExit = yield* session.get(info.id).pipe(Effect.exit)
      expect(Exit.isFailure(getExit)).toBe(true)
    }),
  )

  it.instance("persists metadata and copies it on fork by default", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const meta = { source: "sdk", trace: { id: "abc" } }
      const created = yield* Effect.acquireRelease(session.create({ title: "with-meta", metadata: meta }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )
      const saved = yield* session.get(created.id)
      const fork = yield* Effect.acquireRelease(session.fork({ sessionID: created.id }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      expect(saved.metadata).toEqual(meta)
      expect(fork.metadata).toEqual(meta)
      expect(fork.metadata).not.toBe(meta)
    }),
  )

  it.instance("omits metadata when not provided", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const created = yield* Effect.acquireRelease(session.create({ title: "empty-meta" }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )
      const saved = yield* session.get(created.id)

      expect(created.metadata).toBeUndefined()
      expect(saved.metadata).toBeUndefined()
    }),
  )

  // chipmate_change start
  it.instance("fork preserves model and variant", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const model = {
        id: "test-model",
        providerID: "test-provider",
        variant: "high",
      } as SessionModel
      const created = yield* Effect.acquireRelease(
        session.create({ title: "with-model", model }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )
      const saved = yield* session.get(created.id)
      expect(saved.model).toEqual(model)

      const fork = yield* Effect.acquireRelease(session.fork({ sessionID: created.id }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )
      const forked = yield* session.get(fork.id)

      expect(forked.model).toEqual(model)
      expect(forked.model?.variant).toBe("high")
      expect(forked.model).not.toBe(saved.model)
    }),
  )
  // chipmate_change end

  // chipmate_change start
  it.instance("historical fork preserves the model at the fork point", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const source = yield* Effect.acquireRelease(
        session.create({
          model: {
            id: "test-model",
            providerID: "test-provider",
            variant: "high",
          } as SessionModel,
        }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )
      yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: source.id,
        role: "user",
        time: { created: Date.now() },
        agent: "code",
        model: {
          providerID: source.model!.providerID,
          modelID: source.model!.id,
          variant: "low",
        },
        tools: {},
        mode: "",
      } as unknown as MessageV2.Info)
      const latest = yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: source.id,
        role: "user",
        time: { created: Date.now() },
        agent: "code",
        model: {
          providerID: source.model!.providerID,
          modelID: source.model!.id,
          variant: "high",
        },
        tools: {},
        mode: "",
      } as unknown as MessageV2.Info)
      const fork = yield* Effect.acquireRelease(
        session.fork({ sessionID: source.id, messageID: latest.id }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )

      expect(fork.model).toEqual({
        id: source.model!.id,
        providerID: source.model!.providerID,
        variant: "low",
      })
    }),
  )
  // chipmate_change end

  // chipmate_change start
  it.instance("afterMessageID includes the selected assistant answer and excludes later turns", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const source = yield* Effect.acquireRelease(session.create({ title: "inclusive-source" }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )
      const user = (text: string) =>
        Effect.gen(function* () {
          const info = yield* session.updateMessage({
            id: MessageID.ascending(),
            sessionID: source.id,
            role: "user",
            time: { created: Date.now() },
            agent: "code",
            model: { providerID: "test-provider", modelID: "test-model" },
            tools: {},
          } as MessageV2.User)
          yield* session.updatePart({
            id: PartID.ascending(),
            sessionID: source.id,
            messageID: info.id,
            type: "text",
            text,
          } as MessageV2.TextPart)
          return info
        })
      const assistant = (parentID: MessageID, text: string) =>
        Effect.gen(function* () {
          const info = yield* session.updateMessage({
            id: MessageID.ascending(),
            sessionID: source.id,
            role: "assistant",
            time: { created: Date.now(), completed: Date.now() },
            parentID,
            modelID: "test-model",
            providerID: "test-provider",
            agent: "code",
            mode: "",
            path: { cwd: "/tmp", root: "/tmp" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          } as MessageV2.Assistant)
          yield* session.updatePart({
            id: PartID.ascending(),
            sessionID: source.id,
            messageID: info.id,
            type: "text",
            text,
          } as MessageV2.TextPart)
          return info
        })
      const u1 = yield* user("U1")
      const a1 = yield* assistant(u1.id, "A1")
      const u2 = yield* user("U2")
      yield* assistant(u2.id, "A2")

      const forked = yield* Effect.acquireRelease(
        session.fork({ sessionID: source.id, afterMessageID: a1.id, operationID: crypto.randomUUID() }),
        (info) => session.remove(info.id).pipe(Effect.ignore),
      )
      const copied = yield* session.messages({ sessionID: forked.id })
      expect(copied).toHaveLength(2)
      expect(copied.map((item) => item.info.role)).toEqual(["user", "assistant"])
      expect(copied.flatMap((item) => item.parts).filter((part) => part.type === "text").map((part) => part.text)).toEqual([
        "U1",
        "A1",
      ])
    }),
  )

  it.instance("twenty concurrent retries with one operationID create one target", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const source = yield* Effect.acquireRelease(session.create({ title: "single-flight-source" }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )
      const operationID = crypto.randomUUID()
      const results = yield* Effect.all(
        Array.from({ length: 20 }, () => session.fork({ sessionID: source.id, operationID })),
        { concurrency: "unbounded" },
      )
      expect(new Set(results.map((item) => item.id)).size).toBe(1)
      const target = results[0]!
      const durable = yield* session.fork({ sessionID: source.id, operationID })
      expect(durable.id).toBe(target.id)
      const listed = yield* session.list()
      expect(listed.filter((item) => item.metadata?.["chipmate.sessionFork"])).toHaveLength(1)
      yield* session.remove(target.id)
    }),
  )

  it.instance("does not remove an incomplete durable fork that contains later user output", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const source = yield* Effect.acquireRelease(session.create({ title: "source" }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )
      const operationID = crypto.randomUUID()
      const target = yield* session.create({
        title: "incomplete target",
        metadata: {
          "chipmate.sessionFork": {
            version: 1,
            operationID,
            sourceSessionID: source.id,
            boundary: { mode: "full" },
            state: "copying",
            expectedMessages: 200,
          },
        },
      })
      yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: target.id,
        role: "user",
        time: { created: Date.now() },
        agent: "code",
        model: { providerID: "test-provider", modelID: "test-model" },
        tools: {},
      } as MessageV2.User)

      const error = yield* session.fork({ sessionID: source.id, operationID }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(SessionNs.ForkError)
      if (!(error instanceof SessionNs.ForkError)) return
      expect(error.kind).toBe("recovery-conflict")
      expect((yield* session.get(target.id)).id).toBe(target.id)
      yield* session.remove(target.id)
    }),
  )

  it.instance(
    "forks the 200-message and 2000-part QA sample below the ten-second p95 gate",
    () =>
      Effect.gen(function* () {
        const session = yield* SessionNs.Service
        const source = yield* Effect.acquireRelease(session.create({ title: "fork-performance-source" }), (info) =>
          session.remove(info.id).pipe(Effect.ignore),
        )
        const children: SessionNs.Info[] = []
        for (let child = 0; child < 10; child += 1) {
          children.push(yield* session.create({ parentID: source.id, title: `fork-performance-child-${child}` }))
        }
        for (let turn = 0; turn < 100; turn += 1) {
          const user = yield* session.updateMessage({
            id: MessageID.ascending(),
            sessionID: source.id,
            role: "user",
            time: { created: Date.now() },
            agent: "code",
            model: { providerID: "test-provider", modelID: "test-model" },
            tools: {},
          } as MessageV2.User)
          const assistant = yield* session.updateMessage({
            id: MessageID.ascending(),
            sessionID: source.id,
            role: "assistant",
            time: { created: Date.now(), completed: Date.now() },
            parentID: user.id,
            modelID: "test-model",
            providerID: "test-provider",
            agent: "code",
            mode: "",
            path: { cwd: "/tmp", root: "/tmp" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          } as MessageV2.Assistant)
          for (const message of [user, assistant]) {
            for (let part = 0; part < 10; part += 1) {
              const child = message.role === "assistant" && part === 0 ? children[turn] : undefined
              if (child) {
                yield* session.updatePart({
                  id: PartID.ascending(),
                  sessionID: source.id,
                  messageID: message.id,
                  type: "tool",
                  callID: `fork-performance-task-${turn}`,
                  tool: "task",
                  metadata: { sessionId: child.id },
                  state: {
                    status: "completed",
                    input: { task_id: child.id },
                    output: `task_id: ${child.id}`,
                    title: child.title,
                    metadata: { sessionId: child.id },
                    time: { start: Date.now(), end: Date.now() },
                  },
                } as MessageV2.ToolPart)
                continue
              }
              yield* session.updatePart({
                id: PartID.ascending(),
                sessionID: source.id,
                messageID: message.id,
                type: "text",
                text: `${turn}:${message.role}:${part}`,
              } as MessageV2.TextPart)
            }
          }
        }

        const elapsed: number[] = []
        for (let sample = 0; sample < 5; sample += 1) {
          const started = performance.now()
          const forked = yield* session.fork({ sessionID: source.id, operationID: crypto.randomUUID() })
          elapsed.push(performance.now() - started)
          if (sample === 0) expect(yield* session.children(forked.id)).toHaveLength(10)
          yield* session.remove(forked.id)
        }
        elapsed.sort((left, right) => left - right)
        expect(elapsed[4]!).toBeLessThan(10_000)
      }),
    { timeout: 30_000 },
  )
  // chipmate_change end
})
