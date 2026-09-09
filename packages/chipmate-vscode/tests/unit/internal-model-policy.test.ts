import { describe, expect, it } from "bun:test"
import {
  isInternalModelHidden,
  partitionInternalModels,
  restoreInternalHiddenModels,
} from "../../webview-ui/src/utils/internal-model-policy"

describe("internal model policy", () => {
  it("hides GLM 5.2 aliases and suffix variants in internal builds", () => {
    const ids = [
      "glm-5.2",
      "Zhipu/GLM-5.2",
      "zai-org-glm-5-2",
      "accounts/fireworks/models/glm-5p2",
      "glm-5.2-air",
      "GLM 5 2",
    ]
    for (const modelID of ids) {
      expect(isInternalModelHidden({ modelID }, true), modelID).toBe(true)
    }
  })

  it("hides every Doubao model by provider or model identity", () => {
    expect(isInternalModelHidden({ providerID: "doubao", modelID: "ep-20260828" }, true)).toBe(true)
    expect(isInternalModelHidden({ providerName: "Doubao", modelID: "ep-20260828" }, true)).toBe(true)
    expect(isInternalModelHidden({ modelID: "doubao-seed-2.0-pro" }, true)).toBe(true)
    expect(isInternalModelHidden({ modelName: "ByteDance / Doubao Seed Code" }, true)).toBe(true)
    expect(isInternalModelHidden({ modelName: "豆包 Seed 2.0 Mini" }, true)).toBe(true)
  })

  it("keeps neighboring and unrelated models visible", () => {
    const ids = ["glm-5", "glm-5.1", "glm-5v-turbo", "gpt-5.2", "qwen3.8-27b", "deepseek-v4-flash"]
    for (const modelID of ids) {
      expect(isInternalModelHidden({ modelID }, true), modelID).toBe(false)
    }
  })

  it("does not change normal builds", () => {
    expect(isInternalModelHidden({ modelID: "glm-5.2" }, false)).toBe(false)
    expect(isInternalModelHidden({ modelID: "doubao-seed-2.0-pro" }, false)).toBe(false)
  })

  it("partitions hidden provider models and restores their original configuration", () => {
    const models = {
      "qwen3.8-27b": { name: "Qwen 3.8", reasoning: true },
      endpoint: {
        name: "GLM 5.2",
        reasoning: true,
        variants: { max: { reasoningEffort: "max" } },
      },
      "doubao-seed-code": { name: "Doubao Seed Code", modalities: { input: ["text"] } },
    }
    const result = partitionInternalModels(
      {
        providerID: "internal",
        providerName: "Internal",
        models,
        modelName: (model) => model.name,
      },
      true,
    )

    expect(Object.keys(result.visible)).toEqual(["qwen3.8-27b"])
    expect(Object.keys(result.hidden)).toEqual(["endpoint", "doubao-seed-code"])
    expect(restoreInternalHiddenModels(result.visible, result.hidden)).toEqual(models)
  })
})
