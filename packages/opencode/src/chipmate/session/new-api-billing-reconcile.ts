import { Database } from "@opencode-ai/core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import type { MessageID, PartID, SessionID } from "@/session/schema"
import { NewAPIBilling } from "./new-api-billing"

export namespace NewAPIBillingReconcile {
  type Row = {
    partID: PartID
    messageID: MessageID
    sessionID: SessionID
  }

  export const pending = Effect.fn("NewAPIBillingReconcile.pending")(function* (sessionIDs: SessionID[]) {
    if (sessionIDs.length === 0) return
    const { db } = yield* Database.Service
    const sessions = yield* Session.Service
    const providers = yield* Provider.Service
    const rows = yield* db
      .all<Row>(sql`
        SELECT id AS partID, message_id AS messageID, session_id AS sessionID
        FROM part
        WHERE session_id IN (${sql.join(
          sessionIDs.map((id) => sql`${id}`),
          sql`,`,
        )})
          AND json_extract(data, '$.type') = 'step-finish'
          AND json_extract(data, '$.billing.status') = 'pending'`)
      .pipe(Effect.orDie)

    yield* Effect.forEach(
      rows,
      (row) =>
        Effect.gen(function* () {
          const part = yield* sessions.getPart(row)
          if (part?.type !== "step-finish" || part.billing?.status !== "pending") return
          const billing = part.billing
          const message = yield* MessageV2.get({ sessionID: row.sessionID, messageID: row.messageID })
          if (message.info.role !== "assistant") return
          const modelRef = part.model ?? {
            providerID: message.info.providerID,
            modelID: message.info.modelID,
          }
          const update = (billing: NewAPIBilling.Billing) => sessions.updatePart({ ...part, billing })
          const model = yield* providers.getModel(modelRef.providerID, modelRef.modelID).pipe(Effect.option)
          if (model._tag === "None") {
            yield* update({
              status: "unavailable",
              source: "new-api-log",
              requestID: billing.requestID,
              reason: "model-mismatch",
            })
            return
          }
          const provider = yield* providers.getProvider(modelRef.providerID)
          const target = NewAPIBilling.target({
            baseURL: provider.options.baseURL ?? model.value.api.url,
            apiKey: provider.key ?? provider.options.apiKey,
          })
          if (typeof target === "string") {
            yield* update({
              status: "unavailable",
              source: "new-api-log",
              requestID: billing.requestID,
              reason: target,
            })
            return
          }
          const startedAt = part.time?.start
          const completedAt = part.time?.end
          if (startedAt === undefined || completedAt === undefined) {
            yield* update({
              status: "unavailable",
              source: "new-api-log",
              requestID: billing.requestID,
              reason: "invalid-response",
            })
            return
          }
          yield* Effect.tryPromise({
            try: () =>
              NewAPIBilling.settleOnce({
                target,
                requestID: billing.requestID,
                modelNames: [model.value.id, model.value.api.id, modelRef.modelID],
                startedAt,
                completedAt,
              }),
            catch: () =>
              ({
                status: "unavailable",
                source: "new-api-log",
                requestID: billing.requestID,
                reason: "network",
              }) as const,
          }).pipe(Effect.flatMap(update), Effect.ignore, Effect.forkDetach)
        }),
      { discard: true },
    )
  })
}
