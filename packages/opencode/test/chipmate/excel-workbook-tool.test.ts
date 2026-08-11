import { describe, expect } from "bun:test"
import { Agent } from "@/agent/agent"
import { Instance } from "@/chipmate/instance"
import { CreateExcelWorkbookTool } from "@/chipmate/tool/excel-workbook"
import { MessageID, SessionID } from "@/session/schema"
import * as Tool from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import { Truncate } from "@/tool/truncate"
import { ProviderTransform } from "@/provider/transform"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, Truncate.defaultLayer))

function context(asks: Parameters<Tool.Context["ask"]>[0][]): Tool.Context {
  return {
    sessionID: SessionID.make("ses_excel_workbook"),
    messageID: MessageID.make("msg_excel_workbook"),
    agent: "code",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: (input) => Effect.sync(() => asks.push(input)),
  }
}

describe("create_excel_workbook tool", () => {
  it.effect("暴露模型无关的浅层对象 Schema", () =>
    Effect.gen(function* () {
      const tool = yield* CreateExcelWorkbookTool.pipe(Effect.flatMap(Tool.init))
      const schema = ToolJsonSchema.fromTool(tool)
      const source = JSON.stringify(schema)

      expect(schema.type).toBe("object")
      expect(schema.anyOf).toBeUndefined()
      expect(schema.oneOf).toBeUndefined()
      expect(schema.required).toEqual(["title", "sheets"])
      expect(source).toContain('"sheets"')
      expect(source).toContain('"headers"')
      expect(source).toContain('"rows"')
      expect(source).not.toMatch(/providerID|modelID/i)
    }),
  )

  it.effect("通过标准 OpenAI-compatible Provider Schema 转换", () =>
    Effect.gen(function* () {
      const tool = yield* CreateExcelWorkbookTool.pipe(Effect.flatMap(Tool.init))
      const schema = ToolJsonSchema.fromTool(tool)
      const transformed = ProviderTransform.schema(
        {
          providerID: "openai-compatible",
          api: { id: "tool-schema-regression" },
        } as Parameters<typeof ProviderTransform.schema>[0],
        schema,
      )
      const source = JSON.stringify(transformed)

      expect(transformed.type).toBe("object")
      expect(transformed.required).toEqual(["title", "sheets"])
      expect(source).toContain('"headers"')
      expect(source).toContain('"rows"')
      expect(source).not.toMatch(/providerID|modelID/i)
    }),
  )

  it.instance(
    "沿用标准权限并返回已校验的工作区相对路径",
    () =>
      Effect.gen(function* () {
        const tool = yield* CreateExcelWorkbookTool.pipe(Effect.flatMap(Tool.init))
        const asks: Parameters<Tool.Context["ask"]>[0][] = []
        const result = yield* tool.execute(
          {
            title: "通用模型导出",
            sheets: [{ name: "结果", headers: ["项目", "得分"], rows: [["A", 95]] }],
          },
          context(asks),
        )

        expect(asks).toHaveLength(1)
        expect(asks[0]).toMatchObject({
          permission: "create_excel_workbook",
          patterns: ["通用模型导出"],
        })
        expect(result.metadata).toMatchObject({
          verified: true,
          sheetCount: 1,
          rowCount: 1,
          cellCount: 4,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        })
        expect(result.metadata.path).toStartWith(".chipmate")
        expect(result.metadata.path).toEndWith("/通用模型导出.xlsx")
        const exists = yield* Effect.promise(() => Bun.file(`${Instance.directory}/${result.metadata.path!}`).exists())
        expect(exists).toBe(true)
        expect(result.output).toContain(result.metadata.path!)
      }),
    { git: true },
  )

  it.instance(
    "将运行时数据错误返回给模型重试且不伪造路径",
    () =>
      Effect.gen(function* () {
        const tool = yield* CreateExcelWorkbookTool.pipe(Effect.flatMap(Tool.init))
        const result = yield* tool.execute(
          {
            title: "错列",
            sheets: [{ name: "结果", headers: ["A", "B"], rows: [["少一列"]] }],
          },
          context([]),
        )

        expect(result.metadata).toMatchObject({ failed: true, verified: false })
        expect(result.metadata.path).toBeUndefined()
        expect(result.output).toContain("修正工具参数后重试")
      }),
    { git: true },
  )
})
