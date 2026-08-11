import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Command } from "../../src/command"
import { semanticExploreCommand } from "../../src/chipmate/semantic-explore/command"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Command.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("semantic-explore command", () => {
  test("定义只读语义定位工作流", async () => {
    const command = semanticExploreCommand()
    const template = await command.template

    expect(command.name).toBe("semantic-explore")
    expect(command.description).toBe("使用语义检索探索未知实现，并用精确搜索验证")
    expect(command.agent).toBe("explore")
    expect(command.source).toBe("command")
    expect(command.hints).toEqual(["$ARGUMENTS"])
    expect(template).toContain("不要修改代码")
    expect(template).toContain("$ARGUMENTS")
    expect(template.match(/`semantic_search`/g)).toHaveLength(1)
    expect(template).toContain("最多保留 3 个")
    expect(template).toContain("不要默认排名第一就是正确答案")
    expect(template).toContain("`grep`")
    expect(template).toContain("`read`")
    expect(template).toContain("`glob`")
    expect(template).toContain("定稿前必须做一次反证检查")
    expect(template).toContain("至少使用 `read` 阅读 1 处最相关证据")
    expect(template).toContain("实际保证什么、不保证什么")
    expect(template).toContain("不得把结构校验、候选隔离、回读或回滚写成特定异常检测")
    expect(template).toContain("关键反证和保护边界")
    expect(template).toContain("语义检索是否真正提供了额外价值")
  })

  it.live("在任意工作区列出并解析内置命令", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const service = yield* Command.Service
          const list = yield* service.list()
          const command = list.find((item) => item.name === "semantic-explore")
          const resolved = yield* service.get("semantic-explore")

          expect(command).toMatchObject({
            name: "semantic-explore",
            agent: "explore",
            source: "command",
          })
          expect(resolved).toMatchObject({
            name: "semantic-explore",
            agent: "explore",
            source: "command",
          })
          const template = yield* Effect.promise(async () => resolved?.template)
          expect(template).toContain("待探索的用户功能意图：$ARGUMENTS")
        }),
      { git: true },
    ),
  )
})
