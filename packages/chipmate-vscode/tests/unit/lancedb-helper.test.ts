import { describe, expect, it } from "bun:test"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { copyLanceDBRuntime, lancedbRuntimeEntry } from "../../script/lancedb-helper"

describe("LanceDB helper", () => {
  it("stages the macOS arm64 native runtime", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-lancedb-"))
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
      const telemetry = path.join(root, "lancedb", "node_modules", "@opentelemetry", "api", "build", "src", "index.js")
      expect(await access(telemetry).then(() => true)).toBe(true)

      const runtime = await import(pathToFileURL(lancedbRuntimeEntry(root)).href)
      expect(runtime.connect ?? runtime.default?.connect).toBeFunction()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it("stages both Windows native runtimes for the baseline package", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-lancedb-"))
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

  it("replaces the Windows x64 native runtime with an audited smaller local-only build", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-lancedb-"))
    try {
      const replacement = path.join(root, "lancedb-local-only.node")
      const pe = Buffer.alloc(70)
      pe.write("MZ", 0, "ascii")
      pe.writeUInt32LE(64, 60)
      pe.write("PE\0\0", 64, "binary")
      pe.writeUInt16LE(0x8664, 68)
      await writeFile(replacement, pe)

      await copyLanceDBRuntime(root, "win32-x64", [], { "win32-x64": replacement })

      const native = path.join(
        root,
        "lancedb",
        "node_modules",
        "@lancedb",
        "lancedb-win32-x64-msvc",
        "lancedb.win32-x64-msvc.node",
      )
      expect(await readFile(native)).toEqual(pe)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
