import type { Session, SessionStatus } from "@chipmate/sdk/v2/client"
import type { ChipMateConnectionService } from "../services/cli-backend"
import { forkSession } from "../agent-manager/fork-session"
import type { SessionForkCoordinator } from "../services/session-fork/coordinator"

export interface ForkContext {
  connection: ChipMateConnectionService
  post: (message: Record<string, unknown> & { type: string }) => void
  register: (session: Session) => void
  forked: (session: Session, sourceID: string) => void
  status: (sessionID: string) => SessionStatus["type"] | undefined
  directory: (sessionID: string) => string
  coordinator?: SessionForkCoordinator
  ownerID: string
}

export async function handleForkSession(ctx: ForkContext, sessionId: string, afterMessageId?: string): Promise<void> {
  if (ctx.coordinator) {
    ctx.post({ type: "sessionForkState", sessionID: sessionId, afterMessageID: afterMessageId, state: "pending" })
    const slow = setTimeout(
      () =>
        ctx.post({ type: "sessionForkState", sessionID: sessionId, afterMessageID: afterMessageId, state: "slow" }),
      10_000,
    )
    try {
      const directory = ctx.directory(sessionId)
      const session = await ctx.coordinator.execute({
        sourceSessionID: sessionId,
        directory,
        ownerID: ctx.ownerID,
        boundary: afterMessageId ? { type: "after", messageID: afterMessageId } : { type: "full" },
      })
      if (!ctx.coordinator.claim(session.id, ctx.ownerID)) return
      ctx.register(session)
      ctx.forked(session, sessionId)
      ctx.post({ type: "sessionForkState", sessionID: sessionId, afterMessageID: afterMessageId, state: "complete" })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.post({ type: "sessionForkState", sessionID: sessionId, afterMessageID: afterMessageId, state: "error", message })
      ctx.post({ type: "error", message: `创建分支失败：${message}` })
    } finally {
      clearTimeout(slow)
    }
    return
  }
  const status =
    ctx.status(sessionId) ??
    (await Promise.resolve()
      .then(() =>
        ctx.connection.getClient().session.status({ directory: ctx.directory(sessionId) }, { throwOnError: true }),
      )
      .then((result) => result.data?.[sessionId]?.type ?? "idle")
      .catch((e) => {
        console.error("[ChipMate New] refreshForkStatus failed:", e)
        return "busy" as SessionStatus["type"]
      }))
  if (status !== "idle") {
    ctx.post({ type: "error", message: "Wait for the session to finish before forking it." })
    return
  }

  await forkSession(
    {
      getClient: () => ctx.connection.getClient(),
      state: undefined,
      directory: ctx.directory(sessionId),
      postError: (message) => ctx.post({ type: "error", message }),
      registerWorktreeSession: () => {},
      pushState: () => {},
      notifyForked: (session) => {
        ctx.register(session)
        ctx.forked(session, sessionId)
      },
      registerSession: () => {},
      log: (...args) => console.log("[ChipMate New] ChipMateProvider:", ...args),
    },
    sessionId,
    undefined,
    afterMessageId,
  )
}
