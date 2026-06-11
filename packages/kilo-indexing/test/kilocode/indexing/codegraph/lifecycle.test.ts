import { describe, expect, test } from "bun:test"
import { CodeGraphSidecarLifecycle, disabledCodeGraphSidecarStatus } from "../../../../src/indexing/codegraph"

describe("CodeGraphSidecarLifecycle", () => {
  test("starts and stops idempotently without claiming evidence", () => {
    const time = { now: 1000 }
    const sidecar = new CodeGraphSidecarLifecycle({
      workspacePath: "/tmp/ws",
      cacheDirectory: "/tmp/cache",
      clock: () => time.now,
    })

    expect(sidecar.status()).toMatchObject({
      state: "stopped",
      enabled: false,
      evidenceAvailable: false,
      transitions: [],
    })

    time.now += 1
    const first = sidecar.start("first-start")
    time.now += 1
    const second = sidecar.start("second-start")

    expect(first.state).toBe("container_ready")
    expect(second.state).toBe("container_ready")
    expect(second.evidenceAvailable).toBe(false)
    expect(second.detail).toContain("graph evidence")
    expect(second.transitions).toEqual([
      {
        state: "container_ready",
        reason: "first-start",
        timestamp: 1001,
      },
    ])

    time.now += 1
    const stopped = sidecar.stop("first-stop")
    time.now += 1
    const repeated = sidecar.stop("second-stop")

    expect(stopped.state).toBe("stopped")
    expect(repeated.state).toBe("stopped")
    expect(repeated.transitions).toHaveLength(2)
    expect(repeated.transitions[1]).toEqual({
      state: "stopped",
      reason: "first-stop",
      timestamp: 1003,
    })
  })

  test("restarts as stop plus start and ignores start after dispose", () => {
    const time = { now: 2000 }
    const sidecar = new CodeGraphSidecarLifecycle({
      workspacePath: "/tmp/ws",
      cacheDirectory: "/tmp/cache",
      clock: () => time.now,
    })

    time.now += 1
    sidecar.start("boot")
    time.now += 1
    const restarted = sidecar.restart("restart")

    expect(restarted.state).toBe("container_ready")
    expect(restarted.transitions).toEqual([
      { state: "container_ready", reason: "boot", timestamp: 2001 },
      { state: "stopped", reason: "restart", timestamp: 2002 },
      { state: "container_ready", reason: "restart", timestamp: 2002 },
    ])

    time.now += 1
    const disposed = sidecar.dispose("done")
    time.now += 1
    const started = sidecar.start("after-dispose")
    time.now += 1
    const restartedAfterDispose = sidecar.restart("restart-after-dispose")
    time.now += 1
    const disposedAgain = sidecar.dispose("again")

    expect(disposed.state).toBe("disposed")
    expect(started.state).toBe("disposed")
    expect(restartedAfterDispose.state).toBe("disposed")
    expect(disposedAgain.state).toBe("disposed")
    expect(disposedAgain.transitions).toHaveLength(4)
    expect(disposedAgain.transitions[3]).toEqual({
      state: "disposed",
      reason: "done",
      timestamp: 2003,
    })
  })

  test("returns a disabled status stub", () => {
    const status = disabledCodeGraphSidecarStatus({
      workspacePath: "/tmp/ws",
      reason: "indexing-disabled",
      clock: () => 3000,
    })

    expect(status).toEqual({
      state: "disabled",
      enabled: false,
      evidenceAvailable: false,
      detail: "indexing-disabled",
      workspacePath: "/tmp/ws",
      snippetLimit: 240,
      transitions: [
        {
          state: "disabled",
          reason: "indexing-disabled",
          timestamp: 3000,
        },
      ],
    })
  })
})
