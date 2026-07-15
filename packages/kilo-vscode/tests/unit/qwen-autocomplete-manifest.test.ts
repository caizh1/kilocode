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
    expect(props["kilo.autocomplete.qwen.endpoint"]).toBeUndefined()
    expect(props["kilo.autocomplete.qwen.apiKey"]).toBeUndefined()
    expect(props["kilo.autocomplete.qwen.model"].default).toBe("qwen-coder-30b0")
    expect(props["kilo-code.new.autocomplete.model"].enum).toContain("qwen-coder-30b0")
    expect(props["kilo-code.new.autocomplete.provider"].enum).toBeUndefined()
    expect(props["kilo-code.new.autocomplete.provider"].examples).toContain("your-connected-provider-id")
    expect(props["kilo.autocomplete.qwen.debounceMs"].default).toBe(350)
    expect(props["kilo.autocomplete.qwen.maxPromptTokens"].default).toBe(1024)
    expect(props["kilo.autocomplete.qwen.prefixPercentage"].default).toBe(0.3)
    expect(props["kilo.autocomplete.qwen.maxSuffixPercentage"].default).toBe(0.2)
    expect(props["kilo.autocomplete.qwen.modelTimeout"].default).toBe(150)
    expect(props["kilo.autocomplete.qwen.temperature"].default).toBe(0.01)
    expect(props["kilo.autocomplete.qwen.cache.enabled"].default).toBe(true)
    expect(props["kilo.autocomplete.qwen.cache.maxEntries"].default).toBe(1000)
    expect(props["kilo.autocomplete.qwen.multifileContext.enabled"].default).toBe(false)
    expect(props["kilo.autocomplete.qwen.contextLength"].default).toBe(0)
    expect(props["kilo.autocomplete.qwen.context.recentlyEdited.enabled"].default).toBe(false)
    expect(props["kilo.autocomplete.qwen.context.recentlyEdited.injectIntoPrompt"].default).toBe(false)
    expect(props["kilo.autocomplete.qwen.context.recentlyEdited.maxRanges"].default).toBe(3)
    expect(props["kilo.autocomplete.qwen.context.recentlyEdited.maxRangeLines"].default).toBe(20)
    expect(props["kilo.autocomplete.qwen.context.recentlyOpened.enabled"].default).toBe(false)
    expect(props["kilo.autocomplete.qwen.context.recentlyOpened.injectIntoPrompt"].default).toBe(false)
    expect(props["kilo.autocomplete.qwen.context.recentlyOpened.maxFiles"].default).toBe(20)
    expect(props["kilo.autocomplete.qwen.context.recentlyOpened.fileReadTimeoutMs"].default).toBe(80)
    expect(props["kilo.autocomplete.qwen.context.importDefinitions.enabled"].default).toBe(false)
    expect(props["kilo.autocomplete.qwen.context.importDefinitions.injectIntoPrompt"].default).toBe(false)
    expect(props["kilo.autocomplete.qwen.context.importDefinitions.timeoutMs"].default).toBe(100)
    expect(props["kilo.autocomplete.qwen.context.importDefinitions.cacheSize"].default).toBe(10)
    expect(props["kilo.autocomplete.qwen.context.rootPath.enabled"].default).toBe(false)
    expect(props["kilo.autocomplete.qwen.context.rootPath.injectIntoPrompt"].default).toBe(false)
    expect(props["kilo.autocomplete.qwen.context.rootPath.timeoutMs"].default).toBe(100)
    expect(props["kilo.autocomplete.qwen.context.rootPath.cacheSize"].default).toBe(100)
    expect(props["kilo.autocomplete.qwen.trace"].default).toBe(false)
    expect(props["kilo.autocomplete.qwen.logLevel"]).toMatchObject({
      enum: ["off", "info", "debug"],
      default: "off",
    })
    expect(props["kilo.autocomplete.qwen.logPromptPreview"].default).toBe(false)
    expect(props["kilo.autocomplete.qwen.logCompletionPreview"].default).toBe(true)
  })
})
