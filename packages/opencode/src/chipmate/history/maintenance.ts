import { createHash, randomUUID } from "crypto"
import { Duration, Effect, Option } from "effect"
import { InstanceStore } from "@/project/instance-store"
import { SessionStatus } from "@/session/status"

const TIMEOUT = 60_000
let gate: { token: string; expires: number } | undefined

function clearExpired() {
  if (gate && gate.expires <= Date.now()) gate = undefined
}

function directoryID(directory: string) {
  return createHash("sha256").update(directory).digest("hex").slice(0, 12)
}

export namespace HistoryMigrationMaintenance {
  export function blocked() {
    clearExpired()
    return gate !== undefined
  }

  export function assertAvailable() {
    if (blocked()) throw new Error("聊天历史正在维护，请稍后重试")
  }

  export const prepare = Effect.fn("HistoryMigrationMaintenance.prepare")(function* () {
    clearExpired()
    if (gate)
      return { ready: false as const, token: null, expiresAt: gate.expires, active: [], reason: "locked" as const }
    const token = randomUUID()
    gate = { token, expires: Date.now() + TIMEOUT }
    const store = yield* InstanceStore.Service
    const loaded = yield* store.listLoaded().pipe(Effect.timeoutOption(Duration.seconds(5)))
    if (Option.isNone(loaded)) {
      gate = undefined
      return { ready: false as const, token: null, expiresAt: null, active: [], reason: "locked" as const }
    }
    const contexts = loaded.value
    const scan = () =>
      Effect.forEach(
        contexts,
        (ctx) =>
          store
            .provide(
              { directory: ctx.directory, project: ctx.project, worktree: ctx.worktree },
              SessionStatus.Service.use((service) => service.list()),
            )
            .pipe(
              Effect.map((statuses) => ({
                directoryID: directoryID(ctx.directory),
                sessions: [...statuses]
                  .filter(([, status]) => status.type !== "idle")
                  .map(([sessionID, status]) => ({ sessionID, status: status.type })),
              })),
            ),
        { concurrency: 4 },
      )
    const firstResult = yield* scan().pipe(Effect.timeoutOption(Duration.seconds(5)))
    if (Option.isNone(firstResult)) {
      gate = undefined
      return { ready: false as const, token: null, expiresAt: null, active: [], reason: "locked" as const }
    }
    const first = firstResult.value
    yield* Effect.sleep(Duration.millis(50))
    const secondResult = yield* scan().pipe(Effect.timeoutOption(Duration.seconds(5)))
    if (Option.isNone(secondResult)) {
      gate = undefined
      return { ready: false as const, token: null, expiresAt: null, active: [], reason: "locked" as const }
    }
    const second = secondResult.value
    const active = first.map((item, index) => ({
      directoryID: item.directoryID,
      sessions: [
        ...new Map(
          [...item.sessions, ...(second[index]?.sessions ?? [])].map((session) => [session.sessionID, session]),
        ).values(),
      ],
    }))
    const busy = active.filter((item) => item.sessions.length > 0)
    if (busy.length > 0) {
      gate = undefined
      return { ready: false as const, token: null, expiresAt: null, active: busy, reason: "active" as const }
    }
    return { ready: true as const, token, expiresAt: gate.expires, active: [], reason: null }
  })

  export function release(token: string) {
    clearExpired()
    if (!gate || gate.token !== token) return false
    gate = undefined
    return true
  }
}
