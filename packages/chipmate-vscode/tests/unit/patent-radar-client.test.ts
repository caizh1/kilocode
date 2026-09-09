import { describe, expect, it } from "bun:test"
import { PatentRadarClient, patentRadarErrorMessage, patentRadarEvidenceBatches } from "../../src/patent-radar/client"

describe("Patent Radar 客户端错误", () => {
  it("读取后端结构化错误中的真实消息", () => {
    expect(
      patentRadarErrorMessage({
        _tag: "InvalidRequestError",
        kind: "patent-radar",
        message: "所选模型不存在",
      }),
    ).toBe("所选模型不存在")
  })

  it("兼容 SDK 嵌套错误且不再显示 object Object", () => {
    expect(patentRadarErrorMessage({ error: { message: "模型服务不可用" } })).toBe("模型服务不可用")
    expect(patentRadarErrorMessage({ _tag: "BadRequest" })).toBe("请求失败（BadRequest）")
  })

  it("循环错误对象安全降级", () => {
    const error: Record<string, unknown> = {}
    error.cause = error
    expect(patentRadarErrorMessage(error)).toBe("Patent Radar 请求失败")
  })

  it("大型运行的证据请求按接口上限分批且不丢 ID", () => {
    const ids = Array.from({ length: 451 }, (_value, index) => `E${index}`)
    const batches = patentRadarEvidenceBatches(ids)
    expect(batches.map((batch) => batch.length)).toEqual([200, 200, 51])
    expect(batches.flat()).toEqual(ids)
  })

  it("模块范围预览把完整 ScanScope 放入 SDK body", async () => {
    const scope = {
      kind: "module" as const,
      corePaths: ["src/driver"],
      expansionPolicy: "quality-first" as const,
    }
    let request: unknown
    const connection = {
      getClientAsync: async () => ({
        patentRadar: {
          previewScope: async (value: unknown) => {
            request = value
            return {
              data: {
                scope,
                scopeFingerprint: "scope-1",
                coverage: {
                  coreFiles: [],
                  dependencyFiles: [],
                  documentFiles: [],
                  supportingFiles: [],
                  selectedEvidence: 0,
                  workspaceEvidence: 0,
                  workspacePercent: 0,
                  closureComplete: true,
                  requiresConfirmation: false,
                  excludedBoundaries: [],
                  warnings: [],
                },
                estimatedModelCalls: 0,
              },
            }
          },
        },
      }),
    }

    await new PatentRadarClient(connection as never).previewScope("/workspace", scope)

    expect(request).toEqual({ directory: "/workspace", body: scope })
  })
})
