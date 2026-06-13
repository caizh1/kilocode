import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("qwen autocomplete manifest settings", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"))
  const props = pkg.contributes.configuration.properties

  it("declares disabled-by-default qwen-direct settings", () => {
    expect(props["kilo.autocomplete.enabled"]).toMatchObject({ type: "boolean", default: false })
    expect(props["kilo.autocomplete.provider"]).toMatchObject({
      type: "string",
      enum: ["qwen-direct", "none"],
      default: "none",
    })
    expect(props["kilo.autocomplete.qwen.endpoint"].default).toBe(
      "http://company-qwen-coder.example.com/v1/completions",
    )
    expect(props["kilo.autocomplete.qwen.model"].default).toBe("qwen-coder-30b0")
    expect(props["kilo.autocomplete.qwen.debounceMs"].default).toBe(350)
    expect(props["kilo.autocomplete.qwen.multifileContext.enabled"].default).toBe(false)
  })
})
