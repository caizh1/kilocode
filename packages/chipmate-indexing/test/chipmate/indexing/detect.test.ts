import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { hasIndexingPlugin, isIndexingPlugin, normalizePluginName } from "../../../src/detect"

describe("indexing plugin detection", () => {
  test("bundles detect module for browser targets", async () => {
    const dir = await mkdtemp(`${tmpdir()}/chipmate-indexing-detect-`)
    const result = await Bun.build({
      entrypoints: [fileURLToPath(new URL("../../../src/detect.ts", import.meta.url))],
      minify: true,
      outdir: dir,
      target: "browser",
    })

    expect(result.success).toBe(true)
  })

  test("normalizes supported plugin forms", () => {
    expect(normalizePluginName("chipmate-indexing")).toBe("chipmate-indexing")
    expect(normalizePluginName("chipmate-indexing@1.2.3")).toBe("chipmate-indexing")
    expect(normalizePluginName("@chipmate/chipmate-indexing")).toBe("@chipmate/chipmate-indexing")
    expect(normalizePluginName("@chipmate/chipmate-indexing@1.2.3")).toBe("@chipmate/chipmate-indexing")
    expect(normalizePluginName("../../packages/chipmate-indexing")).toBe("@chipmate/chipmate-indexing")
    expect(normalizePluginName("file:///tmp/.opencode/plugin/chipmate-indexing.js")).toBe("chipmate-indexing")
    expect(normalizePluginName("file:///tmp/node_modules/@chipmate/chipmate-indexing/index.js")).toBe(
      "@chipmate/chipmate-indexing",
    )
    expect(normalizePluginName("file:///tmp/repo/packages/chipmate-indexing/src/index.ts")).toBe("@chipmate/chipmate-indexing")
  })

  test("detects supported indexing plugin specifiers", () => {
    const values = [
      "chipmate-indexing",
      "chipmate-indexing@1.2.3",
      "@chipmate/chipmate-indexing",
      "@chipmate/chipmate-indexing@1.2.3",
      "../../packages/chipmate-indexing",
      "file:///tmp/.opencode/plugin/chipmate-indexing.js",
      "file:///tmp/node_modules/@chipmate/chipmate-indexing/index.js",
      "file:///tmp/repo/packages/chipmate-indexing/src/index.ts",
    ]

    for (const value of values) {
      expect(isIndexingPlugin(value)).toBe(true)
    }
  })

  test("ignores unrelated plugin specifiers", () => {
    expect(isIndexingPlugin("@chipmate/chipmate-gateway")).toBe(false)
    expect(isIndexingPlugin("file:///tmp/.opencode/plugin/index.js")).toBe(false)
    expect(hasIndexingPlugin(["@chipmate/chipmate-gateway", "foo@1.0.0"])).toBe(false)
  })

  test("detects indexing plugin in merged plugin lists", () => {
    expect(
      hasIndexingPlugin(["@chipmate/chipmate-gateway", "file:///tmp/node_modules/@chipmate/chipmate-indexing/index.js"]),
    ).toBe(true)
  })
})
