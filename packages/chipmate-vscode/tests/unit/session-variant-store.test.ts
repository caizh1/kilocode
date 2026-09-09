import { describe, expect, it } from "bun:test"
import {
  cycleVariant,
  getVariant,
  sessionVariantKeys,
  sessionVariants,
  transferVariants,
  variantKey,
} from "../../webview-ui/src/context/session-variant-store"
import type { ModelSelection } from "../../webview-ui/src/types/messages"

const model: ModelSelection = { providerID: "anthropic", modelID: "claude-sonnet-4" }
const variants = ["low", "medium", "high"]

describe("per-session variant selection", () => {
  it("keeps reasoning effort independent for each Agent Manager session", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "session-a")] = "low"
    store[variantKey(model, "code", "session-b")] = "high"

    expect(getVariant(store, model, variants, "code", "session-a")).toBe("low")
    expect(getVariant(store, model, variants, "code", "session-b")).toBe("high")
  })

  it("keeps reasoning effort independent for each pending local tab", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "pending-local-1")] = "medium"
    store[variantKey(model, "code", "pending-local-2")] = "high"

    expect(getVariant(store, model, variants, "code", "pending-local-1")).toBe("medium")
    expect(getVariant(store, model, variants, "code", "pending-local-2")).toBe("high")
  })

  it("keeps no-session reasoning effort independent per agent", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code")] = "medium"
    store[variantKey(model, "ask")] = "high"

    expect(getVariant(store, model, variants, "code")).toBe("medium")
    expect(getVariant(store, model, variants, "ask")).toBe("high")
  })

  it("carries the pre-submit agent variant into a newly created session", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code")] = "medium"

    expect(getVariant(store, model, variants, "code", "session-a")).toBe("medium")
  })

  it("prefers a session variant over the pre-submit agent variant", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code")] = "medium"
    store[variantKey(model, "code", "session-a")] = "high"

    expect(getVariant(store, model, variants, "code", "session-a")).toBe("high")
  })

  it("falls back to the legacy provider/model variant key", () => {
    const store: Record<string, string> = { "anthropic/claude-sonnet-4": "medium" }

    expect(getVariant(store, model, variants, "code", "session-a")).toBe("medium")
  })

  for (const invalid of ["high", "max"]) {
    it(`falls back from the removed Qwen3.8 ${invalid} effort to its xhigh default`, () => {
      const qwen: ModelSelection = { providerID: "chipmate", modelID: "qwen3.8-27b" }
      const store: Record<string, string> = { [variantKey(qwen, "ask")]: invalid }

      expect(getVariant(store, qwen, ["xhigh", "medium", "low", "none"], "ask")).toBe("xhigh")
    })
  }

  it("preserves a saved Qwen3.8 disabled-thinking selection", () => {
    const qwen: ModelSelection = { providerID: "chipmate", modelID: "qwen3.8-27b" }
    const store: Record<string, string> = { [variantKey(qwen, "ask")]: "none" }

    expect(getVariant(store, qwen, ["xhigh", "medium", "low", "none"], "ask")).toBe("none")
  })

  for (const invalid of ["low", "medium", "none"]) {
    it(`falls back from invalid GLM 5.2 selection ${invalid} to max`, () => {
      const glm: ModelSelection = { providerID: "custom", modelID: "glm-5.2" }
      const store: Record<string, string> = { [variantKey(glm, "ask")]: invalid }

      expect(getVariant(store, glm, ["max", "high"], "ask")).toBe("max")
    })
  }

  for (const id of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
    for (const invalid of ["low", "medium"]) {
      it(`falls back from invalid ${id} selection ${invalid} to max`, () => {
        const deepseek: ModelSelection = { providerID: "custom", modelID: id }
        const store: Record<string, string> = { [variantKey(deepseek, "ask")]: invalid }

        expect(getVariant(store, deepseek, ["max", "high", "thinking", "none"], "ask")).toBe("max")
      })
    }
  }

  for (const invalid of ["low", "medium", "high", "max", "auto"]) {
    it(`falls back from invalid Doubao selection ${invalid} to thinking`, () => {
      const doubao: ModelSelection = { providerID: "custom", modelID: "doubao-seed-2.0-pro" }
      const store: Record<string, string> = { [variantKey(doubao, "ask")]: invalid }

      expect(getVariant(store, doubao, ["thinking", "none"], "ask")).toBe("thinking")
    })
  }

  it("transfers a pending local tab variant to the created session", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "pending-local-1")] = "medium"
    Object.assign(store, transferVariants(store, "pending-local-1", "session-a"))

    expect(getVariant(store, model, variants, "code", "session-a")).toBe("medium")
  })

  it("extracts persisted session variant preferences", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "session-a")] = "medium"
    store[variantKey(model, "code", "session-b")] = "high"

    expect(sessionVariants(store, "session-a")).toEqual({ "anthropic/claude-sonnet-4": "medium" })
  })

  it("finds only variant keys for the requested session", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "pending-local-1")] = "medium"
    store[variantKey(model, "code", "pending-local-2")] = "high"

    expect(sessionVariantKeys(store, "pending-local-1")).toEqual(["session/pending-local-1/anthropic/claude-sonnet-4"])
  })
})

describe("cycleVariant", () => {
  it("advances to the next variant", () => {
    expect(cycleVariant("low", variants)).toBe("medium")
    expect(cycleVariant("medium", variants)).toBe("high")
  })

  it("wraps back to the first variant after the last", () => {
    expect(cycleVariant("high", variants)).toBe("low")
  })

  it("starts at the first variant when current is missing or unknown", () => {
    expect(cycleVariant(undefined, variants)).toBe("low")
    expect(cycleVariant("bogus", variants)).toBe("low")
  })

  it("returns undefined when no variants exist", () => {
    expect(cycleVariant("low", [])).toBeUndefined()
  })
})
