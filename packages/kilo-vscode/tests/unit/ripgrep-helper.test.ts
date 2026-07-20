import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ensureRipgrepForTarget } from "../../script/ripgrep-helper"

const configured = process.env.RIPGREP_MACOS_EXE

afterEach(() => {
  if (configured === undefined) {
    delete process.env.RIPGREP_MACOS_EXE
    return
  }
  process.env.RIPGREP_MACOS_EXE = configured
})

describe("ripgrep helper", () => {
  it("stages an executable macOS arm64 ripgrep", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-ripgrep-"))
    try {
      const src = path.join(root, "source-rg")
      const bin = path.join(root, "bin")
      await writeFile(src, "ripgrep")
      process.env.RIPGREP_MACOS_EXE = src

      await ensureRipgrepForTarget("darwin-arm64", bin)

      const dest = path.join(bin, "rg")
      expect(await readFile(dest, "utf8")).toBe("ripgrep")
      expect((await stat(dest)).mode & 0o111).not.toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
