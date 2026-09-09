import { describe, expect, it, mock } from "bun:test"
import type { Session } from "@chipmate/sdk/v2/client"
import { SessionForkConflictError, SessionForkCoordinator } from "../../src/services/session-fork/coordinator"

function state(initial: unknown[] = []) {
  let value = initial
  return {
    get: <T>(_key: string, fallback: T) => (value as T) ?? fallback,
    update: async (_key: string, next: unknown) => {
      value = next as unknown[]
    },
    value: () => value,
  }
}

function fixture(initial: unknown[] = []) {
  const workspaceState = state(initial)
  const target = { id: "ses_target", title: "target" } as Session
  const status = mock(async () => ({ data: {} }))
  const fork = mock(async () => ({ data: target }))
  const messages = mock(async () => ({ data: [] }))
  const promptAsync = mock(async () => ({}))
  const client = { session: { status, fork, messages, promptAsync } }
  const coordinator = new SessionForkCoordinator(
    { workspaceState } as never,
    { getClient: () => client } as never,
  )
  return { coordinator, workspaceState, status, fork, messages, promptAsync, target }
}

describe("SessionForkCoordinator", () => {
  it("twenty rapid clicks share one backend fork and one target", async () => {
    const item = fixture()
    const requests = Array.from({ length: 20 }, () =>
      item.coordinator.execute({
        sourceSessionID: "ses_source",
        directory: "/repo",
        ownerID: "sidebar",
        boundary: { type: "after", messageID: "msg_answer" },
      }),
    )
    const results = await Promise.all(requests)

    expect(new Set(results.map((result) => result.id))).toEqual(new Set(["ses_target"]))
    expect(item.status).toHaveBeenCalledTimes(1)
    expect(item.fork).toHaveBeenCalledTimes(1)
    expect(item.promptAsync).toHaveBeenCalledTimes(1)
    expect(item.fork.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        sessionID: "ses_source",
        directory: "/repo",
        afterMessageID: "msg_answer",
        operationID: expect.any(String),
      }),
    )
    expect(item.workspaceState.value()).toEqual([])
  })

  it("rejects a different boundary while the source flight is active", async () => {
    let release: (() => void) | undefined
    const item = fixture()
    item.fork.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: item.target })
        }),
    )
    const first = item.coordinator.execute({
      sourceSessionID: "ses_source",
      directory: "/repo",
      ownerID: "sidebar",
      boundary: { type: "after", messageID: "msg_one" },
    })
    await expect(
      item.coordinator.execute({
        sourceSessionID: "ses_source",
        directory: "/repo",
        ownerID: "agent-manager",
        boundary: { type: "after", messageID: "msg_two" },
      }),
    ).rejects.toBeInstanceOf(SessionForkConflictError)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(release).toBeDefined()
    release!()
    await first
  })

  it("clears a new operation when the authoritative source status is busy", async () => {
    const item = fixture()
    item.status.mockImplementation(async () => ({ data: { ses_source: { type: "busy" } } }))

    await expect(
      item.coordinator.execute({
        sourceSessionID: "ses_source",
        directory: "/repo",
        ownerID: "sidebar",
        boundary: { type: "after", messageID: "msg_answer" },
      }),
    ).rejects.toBeInstanceOf(SessionForkConflictError)

    expect(item.fork).not.toHaveBeenCalled()
    expect(item.workspaceState.value()).toEqual([])
  })

  it("still sends a persisted retry when the source became busy so the server can resolve its operation ID", async () => {
    const operation = {
      operationID: crypto.randomUUID(),
      sourceSessionID: "ses_source",
      directory: "/repo",
      ownerID: "sidebar",
      boundary: { type: "after" as const, messageID: "msg_answer" },
      startedAt: Date.now(),
    }
    const item = fixture([operation])
    item.status.mockImplementation(async () => ({ data: { ses_source: { type: "busy" } } }))

    await item.coordinator.recover()

    expect(item.status).toHaveBeenCalledTimes(1)
    expect(item.fork).toHaveBeenCalledTimes(1)
    expect(item.fork.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ operationID: operation.operationID }))
    let recovered: string | undefined
    item.coordinator.subscribe((event) => {
      if (event.type === "complete" && event.operation.ownerID === "sidebar") recovered = event.session.id
    })
    expect(recovered).toBe(item.target.id)
  })
})
