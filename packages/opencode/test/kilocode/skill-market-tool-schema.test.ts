import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Agent } from "../../src/agent/agent"
import { SkillMarket } from "../../src/kilocode/skill-market/service"
import { SkillTransactionTool } from "../../src/kilocode/tool/skill-market"
import { ToolJsonSchema } from "../../src/tool/json-schema"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { testEffect } from "../lib/effect"

const layer = Layer.mergeAll(
  Layer.mock(SkillMarket.Service, {}),
  Layer.mock(Truncate.Service, {}),
  Layer.mock(Agent.Service, {}),
)
const it = testEffect(layer)

describe("Skill Market 工具 Schema", () => {
  it.effect("为 DeepSeek 提供对象根节点并保留事务分支约束", () =>
    Effect.gen(function* () {
      const info = yield* SkillTransactionTool
      const tool = yield* Tool.init(info)
      const schema = ToolJsonSchema.fromTool(tool)

      expect(schema.type).toBe("object")
      expect(schema.anyOf).toHaveLength(3)
      expect(schema.anyOf).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ required: ["action", "skillId", "scope", "intents"] }),
          expect.objectContaining({ required: ["action", "transactionId"] }),
          expect.objectContaining({ required: ["action"] }),
        ]),
      )

      const valid = yield* Schema.decodeUnknownEffect(tool.parameters)({
        action: "begin",
        skillId: "hello-skill",
        scope: "project",
        intents: ["create"],
      })
      expect(valid).toEqual({
        action: "begin",
        skillId: "hello-skill",
        scope: "project",
        intents: ["create"],
      })

      const invalid = yield* Effect.exit(
        Schema.decodeUnknownEffect(tool.parameters)({
          action: "begin",
          scope: "project",
          intents: ["create"],
        }),
      )
      expect(invalid._tag).toBe("Failure")
    }),
  )
})
