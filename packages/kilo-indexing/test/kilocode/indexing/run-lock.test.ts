import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { basename, join } from "path"
import { IndexingRunLock } from "../../../src/indexing/run-lock"
import { workspaceKey } from "../../../src/indexing/workspace-key"

describe("IndexingRunLock", () => {
  test("allows only one active workspace indexing run", async () => {
    const root = await mkdtemp(join(tmpdir(), "lock-root-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "lock-cache-"))

    const first = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
    expect(first.status).toBe("acquired")

    const second = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
    expect(second.status).toBe("held")

    if (first.status === "acquired") await first.lock.release()

    const third = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
    expect(third.status).toBe("acquired")
    if (third.status === "acquired") await third.lock.release()
  })

  test("uses one lock for normalized aliases of the same workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "lock-root-"))
    const alias = `${root}/../${basename(root)}`
    const cacheDir = await mkdtemp(join(tmpdir(), "lock-cache-"))

    const first = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
    const second = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: alias })

    expect(first.status).toBe("acquired")
    expect(second.status).toBe("held")
    if (first.status === "acquired") await first.lock.release()
  })

  test("creates the cache directory before acquiring the lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "lock-root-"))
    const parent = await mkdtemp(join(tmpdir(), "lock-cache-parent-"))
    const cacheDir = join(parent, "missing", "indexing")

    const lock = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })

    expect(lock.status).toBe("acquired")
    if (lock.status === "acquired") await lock.lock.release()
  })

  test("removes malformed stale lock directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "lock-root-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "lock-cache-"))
    await mkdir(lockDir(cacheDir, root))

    const lock = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })

    expect(lock.status).toBe("acquired")
    if (lock.status === "acquired") {
      expect(lock.staleRemoved).toBe(true)
      expect(lock.staleReason).toBe("malformed lock")
      await lock.lock.release()
    }
  })

  test("removes locks owned by exited pids", async () => {
    const root = await mkdtemp(join(tmpdir(), "lock-root-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "lock-cache-"))
    const dir = lockDir(cacheDir, root)
    await mkdir(dir)
    await writeFile(
      join(dir, "lock.json"),
      JSON.stringify({
        runId: "old",
        workspacePath: root,
        pid: 99999999,
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
      }),
    )

    const lock = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })

    expect(lock.status).toBe("acquired")
    if (lock.status === "acquired") {
      expect(lock.staleRemoved).toBe(true)
      expect(lock.staleReason).toBe("owner pid exited")
      await lock.lock.release()
    }
  })

  test("does not remove active locks for a mismatched workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "lock-root-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "lock-cache-"))
    const dir = lockDir(cacheDir, root)
    await mkdir(dir)
    await writeFile(
      join(dir, "lock.json"),
      JSON.stringify({
        runId: "other",
        workspacePath: `${root}-other`,
        pid: process.pid,
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
      }),
    )

    const lock = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })

    expect(lock.status).toBe("held")
    if (lock.status === "held") {
      expect(lock.reason).toBe("workspace mismatch")
    }
  })
})

function lockDir(cacheDirectory: string, workspacePath: string): string {
  return join(cacheDirectory, `indexing-lock-${workspaceKey(workspacePath)}`)
}
