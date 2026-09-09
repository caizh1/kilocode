import { expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { Skill } from "../../src/skill"
import { InstanceState } from "../../src/effect/instance-state"
import { ProductProfile } from "../../src/chipmate/product-profile"
import { stat } from "node:fs/promises"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Command.node, Config.node, Skill.node])))
it.instance(
  "内置 Spec 不绑定模型或 Agent，也不进入全局 Skill 列表",
  () =>
    Effect.gen(function* () {
      const commands = yield* Command.Service
      const skills = yield* Skill.Service
      const spec = yield* commands.get("spec")
      expect(spec?.model).toBeUndefined()
      expect(spec?.agent).toBeUndefined()
      expect(spec?.template).not.toContain("<spec-skill>")
      expect((yield* skills.all()).some((item) => item.name === "spec")).toBe(false)
    }),
  { git: true },
)
it.instance(
  "命令模型覆盖仅绑定 Spec，列出命令不创建任务或加载 Spec Skill",
  () =>
    Effect.gen(function* () {
      const commands = yield* Command.Service
      const config = yield* Config.Service
      const skills = yield* Skill.Service
      const instance = yield* InstanceState.context
      const spec = yield* commands.get("spec")
      expect(spec?.source).toBe("command")
      expect(spec?.model).toBe("本地验收/Qwen3.8-27B")
      expect(spec?.agent).toBeUndefined()
      expect(spec?.subtask).toBe(false)
      expect((yield* config.get()).model).toBe("普通配置/普通模型")
      expect((yield* skills.all()).some((skill) => skill.name === "spec")).toBe(false)
      const exists = yield* Effect.promise(() =>
        stat(ProductProfile.project(instance.directory, "artifacts", "spec")).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false
            throw error
          },
        ),
      )
      expect(exists).toBe(false)
    }),
  { git: true, config: { model: "普通配置/普通模型", command: { spec: { model: "本地验收/Qwen3.8-27B" } } } },
)
