import { describe, expect, test } from "bun:test"
import { KiloConnectionService } from "./connection-service"

describe("KiloConnectionService drainPendingPrompts", () => {
  test("ignores stale NotFoundError replies while draining permissions", async () => {
    const service = new KiloConnectionService({
      subscriptions: [],
      globalStorageUri: { fsPath: "/tmp/kilo-connection-test" },
    } as any)
    const client = {
      project: {
        list: async () => ({ data: [] }),
      },
      permission: {
        list: async () => ({ data: [{ id: "per_test" }] }),
        reply: async () => ({ error: { name: "NotFoundError", data: { message: "missing" } } }),
      },
      question: {
        list: async () => ({ data: [] }),
      },
      suggestion: {
        list: async () => ({ data: [] }),
      },
      network: {
        list: async () => ({ data: [] }),
      },
    }

    ;(service as any).client = client
    ;(service as any).directoryProviders.add(() => ["/tmp/workspace"])

    await expect(service.drainPendingPrompts()).resolves.toBeUndefined()
  })
})

describe("KiloConnectionService connect", () => {
  test("shares the connection attempt before notifying re-entrant listeners", async () => {
    const service = new KiloConnectionService({
      subscriptions: [],
      globalStorageUri: { fsPath: "/tmp/kilo-connection-test" },
    } as any)
    const calls = { count: 0 }
    const target = service as unknown as { doConnect: (dir: string) => Promise<void> }
    target.doConnect = async () => {
      calls.count++
    }

    const stop = service.onStateChange((state) => {
      if (state === "connecting") void service.connect("/tmp/workspace")
    })

    await service.connect("/tmp/workspace")
    stop()

    expect(calls.count).toBe(1)
  })
})
