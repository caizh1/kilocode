import { describe, expect, test } from "bun:test"
import { filterPackagedModelsSnapshot } from "../../../script/chipmate/models-snapshot-filter"

describe("打包模型快照品牌过滤", () => {
  test("始终排除旧产品 provider 并保留额外排除配置", () => {
    const filtered = filterPackagedModelsSnapshot(
      {
        kilo: { name: "旧产品网关" },
        chipmate: { name: "ChipMate" },
        private: { name: "私有 provider" },
        openai: { name: "OpenAI" },
      },
      " private ",
    )

    expect(filtered).toEqual({
      chipmate: { name: "ChipMate" },
      openai: { name: "OpenAI" },
    })
  })
})
