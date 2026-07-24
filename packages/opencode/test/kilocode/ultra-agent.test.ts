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
  permissions: z.record(
    z.string(),
    z.object({
      code: z.string(),
      ultra: z.string().nullable(),
    }),
  ),
})

const script = [
  'import { Effect } from "effect"',
  'import { Agent } from "./src/agent/agent.ts"',
  'import { KilocodeSystemPrompt } from "./src/kilocode/system-prompt.ts"',
  'import { Permission } from "./src/permission/index.ts"',
  'import { disposeAllInstances, disposeTestRuntime, provideInstance, testInstanceStoreLayer, tmpdir } from "./test/fixture/fixture.ts"',
  "await using dir = await tmpdir({})",
  "const output = await Effect.runPromise(provideInstance(dir.path)(Agent.Service.use((svc) => Effect.gen(function* () {",
  "const list = yield* svc.list()",
  'const code = yield* svc.get("code")',
  'const ultra = yield* svc.get("ultra")',
  "const selected = yield* svc.defaultAgent()",
  'const checks = [["edit", "src/main.ts"], ["bash", "pwd"], ["task", "explore"], ["skill", "using-superpowers"], ["interactive_terminal", "*"], ["codebase_analysis", "*"], ["semantic_search", "*"]]',
  "const permissions = Object.fromEntries(checks.map(([tool, pattern]) => [tool, { code: Permission.evaluate(tool, pattern, code.permission).action, ultra: ultra ? Permission.evaluate(tool, pattern, ultra.permission).action : null }]))",
  "return { names: list.map((item) => item.name), selected, code: { mode: code.mode, native: code.native === true }, ultra: ultra ? { mode: ultra.mode, native: ultra.native === true, hidden: ultra.hidden === true, name: ultra.name, id: typeof ultra.options.id === \"string\" ? ultra.options.id : undefined, appends: KilocodeSystemPrompt.appends(ultra), prompt: ultra.prompt } : null, permissions }",
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
      KILO_PRODUCT_PROFILE: profile,
      KILO_STORAGE_ROOT: storage,
      KILO_VSCODE_GLOBAL_STORAGE: storage,
      KILO_CONFIG_CONTENT: JSON.stringify(config),
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
    expect(output.ultra?.prompt).toContain("## Mandatory parallel exploration")
    for (const actions of Object.values(output.permissions)) {
      expect(actions.ultra).toBe(actions.code)
    }
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
  })

  test("does not register Ultra outside ChipMate", async () => {
    const result = await run("")

    expect(result.code, result.stderr).toBe(0)
    const output = parse(result.stdout)
    expect(output.names).not.toContain("ultra")
    expect(output.ultra).toBeNull()
    expect(output.selected).toBe("code")
  })
})
