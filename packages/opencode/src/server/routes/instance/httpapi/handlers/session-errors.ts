import type { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import type { Session } from "@/session/session"
import { Effect } from "effect"
import * as ApiError from "../errors"

export function mapStorageNotFound<A, R>(self: Effect.Effect<A, StorageNotFoundError, R>) {
  return self.pipe(Effect.mapError((error) => ApiError.notFound(error.message)))
}

export function mapBusy<A, R>(self: Effect.Effect<A, Session.BusyError, R>) {
  return self.pipe(
    Effect.catchTag("SessionBusyError", (error) =>
      Effect.fail(
        new ApiError.SessionBusyError({
          sessionID: error.sessionID,
          message: `Session is busy: ${error.sessionID}`,
        }),
      ),
    ),
  )
}

// chipmate_change start - map durable fork validation and conflict failures to explicit HTTP errors
export function mapFork<A, E, R>(self: Effect.Effect<A, E | Session.ForkError, R>) {
  return self.pipe(
    Effect.catchTag("SessionForkError", (error) => {
      const fork = error as Session.ForkError
      const mapped: ApiError.InvalidRequestError | ApiError.ConflictError =
        fork.kind === "invalid-boundary"
          ? new ApiError.InvalidRequestError({ message: fork.message, kind: fork.kind, field: "messageID" })
          : new ApiError.ConflictError({ message: fork.message, resource: "session-fork" })
      return Effect.fail(mapped)
    }),
  )
}
// chipmate_change end
