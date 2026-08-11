import { describe, expect, test } from "bun:test"
import { hasGateway, visible } from "./privacy"

describe("model privacy filter", () => {
  test("detects when ChipMate Gateway models are present", () => {
    expect(hasGateway([{ id: "chipmate" }, { id: "openai" }])).toBe(true)
    expect(hasGateway([{ id: "openai" }])).toBe(false)
  })

  test("shows every model when disabled", () => {
    expect(visible({ id: "chipmate" }, { mayTrainOnYourPrompts: true }, false)).toBe(true)
  })

  test("hides only ChipMate Gateway models explicitly marked for prompt training", () => {
    expect(visible({ id: "chipmate" }, { mayTrainOnYourPrompts: true }, true)).toBe(false)
    expect(visible({ id: "chipmate" }, { mayTrainOnYourPrompts: false }, true)).toBe(true)
    expect(visible({ id: "chipmate" }, {}, true)).toBe(true)
    expect(visible({ id: "openai" }, { mayTrainOnYourPrompts: true }, true)).toBe(true)
  })
})
