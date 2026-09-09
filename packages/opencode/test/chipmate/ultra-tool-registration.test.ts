import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

const root = path.resolve(import.meta.dir, "../..")
const result = z.object({
  registered: z.boolean(),
  executable: z.boolean(),
  visible: z.record(z.string(), z.boolean()),
})

const script = `
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Agent } from "./src/agent/agent.ts"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ToolRegistry } from "./src/tool/registry.ts"
import { disposeAllInstances, provideTmpdirInstance } from "./test/fixture/fixture.ts"

const layer = Layer.mergeAll(
  AppNodeBuilder.build(Agent.node),
  AppNodeBuilder.build(ToolRegistry.node),
  AppNodeBuilder.build(CrossSpawnSpawner.node),
)
const output = await Effect.runPromise(
  provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        const visible = {}
        let executable = false
        for (const name of ["ultra", "code", "ask", "explore"]) {
          const agent = yield* agents.get(name)
          const tools = yield* registry.tools({
            providerID: ProviderV2.ID.make("test"),
            modelID: ModelV2.ID.make("model"),
            agent,
          })
          visible[name] = tools.some((tool) => tool.id === "ultra_verify")
          if (name === "ultra") executable = typeof tools.find((tool) => tool.id === "ultra_verify")?.execute === "function"
        }
        return { registered: ids.includes("ultra_verify"), executable, visible }
      }),
    { git: true },
  ).pipe(Effect.scoped, Effect.provide(layer)),
)
await disposeAllInstances()
process.stdout.write(JSON.stringify(output), () => process.exit(0))
`

describe("Ultra 真实工具注册链", () => {
  test(
    "只向原生 Ultra 暴露已经注册的 ultra_verify",
    async () => {
      const storage = path.join(os.tmpdir(), `chipmate-ultra-tool-registration-${crypto.randomUUID()}`)
      const child = Bun.spawn([process.execPath, "-e", script], {
        cwd: root,
        env: {
          ...process.env,
          CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
          CHIPMATE_STORAGE_ROOT: storage,
          CHIPMATE_VSCODE_GLOBAL_STORAGE: storage,
          CHIPMATE_CONFIG_CONTENT: "{}",
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]).finally(() => fs.rm(storage, { recursive: true, force: true }))

      expect(status, stderr).toBe(0)
      const start = stdout.lastIndexOf('{"registered":')
      const output = result.parse(JSON.parse(stdout.slice(start)))
      expect(output.registered).toBe(true)
      expect(output.executable).toBe(true)
      expect(output.visible).toEqual({ ultra: true, code: false, ask: false, explore: false })
    },
    30_000,
  )
})
