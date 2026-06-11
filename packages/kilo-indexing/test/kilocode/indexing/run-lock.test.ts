import { describe, expect, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { IndexingRunLock } from "../../../src/indexing/run-lock"

describe("IndexingRunLock", () => {
  test("allows only one active workspace indexing run", async () => {
    const root = await mkdtemp(join(tmpdir(), "lock-root-"))
    const cacheDir = await mkdtemp(join(tmpdir(), "lock-cache-"))

    const first = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
    expect(first).toBeDefined()

    const second = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
    expect(second).toBeUndefined()

    await first?.release()

    const third = await IndexingRunLock.acquire({ cacheDirectory: cacheDir, workspacePath: root })
    expect(third).toBeDefined()
    await third?.release()
  })
})
