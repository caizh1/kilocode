import { describe, expect, test } from "bun:test"
import { resolveFimTarget } from "../src/fim"

describe("FIM target resolution", () => {
  test("keeps gateway autocomplete models on ChipMate Gateway", () => {
    expect(resolveFimTarget("chipmate", "mistralai/codestral-2508")).toEqual({
      provider: "chipmate",
      model: "mistralai/codestral-2508",
      url: "https://api.chipmate.ai/api/fim/completions",
    })
    expect(resolveFimTarget("chipmate", "inception/mercury-edit-2")).toEqual({
      provider: "chipmate",
      model: "inception/mercury-edit-2",
      url: "https://api.chipmate.ai/api/fim/completions",
    })
  })

  test("routes explicit provider autocomplete models directly", () => {
    expect(resolveFimTarget("mistral", "codestral-2508")).toEqual({
      provider: "mistral",
      model: "codestral-2508",
    })
    expect(resolveFimTarget("inception", "mercury-edit-2")).toEqual({
      provider: "inception",
      model: "mercury-edit-2",
      url: "https://api.inceptionlabs.ai/v1/fim/completions",
    })
  })

  test("preserves gateway model pass-through behavior", () => {
    expect(resolveFimTarget()).toEqual({
      provider: "chipmate",
      model: "mistralai/codestral-2501",
      url: "https://api.chipmate.ai/api/fim/completions",
    })
    expect(resolveFimTarget(undefined, "mistralai/codestral-2508")).toEqual({
      provider: "chipmate",
      model: "mistralai/codestral-2508",
      url: "https://api.chipmate.ai/api/fim/completions",
    })
    expect(resolveFimTarget(undefined, "inception/mercury-edit")).toEqual({
      provider: "chipmate",
      model: "inception/mercury-edit",
      url: "https://api.chipmate.ai/api/fim/completions",
    })
    expect(resolveFimTarget("chipmate", "custom/fim-model")).toEqual({
      provider: "chipmate",
      model: "custom/fim-model",
      url: "https://api.chipmate.ai/api/fim/completions",
    })
  })
})
