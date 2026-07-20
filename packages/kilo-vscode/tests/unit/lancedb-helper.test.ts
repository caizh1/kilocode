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
})
