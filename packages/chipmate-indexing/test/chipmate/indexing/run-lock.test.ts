import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "fs/promises"
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

  test("does not steal a live pid lock only because its heartbeat is stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "lock-root-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "lock-cache-"))
    const dir = lockDir(cacheDir, root)
    await mkdir(dir)
    await writeFile(
      join(dir, "lock.json"),
      JSON.stringify({
        runId: "live",
        workspacePath: root,
        pid: process.pid,
        startedAt: Date.now() - 300_000,
        heartbeatAt: Date.now() - 300_000,
      }),
    )

    const lock = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })

    expect(lock.status).toBe("held")
    if (lock.status === "held") expect(lock.reason).toBe("owner pid alive with stale heartbeat")
  })

  test("does not remove a replacement lock when an old owner releases", async () => {
    const root = await mkdtemp(join(tmpdir(), "lock-root-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "lock-cache-"))
    const first = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
    expect(first.status).toBe("acquired")
    if (first.status !== "acquired") return
    const file = join(lockDir(cacheDir, root), "lock.json")
    const info = JSON.parse(await readFile(file, "utf-8")) as Record<string, unknown>
    await writeFile(file, JSON.stringify({ ...info, runId: "replacement" }))

    await first.lock.release()
    const next = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })

    expect(next.status).toBe("held")
    if (next.status === "held") expect(next.owner?.runId).toBe("replacement")
  })

  test("uses an independent lock namespace for documents", async () => {
    const root = await mkdtemp(join(tmpdir(), "lock-root-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "lock-cache-"))
    const code = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
    const documents = await IndexingRunLock.acquire({
      cacheDirectory: cacheDir,
      workspacePath: root,
      kind: "documents",
    })

    expect(code.status).toBe("acquired")
    expect(documents.status).toBe("acquired")
    if (code.status === "acquired") await code.lock.release()
    if (documents.status === "acquired") await documents.lock.release()
  })
})

function lockDir(cacheDirectory: string, workspacePath: string): string {
  return join(cacheDirectory, `indexing-lock-${workspaceKey(workspacePath)}`)
}
