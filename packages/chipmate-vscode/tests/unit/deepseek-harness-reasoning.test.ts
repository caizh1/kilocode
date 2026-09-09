import { describe, expect, mock, test } from "bun:test"
import {
  projectDeepSeekHarnessReasoning,
  selectDeepSeekHarnessReasoningEffort,
  type DeepSeekHarnessModelDirectory,
  type DeepSeekHarnessModelDirectoryState,
} from "../../webview-ui/src/context/deepseek-harness-reasoning"

const efforts = [
  { id: "off", name: "Off" },
  { id: "high", name: "High" },
  { id: "max", name: "Max" },
]

function state(reasoningEffort?: string): DeepSeekHarnessModelDirectoryState {
  return {
    current: {
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    },
    groups: [
      {
        id: "deepseek-official",
        name: "DeepSeek",
        models: [
          {
            id: "deepseek-v4-flash",
            name: "DeepSeek V4 Flash",
            reasoning: { efforts, defaultEffort: "high" },
          },
        ],
      },
    ],
  }
}

function directory(current: DeepSeekHarnessModelDirectoryState, select = mock(async () => undefined)) {
  return {
    value: {
      store: {
        getSnapshot: () => current,
        subscribe: () => () => undefined,
      },
      load: async () => undefined,
      select,
    } satisfies DeepSeekHarnessModelDirectory,
    select,
  }
}

describe("DeepSeek Harness 推理强度", () => {
  test("未显式选择时使用官方默认 High", () => {
    expect(projectDeepSeekHarnessReasoning(state())).toEqual({ efforts, value: "high" })
  })

  test.each(["off", "max"])("选择 %s 时保持官方 provider 和 model", async (effort) => {
    const target = directory(state())
    await selectDeepSeekHarnessReasoningEffort(target.value, effort)
    expect(target.select).toHaveBeenCalledWith({
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      reasoningEffort: effort,
    })
  })

  test("拒绝官方当前模型未公布的推理强度", async () => {
    const target = directory(state())
    await expect(selectDeepSeekHarnessReasoningEffort(target.value, "low")).rejects.toThrow(
      "官方 DSH 当前模型不支持推理强度 low",
    )
    expect(target.select).not.toHaveBeenCalled()
  })

  test("官方选择失败时不覆盖原选择", async () => {
    const current = state("high")
    const target = directory(
      current,
      mock(async () => Promise.reject(new Error("官方选择失败"))),
    )
    await expect(selectDeepSeekHarnessReasoningEffort(target.value, "max")).rejects.toThrow("官方选择失败")
    expect(projectDeepSeekHarnessReasoning(current)?.value).toBe("high")
  })
})
