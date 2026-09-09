import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

const root = path.resolve(import.meta.dir, "../..")
const schema = z.object({
  names: z.array(z.string()),
  selected: z.string(),
  code: z.object({
    mode: z.string(),
    native: z.boolean(),
    model: z.unknown().optional(),
    variant: z.string().optional(),
    prompt: z.string().optional(),
  }),
  ultra: z
    .object({
      mode: z.string(),
      native: z.boolean(),
      hidden: z.boolean(),
      name: z.string(),
      id: z.string().optional(),
      appends: z.boolean(),
      prompt: z.string().optional(),
    })
    .nullable(),
  baseline: z
    .object({
      mode: z.string(),
      native: z.boolean(),
      hidden: z.boolean(),
      id: z.string().optional(),
      model: z.unknown().optional(),
      variant: z.string().optional(),
      prompt: z.string().optional(),
      ordinary: z.string(),
      internal: z.string(),
      edit: z.string(),
      bash: z.string(),
      task: z.string(),
    })
    .nullable(),
  synthesis: z
    .object({
      mode: z.string(),
      native: z.boolean(),
      hidden: z.boolean(),
      id: z.string().optional(),
      ordinary: z.string(),
      internal: z.string(),
    })
    .nullable(),
  permissions: z.record(
    z.string(),
    z.object({
      code: z.string(),
      ultra: z.string().nullable(),
    }),
  ),
  council: z.record(
    z.string(),
    z.object({
      code: z.boolean(),
      ultra: z.boolean().nullable(),
    }),
  ),
})

const script = [
  'import { Effect } from "effect"',
  'import { Agent } from "./src/agent/agent.ts"',
  'import { ChipMateSystemPrompt } from "./src/chipmate/system-prompt.ts"',
  'import { ChipMateToolRegistry } from "./src/chipmate/tool/registry.ts"',
  'import { ChipMateTask } from "./src/chipmate/tool/task.ts"',
  'import { Permission } from "./src/permission/index.ts"',
  'import { disposeAllInstances, disposeTestRuntime, provideInstance, testInstanceStoreLayer, tmpdir } from "./test/fixture/fixture.ts"',
  "await using dir = await tmpdir({})",
  "const output = await Effect.runPromise(provideInstance(dir.path)(Agent.Service.use((svc) => Effect.gen(function* () {",
  "const list = yield* svc.list()",
  'const code = yield* svc.get("code")',
  'const ultra = yield* svc.get("ultra")',
  'const baseline = yield* svc.get("ultra-code-baseline")',
  'const synthesis = yield* svc.get("ultra-synthesizer")',
  "const selected = yield* svc.defaultAgent()",
  'const checks = [["edit", "src/main.ts"], ["bash", "pwd"], ["task", "explore"], ["skill", "using-superpowers"], ["interactive_terminal", "*"], ["codebase_analysis", "*"], ["semantic_search", "*"]]',
  "const permissions = Object.fromEntries(checks.map(([tool, pattern]) => [tool, { code: Permission.evaluate(tool, pattern, code.permission).action, ultra: ultra ? Permission.evaluate(tool, pattern, ultra.permission).action : null }]))",
  'const ids = ["ultra_verify", "ultra_code_baseline", "ultra_council_explore", "ultra_council_adjudicate", "ultra_council_revise", "ultra_submit_arbitration"]',
  "const council = Object.fromEntries(ids.map((id) => [id, { code: ChipMateToolRegistry.available({ id }, code), ultra: ultra ? ChipMateToolRegistry.available({ id }, ultra) : null }]))",
  'const baselineInfo = baseline ? { mode: baseline.mode, native: baseline.native === true, hidden: baseline.hidden === true, id: typeof baseline.options.id === "string" ? baseline.options.id : undefined, model: baseline.model, variant: baseline.variant, prompt: baseline.prompt, ordinary: (() => { try { ChipMateTask.validate(baseline, baseline.name); return "allowed" } catch (error) { return error instanceof Error ? error.message : String(error) } })(), internal: (() => { try { ChipMateTask.validate(baseline, baseline.name, true); return "allowed" } catch (error) { return error instanceof Error ? error.message : String(error) } })(), edit: Permission.evaluate("edit", "*", baseline.permission).action, bash: Permission.evaluate("bash", "*", baseline.permission).action, task: Permission.evaluate("task", "explore", baseline.permission).action } : null',
  'const synthesisInfo = synthesis ? { mode: synthesis.mode, native: synthesis.native === true, hidden: synthesis.hidden === true, id: typeof synthesis.options.id === "string" ? synthesis.options.id : undefined, ordinary: (() => { try { ChipMateTask.validate(synthesis, synthesis.name); return "allowed" } catch (error) { return error instanceof Error ? error.message : String(error) } })(), internal: (() => { try { ChipMateTask.validate(synthesis, synthesis.name, true); return "allowed" } catch (error) { return error instanceof Error ? error.message : String(error) } })() } : null',
  'return { names: list.map((item) => item.name), selected, code: { mode: code.mode, native: code.native === true, model: code.model, variant: code.variant, prompt: code.prompt }, ultra: ultra ? { mode: ultra.mode, native: ultra.native === true, hidden: ultra.hidden === true, name: ultra.name, id: typeof ultra.options.id === "string" ? ultra.options.id : undefined, appends: ChipMateSystemPrompt.appends(ultra), prompt: ultra.prompt } : null, baseline: baselineInfo, synthesis: synthesisInfo, permissions, council }',
  "}))).pipe(Effect.provide(Agent.defaultLayer), Effect.provide(testInstanceStoreLayer)))",
  "await disposeAllInstances()",
  "await disposeTestRuntime()",
  "process.stdout.write(JSON.stringify(output), () => process.exit(0))",
].join(";")

async function run(profile: string, config: object = {}) {
  const storage = path.join(os.tmpdir(), `chipmate-ultra-agent-test-${Math.random().toString(36).slice(2)}`)
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: root,
    env: {
      ...process.env,
      CHIPMATE_PRODUCT_PROFILE: profile,
      CHIPMATE_STORAGE_ROOT: storage,
      CHIPMATE_VSCODE_GLOBAL_STORAGE: storage,
      CHIPMATE_CONFIG_CONTENT: JSON.stringify(config),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).finally(() => fs.rm(storage, { recursive: true, force: true }))
  return { stdout: stdout.trim(), stderr: stderr.trim(), code: status }
}

function parse(stdout: string) {
  const start = stdout.lastIndexOf('{"names":')
  return schema.parse(JSON.parse(stdout.slice(start)))
}

describe("ChipMate Ultra agent", () => {
  test("registers a visible native primary agent without changing the default", async () => {
    const result = await run("chipmate-v2")

    expect(result.code, result.stderr).toBe(0)
    const output = parse(result.stdout)
    expect(output.names).toContain("ultra")
    expect(output.selected).toBe("code")
    expect(output.code).toEqual({ mode: "primary", native: true })
    expect(output.ultra).toMatchObject({
      mode: "primary",
      native: true,
      hidden: false,
      name: "ultra",
      id: "ultra",
      appends: true,
    })
    expect(output.ultra?.prompt).toContain("## Mandatory Ultra three-way verification")
    expect(output.ultra?.prompt).toContain("runtime starts `ultra_verify` locally exactly once")
    expect(output.council.ultra_verify).toEqual({ code: false, ultra: true })
    for (const [id, access] of Object.entries(output.council)) {
      if (id === "ultra_verify") continue
      expect(access).toEqual({ code: false, ultra: false })
    }
    for (const actions of Object.values(output.permissions)) {
      expect(actions.ultra).toBe(actions.code)
    }
    expect(output.baseline).toMatchObject({
      mode: "subagent",
      native: true,
      hidden: true,
      id: "ultra-code-baseline",
      internal: "allowed",
      edit: "deny",
      bash: "deny",
    })
    expect(output.baseline?.ordinary).toContain("reserved for the native ChipMate Ultra runtime")
    expect(output.baseline?.model).toEqual(output.code.model)
    expect(output.baseline?.variant).toBe(output.code.variant)
    expect(output.baseline?.prompt).toBe(output.code.prompt)
    expect(output.synthesis).toMatchObject({
      mode: "subagent",
      native: true,
      hidden: true,
      id: "ultra-synthesizer",
      internal: "allowed",
    })
    expect(output.synthesis?.ordinary).toContain("reserved for the native ChipMate Ultra runtime")
  })

  test("honors global denies and independent Ultra configuration", async () => {
    const result = await run("chipmate-v2", {
      permission: {
        edit: "deny",
        task: "deny",
      },
      agent: {
        ultra: {
          name: "renamed-ultra",
          prompt: "Configured Ultra addendum",
          permission: {
            semantic_search: "deny",
          },
        },
      },
    })

    expect(result.code, result.stderr).toBe(0)
    const output = parse(result.stdout)
    expect(output.permissions.edit).toEqual({ code: "deny", ultra: "deny" })
    expect(output.permissions.task).toEqual({ code: "deny", ultra: "deny" })
    expect(output.permissions.semantic_search).toEqual({ code: "allow", ultra: "deny" })
    expect(output.ultra?.prompt).toBe("Configured Ultra addendum")
    expect(output.ultra).toMatchObject({
      name: "renamed-ultra",
      id: "ultra",
      appends: true,
    })
    expect(output.baseline).toMatchObject({
      mode: "subagent",
      hidden: true,
      edit: "deny",
      bash: "deny",
      task: "deny",
    })
    expect(output.council.ultra_verify).toEqual({ code: false, ultra: true })
  })

  test("does not register Ultra outside ChipMate", async () => {
    const result = await run("")

    expect(result.code, result.stderr).toBe(0)
    const output = parse(result.stdout)
    expect(output.names).not.toContain("ultra")
    expect(output.ultra).toBeNull()
    expect(output.baseline).toBeNull()
    expect(output.synthesis).toBeNull()
    expect(output.selected).toBe("code")
    for (const access of Object.values(output.council)) {
      expect(access).toEqual({ code: false, ultra: null })
    }
  })
})
