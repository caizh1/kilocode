import { describe, expect, it } from "bun:test"
import { completesWithoutStatus } from "../../src/chipmate-provider/command-completion"

describe("completesWithoutStatus", () => {
  it("matches only deprecated static review aliases", () => {
    expect(completesWithoutStatus("local-review")).toBe(true)
    expect(completesWithoutStatus("local-review-uncommitted")).toBe(true)
    expect(completesWithoutStatus("review")).toBe(false)
    expect(completesWithoutStatus("init")).toBe(false)
  })
})
