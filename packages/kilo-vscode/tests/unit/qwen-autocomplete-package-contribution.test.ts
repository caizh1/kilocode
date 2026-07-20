import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packagePath = path.resolve(import.meta.dir, "../../package.json")
const extensionPath = path.resolve(import.meta.dir, "../../src/extension.ts")

describe("qwen-direct autocomplete smoke boundary", () => {
  test("keeps qwen-direct autocomplete settings and provider registration available", async () => {
    const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"))
    const extension = await fs.readFile(extensionPath, "utf8")
    const coordinator = await fs.readFile(
      path.resolve(import.meta.dir, "../../src/services/autocomplete/index.ts"),
      "utf8",
    )
    const properties = pkg.contributes?.configuration?.properties ?? {}

    expect(properties["chipmate.v2.autocomplete.provider"]?.examples).toContain("your-connected-provider-id")
    expect(properties["chipmate.v2.autocomplete.qwen.model"]?.description).toContain("Qwen Coder")
    expect(extension).toContain("registerAutocompleteProvider(context, connectionService, coexistence)")
    expect(coordinator).toContain("registerQwenAutocompleteProvider(context, connection, gate)")
  })
})
