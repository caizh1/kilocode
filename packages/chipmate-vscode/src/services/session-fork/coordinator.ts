import { randomUUID } from "node:crypto"
import type { Session } from "@chipmate/sdk/v2/client"
import type * as vscode from "vscode"
import { getErrorMessage } from "../../chipmate-provider-utils"
import type { ChipMateConnectionService } from "../cli-backend"
import { recordForkHandoff } from "../../agent-manager/fork-handoff"

const STORAGE_KEY = "chipmate.sessionFork.pending.v1"

export type SessionForkBoundary = { type: "full" } | { type: "after"; messageID: string }

export type SessionForkOperation = {
  operationID: string
  sourceSessionID: string
  directory?: string
  worktreeID?: string
  ownerID: string
  boundary: SessionForkBoundary
  startedAt: number
}

export type SessionForkEvent =
  | { type: "pending"; operation: SessionForkOperation }
  | { type: "complete"; operation: SessionForkOperation; session: Session }
  | { type: "error"; operation: SessionForkOperation; message: string }

type Listener = (event: SessionForkEvent) => void
type Flight = { operation: SessionForkOperation; promise: Promise<Session> }

export class SessionForkConflictError extends Error {
  constructor(message = "该会话已有另一个分支操作正在进行") {
    super(message)
    this.name = "SessionForkConflictError"
  }
}

function boundaryKey(boundary: SessionForkBoundary): string {
  return boundary.type === "after" ? `after:${boundary.messageID}` : "full"
}

function sourceKey(operation: Pick<SessionForkOperation, "sourceSessionID" | "directory">): string {
  return `${operation.directory ?? ""}\0${operation.sourceSessionID}`
}

function definitiveFailure(error: unknown, recovery: boolean): boolean {
  if (error instanceof SessionForkConflictError) return true
  if (!error || typeof error !== "object") return false
  const value = error as { _tag?: unknown; name?: unknown }
  if (value.name === "NotFoundError") return true
  if (value._tag === "SessionBusyError") return !recovery
  return ["BadRequest", "InvalidRequestError", "ConflictError"].includes(String(value._tag))
}

export class SessionForkCoordinator implements vscode.Disposable {
  private readonly flights = new Map<string, Flight>()
  private readonly listeners = new Set<Listener>()
  private readonly deliveries = new Set<string>()
  private readonly completions = new Map<string, Extract<SessionForkEvent, { type: "complete" }>>()
  private storageUpdate = Promise.resolve()
  private disposed = false

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connection: ChipMateConnectionService,
  ) {}

  subscribe(listener: Listener): vscode.Disposable {
    this.listeners.add(listener)
    for (const event of this.completions.values()) listener(event)
    return { dispose: () => this.listeners.delete(listener) }
  }

  active(sourceSessionID: string, directory?: string): SessionForkOperation | undefined {
    return this.flights.get(sourceKey({ sourceSessionID, directory }))?.operation
  }

  claim(sessionID: string, ownerID: string): boolean {
    void ownerID
    if (this.deliveries.has(sessionID)) return false
    this.deliveries.add(sessionID)
    for (const [operationID, event] of this.completions) {
      if (event.session.id === sessionID) this.completions.delete(operationID)
    }
    return true
  }

  execute(input: {
    sourceSessionID: string
    directory?: string
    worktreeID?: string
    ownerID: string
    boundary: SessionForkBoundary
    operationID?: string
    startedAt?: number
  }): Promise<Session> {
    if (this.disposed) return Promise.reject(new Error("分支协调器已停止"))
    const operation: SessionForkOperation = {
      ...input,
      operationID: input.operationID ?? randomUUID(),
      startedAt: input.startedAt ?? Date.now(),
    }
    const key = sourceKey(operation)
    const existing = this.flights.get(key)
    if (existing) {
      const sameBoundary = boundaryKey(existing.operation.boundary) === boundaryKey(operation.boundary)
      if (sameBoundary) return existing.promise
      return Promise.reject(new SessionForkConflictError())
    }

    const promise = this.run(operation, input.operationID !== undefined).finally(() => {
      if (this.flights.get(key)?.promise === promise) this.flights.delete(key)
    })
    this.flights.set(key, { operation, promise })
    this.emit({ type: "pending", operation })
    return promise
  }

  async recover(): Promise<void> {
    const pending = this.readPending()
    await Promise.allSettled(
      pending.map((operation) =>
        this.execute({ ...operation, operationID: operation.operationID, startedAt: operation.startedAt }),
      ),
    )
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    this.completions.clear()
  }

  private async run(operation: SessionForkOperation, recovery: boolean): Promise<Session> {
    await this.persist(operation)
    try {
      const client = this.connection.getClient()
      const status = await client.session.status(
        { ...(operation.directory ? { directory: operation.directory } : {}) },
        { throwOnError: true },
      )
      const active = status.data?.[operation.sourceSessionID]
      if (!recovery && active && active.type !== "idle") {
        throw new SessionForkConflictError("会话仍在运行，暂时不能创建分支")
      }

      const response = await client.session.fork(
        {
          sessionID: operation.sourceSessionID,
          ...(operation.directory ? { directory: operation.directory } : {}),
          ...(operation.boundary.type === "after" ? { afterMessageID: operation.boundary.messageID } : {}),
          operationID: operation.operationID,
        },
        { throwOnError: true },
      )
      const session = response.data
      await recordForkHandoff({
        client,
        sessionId: session.id,
        directory: operation.directory,
        operationID: operation.operationID,
      })
      await this.removePending(operation.operationID)
      this.emit({ type: "complete", operation, session })
      return session
    } catch (error) {
      if (definitiveFailure(error, recovery)) await this.removePending(operation.operationID)
      const message = getErrorMessage(error)
      this.emit({ type: "error", operation, message })
      throw error
    }
  }

  private emit(event: SessionForkEvent): void {
    if (event.type === "complete") this.completions.set(event.operation.operationID, event)
    for (const listener of this.listeners) listener(event)
  }

  private readPending(): SessionForkOperation[] {
    return this.context.workspaceState.get<SessionForkOperation[]>(STORAGE_KEY, [])
  }

  private async persist(operation: SessionForkOperation): Promise<void> {
    await this.updatePending((pending) => [
      ...pending.filter((item) => item.operationID !== operation.operationID),
      operation,
    ])
  }

  private async removePending(operationID: string): Promise<void> {
    await this.updatePending((pending) => pending.filter((item) => item.operationID !== operationID))
  }

  private updatePending(update: (pending: SessionForkOperation[]) => SessionForkOperation[]): Promise<void> {
    const next = this.storageUpdate.then(() => this.context.workspaceState.update(STORAGE_KEY, update(this.readPending())))
    this.storageUpdate = next.catch(() => undefined)
    return next
  }
}
