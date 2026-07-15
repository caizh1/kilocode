import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { WithInstance } from "../../src/project/with-instance"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

async function offline(fn: () => Promise<void>) {
  const prev = process.env.KILO_INTERNAL_OFFLINE
  process.env.KILO_INTERNAL_OFFLINE = "1"
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.KILO_INTERNAL_OFFLINE
    if (prev !== undefined) process.env.KILO_INTERNAL_OFFLINE = prev
  }
}

afterEach(async () => {
  await disposeAllInstances()
})

test("ask agent honors user MCP allow over generated ask rule", async () => {
  await using tmp = await tmpdir({
    config: {
      mcp: {
        context7: { type: "local", command: ["context7"] },
      },
      permission: {
        "context7_query-docs": { "*": "allow" },
      },
    },
  })

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const ask = await load(tmp.path, (svc) => svc.get("ask"))
      expect(ask).toBeDefined()
      expect(Permission.evaluate("context7_query-docs", "*", ask!.permission).action).toBe("allow")
    },
  })
})

test("plan agent honors user bash allow over read-only deny default", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        bash: { "cargo search *": "allow" },
      },
    },
  })

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(plan).toBeDefined()
      expect(Permission.evaluate("bash", "cargo search serde", plan!.permission).action).toBe("allow")
    },
  })
})

test("plan agent still hard-denies non-plan edits after user edit allow", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        edit: { "src/output.log": "allow" },
      },
    },
  })

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(plan).toBeDefined()
      expect(Permission.evaluate("edit", "src/output.log", plan!.permission).action).toBe("deny")
      expect(Permission.evaluate("edit", ".kilo/plans/fix.md", plan!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", ".plans/fix.md", plan!.permission).action).toBe("allow")
    },
  })
})

test.serial("internal code, explore, debug, and ask agents expose retrieval tools", () =>
  offline(async () => {
    await using tmp = await tmpdir({})

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const name of ["code", "explore", "debug", "ask"]) {
          const agent = await load(tmp.path, (svc) => svc.get(name))
          const disabled = Permission.disabled(
            ["codebase_analysis", "semantic_search", "document_search"],
            agent!.permission,
          )
          expect({ name, disabled }).toEqual({ name, disabled: new Set() })
        }
      },
    })
  }),
)

test.serial("explicit user denies override internal retrieval defaults for code and explore", () =>
  offline(async () => {
    await using tmp = await tmpdir({
      config: {
        permission: {
          codebase_analysis: "deny",
          semantic_search: "deny",
          document_search: "deny",
        },
      },
    })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const name of ["code", "explore"]) {
          const agent = await load(tmp.path, (svc) => svc.get(name))
          const disabled = Permission.disabled(
            ["codebase_analysis", "semantic_search", "document_search"],
            agent!.permission,
          )
          expect({ name, disabled }).toEqual({
            name,
            disabled: new Set(["codebase_analysis", "semantic_search", "document_search"]),
          })
        }
      },
    })
  }),
)

test.serial("internal explore prompt routes retrieval without changing the public prompt", async () => {
  const prev = process.env.KILO_INTERNAL_OFFLINE

  try {
    await using publicDir = await tmpdir({})
    await WithInstance.provide({
      directory: publicDir.path,
      fn: async () => {
        delete process.env.KILO_INTERNAL_OFFLINE
        const agent = await load(publicDir.path, (svc) => svc.get("explore"))
        expect(agent!.prompt).not.toContain("Use the retrieval route that best matches the question")
      },
    })
    await disposeAllInstances()

    await using internalDir = await tmpdir({})
    await WithInstance.provide({
      directory: internalDir.path,
      fn: async () => {
        process.env.KILO_INTERNAL_OFFLINE = "1"
        const agent = await load(internalDir.path, (svc) => svc.get("explore"))
        expect(agent!.prompt).toContain("Use the retrieval route that best matches the question")
        expect(agent!.prompt).toContain("Use codebase_analysis first")
        expect(agent!.prompt).toContain("do not repeatedly retry the retrieval tool")
      },
    })
  } finally {
    if (prev === undefined) delete process.env.KILO_INTERNAL_OFFLINE
    if (prev !== undefined) process.env.KILO_INTERNAL_OFFLINE = prev
  }
})
