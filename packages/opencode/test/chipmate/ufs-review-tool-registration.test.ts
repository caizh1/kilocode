import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

const root = path.resolve(import.meta.dir, "../..")
const result = z.object({
  registered: z.boolean(),
  visible: z.record(z.string(), z.boolean()),
  tools: z.array(z.string()),
  customReviewer: z.object({ name: z.string(), native: z.boolean(), description: z.string().optional() }),
  taskDescriptions: z.array(z.string()),
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

const layer = Layer.mergeAll(AppNodeBuilder.build(Agent.node), AppNodeBuilder.build(ToolRegistry.node), AppNodeBuilder.build(CrossSpawnSpawner.node))
const output = await Effect.runPromise(provideTmpdirInstance(() => Effect.gen(function* () {
  const agents = yield* Agent.Service
  const registry = yield* ToolRegistry.Service
  const ids = yield* registry.ids()
  const visible = {}
  let ufsTools = []
  const taskDescriptions = []
  for (const name of ["ufs-reviewer", "code", "ask", "plan", "ultra", "reviewer"]) {
    const agent = yield* agents.get(name)
    const tools = yield* registry.tools({ providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model"), agent })
    visible[name] = tools.some((tool) => tool.id === "ufs_review")
    if (name === "ufs-reviewer") ufsTools = tools.map((tool) => tool.id).sort()
    if (["code", "ask", "plan", "ultra"].includes(name)) {
      const task = tools.find((tool) => tool.id === "task")
      if (task) taskDescriptions.push(task.description)
    }
  }
  const custom = yield* agents.get("reviewer")
  return {
    registered: ids.includes("ufs_review"),
    visible,
    tools: ufsTools,
    customReviewer: { name: custom.name, native: custom.native === true, description: custom.description },
    taskDescriptions,
  }
}), { git: true }).pipe(Effect.scoped, Effect.provide(layer)))
await disposeAllInstances()
process.stdout.write(JSON.stringify(output), () => process.exit(0))
`

describe("UFS Review 真实工具注册链", () => {
  test("工具只对专用 Agent 可见且不暴露 RAG/编辑能力", async () => {
    const storage = path.join(os.tmpdir(), `chipmate-ufs-review-tool-${crypto.randomUUID()}`)
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: root,
      env: {
        ...process.env,
        CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
        CHIPMATE_STORAGE_ROOT: storage,
        CHIPMATE_VSCODE_GLOBAL_STORAGE: storage,
        CHIPMATE_CONFIG_CONTENT: JSON.stringify({
          agent: { reviewer: { description: "用户自定义 Reviewer", mode: "primary" } },
        }),
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
    expect(output.visible).toEqual({
      "ufs-reviewer": true,
      code: false,
      ask: false,
      plan: false,
      ultra: false,
      reviewer: false,
    })
    expect(output.customReviewer).toEqual({ name: "reviewer", native: false, description: "用户自定义 Reviewer" })
    for (const description of output.taskDescriptions) {
      expect(description).not.toContain("ufs-reviewer")
      expect(description).not.toContain("ufs-review-")
    }
    expect(output.tools).toContain("ufs_review")
    expect(output.tools).toContain("read")
    expect(output.tools).not.toContain("edit")
    expect(output.tools).not.toContain("task")
    expect(output.tools).not.toContain("codebase_analysis")
    expect(output.tools).not.toContain("semantic_search")
    expect(output.tools).not.toContain("document_search")
    expect(output.tools).not.toContain("skill")
    expect(output.tools).not.toContain("websearch")
  }, 30_000)
})
