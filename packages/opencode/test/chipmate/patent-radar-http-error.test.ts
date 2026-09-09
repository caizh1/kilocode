import { describe, expect, test } from "bun:test"
import { errorMessage } from "../../src/chipmate/server/httpapi/handlers/patent-radar"

describe("Patent Radar HTTP 错误", () => {
  test("保留扫描失败的真实原因", () => {
    expect(errorMessage(new Error("远程模型端点不可用"))).toBe("远程模型端点不可用")
    expect(errorMessage({ message: "所选模型不存在" })).toBe("所选模型不存在")
  })

  test("无消息异常使用可读降级文本", () => {
    expect(errorMessage({ code: "UNKNOWN" })).toBe("Patent Radar 请求失败，请查看 ChipMate 输出日志。")
  })
})
