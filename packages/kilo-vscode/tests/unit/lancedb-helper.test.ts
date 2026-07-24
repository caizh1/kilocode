import { describe, expect, it } from "bun:test"
import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { copyLanceDBRuntime } from "../../script/lancedb-helper"

describe("LanceDB helper", () => {
  it("stages the macOS arm64 native runtime", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-lancedb-"))
    try {
      await copyLanceDBRuntime(root, "darwin-arm64")

      const native = path.join(
        root,
        "lancedb",
        "node_modules",
        "@lancedb",
        "lancedb-darwin-arm64",
        "lancedb.darwin-arm64.node",
      )
      expect(await access(native).then(() => true)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("stages both Windows native runtimes for the baseline package", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-lancedb-"))
    try {
      await copyLanceDBRuntime(root, "win32-x64", ["win32-arm64"])

      const modules = path.join(root, "lancedb", "node_modules", "@lancedb")
      expect(
        await access(path.join(modules, "lancedb-win32-x64-msvc", "lancedb.win32-x64-msvc.node")).then(() => true),
      ).toBe(true)
      expect(
        await access(path.join(modules, "lancedb-win32-arm64-msvc", "lancedb.win32-arm64-msvc.node")).then(() => true),
      ).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
