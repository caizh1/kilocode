import type { ChipMateClient, Session } from "@chipmate/sdk/v2/client"
import { getErrorMessage } from "../chipmate-provider-utils"
import { TelemetryProxy, TelemetryEventName } from "../services/telemetry"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { PLATFORM } from "./constants"
import { recordForkHandoff } from "./fork-handoff"
import type { SessionForkCoordinator } from "../services/session-fork/coordinator"

export interface ForkContext {
  getClient: () => ChipMateClient
  state: WorktreeStateManager | undefined
  directory: string | undefined
  postError: (message: string) => void
  registerWorktreeSession: (sessionId: string, directory: string) => void
  pushState: () => void
  notifyForked: (session: Session, forkedFromId: string, worktreeId?: string) => void
  registerSession: (session: Session) => void
  log: (...args: unknown[]) => void
  coordinator?: SessionForkCoordinator
  ownerID?: string
}

/**
 * Fork a session via the CLI backend, register the new session in state,
 * and notify the webview.
 *
 * Pure orchestration — no vscode imports.
 */
export async function forkSession(
  ctx: ForkContext,
  sessionId: string,
  worktreeId?: string,
  messageId?: string,
): Promise<Session | null> {
  let client: ChipMateClient
  try {
    client = ctx.getClient()
  } catch (err) {
    ctx.log("forkSession: client not available:", err)
    ctx.postError("Not connected to CLI backend")
    return null
  }

  const directory = (() => {
    if (!worktreeId || !ctx.state) return ctx.directory
    return ctx.state.getWorktree(worktreeId)?.path ?? ctx.directory
  })()

  let forked: Session
  try {
    if (ctx.coordinator) {
      forked = await ctx.coordinator.execute({
        sourceSessionID: sessionId,
        directory,
        worktreeID: worktreeId,
        ownerID: ctx.ownerID ?? "agent-manager",
        boundary: messageId ? { type: "after", messageID: messageId } : { type: "full" },
      })
      if (!ctx.coordinator.claim(forked.id, ctx.ownerID ?? "agent-manager")) return forked
    } else {
      const input = { sessionID: sessionId, directory, ...(messageId ? { messageID: messageId } : {}) }
      const { data } = await client.session.fork(input, { throwOnError: true })
      forked = data
    }
  } catch (error) {
    const err = getErrorMessage(error)
    ctx.postError(`Failed to fork session: ${err}`)
    TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_SESSION_ERROR, {
      source: PLATFORM,
      error: err,
      context: "forkSession",
      sessionId,
    })
    return null
  }

  if (worktreeId && ctx.state) {
    ctx.state.addSession(forked.id, worktreeId)
    if (directory) ctx.registerWorktreeSession(forked.id, directory)
  }

  if (!ctx.coordinator) {
    await recordForkHandoff({ client, sessionId: forked.id, directory }).catch((err) => {
      ctx.log("forkSession: failed to record fork handoff:", getErrorMessage(err))
    })
  }

  ctx.pushState()
  ctx.notifyForked(forked, sessionId, worktreeId)
  ctx.registerSession(forked)
  ctx.log(`Forked session ${sessionId} → ${forked.id}${worktreeId ? ` in worktree ${worktreeId}` : ""}`)
  return forked
}
