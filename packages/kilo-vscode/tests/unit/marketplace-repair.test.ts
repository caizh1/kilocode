import { describe, expect, it } from "bun:test"
import { repairContent } from "../../src/services/marketplace/repair"

describe("Marketplace AI repair output", () => {
  it("accepts only bounded JSON content and normalizes line endings", () => {
    expect(
      repairContent(
        '```json\n{"content":"# Skill\\r\\n\\r\\nUse detailed source evidence for every conclusion."}\n```',
      ),
    ).toBe("# Skill\n\nUse detailed source evidence for every conclusion.\n")
    expect(() => repairContent("not json")).toThrow("did not return JSON")
    expect(() => repairContent('{"content":"short"}')).toThrow("content is invalid")
  })
})
