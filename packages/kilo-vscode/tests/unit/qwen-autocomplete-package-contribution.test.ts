import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packagePath = path.resolve(import.meta.dir, "../../package.json")
const extensionPath = path.resolve(import.meta.dir, "../../src/extension.ts")

describe("qwen-direct autocomplete smoke boundary", () => {
  test("keeps qwen-direct autocomplete settings and provider registration available", async () => {
    const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"))
    const extension = await fs.readFile(extensionPath, "utf8")
    const properties = pkg.contributes?.configuration?.properties ?? {}

    expect(properties["kilo.autocomplete.provider"]?.enum).toContain("qwen-direct")
    expect(properties["kilo.autocomplete.qwen.model"]?.description).toContain("Qwen Coder")
    expect(extension).toContain("registerQwenAutocompleteProvider(context)")
  })
})
