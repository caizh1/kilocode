// kilocode_change - new file
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { Identifier } from "@/id/id"
import { Context, Deferred, Duration, Effect, Layer, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { ErrorCode, Event, type Failure, type Request, RequestID, type Result } from "./protocol"

const log = Log.create({ service: "skill-market-host" })
type WithoutID<T> = T extends unknown ? Omit<T, "id"> : never
type Input = WithoutID<Request>

export class HostError extends Schema.TaggedErrorClass<HostError>()("SkillMarketHostError", {
  code: ErrorCode,
  detail: Schema.String,
  transactionId: Schema.optional(Schema.String),
}) {
  override get message() {
    return this.detail
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SkillMarket.NotFoundError", {
  requestID: RequestID,
}) {}

interface Entry {
  info: Request
  deferred: Deferred.Deferred<Result, HostError>
}

interface State {
  pending: Map<RequestID, Entry>
}

export interface Interface {
  request(input: Input): Effect.Effect<Result, HostError>
  list(): Effect.Effect<ReadonlyArray<Request>>
  reply(input: { requestID: RequestID; result: Result }): Effect.Effect<void, NotFoundError>
  reject(input: { requestID: RequestID; error: Failure }): Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/SkillMarket") {}

export function layer(timeout: Duration.Input = "20 minutes") {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const state = yield* InstanceState.make<State>(
        Effect.fn("SkillMarket.state")(function* () {
          const state = { pending: new Map<RequestID, Entry>() }
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              for (const entry of state.pending.values()) {
                yield* bus.publish(Event.Cancelled, {
                  requestID: entry.info.id,
                  sessionID: entry.info.sessionID,
                  reason: "disposed",
                })
                yield* Deferred.fail(
                  entry.deferred,
                  new HostError({ code: "host_unavailable", detail: "The Skill Market host disconnected" }),
                )
              }
              state.pending.clear()
            }),
          )
          return state
        }),
      )

      const cancel = Effect.fn("SkillMarket.cancel")(function* (id: RequestID, reason: "cancelled" | "timeout") {
        const pending = (yield* InstanceState.get(state)).pending
        const entry = pending.get(id)
        if (!entry) return
        pending.delete(id)
        yield* bus.publish(Event.Cancelled, { requestID: id, sessionID: entry.info.sessionID, reason })
        yield* Deferred.fail(
          entry.deferred,
          new HostError({
            code: reason,
            detail: reason === "timeout" ? "The Skill Market host request timed out" : "The request was cancelled",
          }),
        )
      })

      const request: Interface["request"] = Effect.fn("SkillMarket.request")(function* (input) {
        const pending = (yield* InstanceState.get(state)).pending
        const id = RequestID.make(Identifier.create("smr", "ascending"))
        const deferred = yield* Deferred.make<Result, HostError>()
        const info = { ...input, id } as Request
        pending.set(id, { info, deferred })
        return yield* Effect.gen(function* () {
          yield* bus.publish(Event.Requested, info)
          return yield* Deferred.await(deferred).pipe(
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () => cancel(id, "timeout").pipe(Effect.andThen(Deferred.await(deferred))),
            }),
          )
        }).pipe(Effect.ensuring(cancel(id, "cancelled")))
      })

      const list: Interface["list"] = Effect.fn("SkillMarket.list")(function* () {
        return Array.from((yield* InstanceState.get(state)).pending.values(), (entry) => entry.info)
      })

      const reply: Interface["reply"] = Effect.fn("SkillMarket.reply")(function* (input) {
        const pending = (yield* InstanceState.get(state)).pending
        const entry = pending.get(input.requestID)
        if (!entry) {
          log.warn("reply for unknown request", { requestID: input.requestID })
          return yield* new NotFoundError({ requestID: input.requestID })
        }
        pending.delete(input.requestID)
        yield* Deferred.succeed(entry.deferred, input.result)
      })

      const reject: Interface["reject"] = Effect.fn("SkillMarket.reject")(function* (input) {
        const pending = (yield* InstanceState.get(state)).pending
        const entry = pending.get(input.requestID)
        if (!entry) {
          log.warn("rejection for unknown request", { requestID: input.requestID })
          return yield* new NotFoundError({ requestID: input.requestID })
        }
        pending.delete(input.requestID)
        yield* Deferred.fail(
          entry.deferred,
          new HostError({
            code: input.error.code,
            detail: input.error.message,
            transactionId: input.error.transactionId,
          }),
        )
      })

      return Service.of({ request, list, reply, reject })
    }),
  )
}

export const defaultLayer = layer().pipe(Layer.provide(Bus.layer))
export * as SkillMarket from "./service"
