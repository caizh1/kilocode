import { Cause, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import type { Result } from "@/chipmate/turn-changes/schema"
import * as TurnChanges from "@/chipmate/turn-changes/runtime"

export const turnChangesHandlers = HttpApiBuilder.group(InstanceHttpApi, "turn-changes", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const changes = yield* TurnChanges.Service
    const authorize = (sessionID: SessionID) =>
      Effect.gen(function* () {
        const session = yield* sessions.get(sessionID)
        const instance = yield* InstanceState.context
        if (session.directory !== instance.directory) return yield* Effect.fail(new Error("会话不属于当前工作目录"))
      })
    const respond = <E, R>(work: Effect.Effect<Result, E, R>) =>
      work.pipe(
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause)
          return Effect.succeed<Result>({ ok: false, message: error instanceof Error ? error.message : String(error) })
        }),
      )
    return handlers
      .handle("get", ({ params }) =>
        respond(
          Effect.gen(function* () {
            yield* authorize(params.sessionID)
            const summary = yield* changes.get(params.sessionID, params.messageID)
            return { ok: true, summary }
          }),
        ),
      )
      .handle("detail", ({ params }) =>
        respond(
          Effect.gen(function* () {
            yield* authorize(params.sessionID)
            return { ok: true, detail: yield* changes.detail(params.sessionID, params.messageID, params.fileID) }
          }),
        ),
      )
      .handle("mutate", ({ params, payload }) =>
        respond(
          Effect.gen(function* () {
            yield* authorize(params.sessionID)
            return { ok: true, summary: yield* changes.mutate(params.sessionID, params.messageID, payload) }
          }),
        ),
      )
      .handle("external", ({ payload }) => respond(changes.external(payload.file).pipe(Effect.as({ ok: true }))))
  }),
)
