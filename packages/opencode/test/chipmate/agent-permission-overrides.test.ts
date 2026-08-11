import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { afterEach, expect, test } from "bun:test"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import {
  disposeAllInstances,
  provideInstance,
  provideTestInstance,
  testInstanceStoreLayer,
  tmpdir,
} from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(
    provideInstance(dir)(Agent.Service.use(fn)).pipe(
      Effect.provide(AppNodeBuilder.build(Agent.node)),
      Effect.provide(testInstanceStoreLayer),
    ),
  )
}

async function offline(fn: () => Promise<void>) {
  const prev = process.env.CHIPMATE_INTERNAL_OFFLINE
  process.env.CHIPMATE_INTERNAL_OFFLINE = "1"
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.CHIPMATE_INTERNAL_OFFLINE
    if (prev !== undefined) process.env.CHIPMATE_INTERNAL_OFFLINE = prev
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

  await provideTestInstance({
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

  await provideTestInstance({
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

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(plan).toBeDefined()
      expect(Permission.evaluate("edit", "src/output.log", plan!.permission).action).toBe("deny")
      expect(Permission.evaluate("edit", ".chipmate/plans/fix.md", plan!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", "plans/fix.md", plan!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", ".plans/fix.md", plan!.permission).action).toBe("allow")
    },
  })
})

test("Ask and Plan allow chat PlantUML rendering while retaining write restrictions", async () => {
  await using tmp = await tmpdir({})

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      for (const name of ["ask", "plan"]) {
        const agent = await load(tmp.path, (svc) => svc.get(name))
        expect(Permission.evaluate("render_plantuml_diagram", "plantuml", agent!.permission).action).toBe("allow")
        expect(Permission.evaluate("write", "diagram.puml", agent!.permission).action).toBe("deny")
      }
    },
  })
})

test.serial("internal code, explore, debug, and ask agents expose retrieval tools", () =>
  offline(async () => {
    await using tmp = await tmpdir({})

    await provideTestInstance({
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

    await provideTestInstance({
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
  const prev = process.env.CHIPMATE_INTERNAL_OFFLINE

  try {
    await using publicDir = await tmpdir({})
    await provideTestInstance({
      directory: publicDir.path,
      fn: async () => {
        delete process.env.CHIPMATE_INTERNAL_OFFLINE
        const agent = await load(publicDir.path, (svc) => svc.get("explore"))
        expect(agent!.prompt).not.toContain("Use the retrieval route that best matches the question")
      },
    })
    await disposeAllInstances()

    await using internalDir = await tmpdir({})
    await provideTestInstance({
      directory: internalDir.path,
      fn: async () => {
        process.env.CHIPMATE_INTERNAL_OFFLINE = "1"
        const agent = await load(internalDir.path, (svc) => svc.get("explore"))
        expect(agent!.prompt).toContain("Use the retrieval route that best matches the question")
        expect(agent!.prompt).not.toContain("codebase_analysis")
        expect(agent?.prompt).toContain("approved external documents")
        expect(agent?.prompt).toContain("omit path to search every configured document root")
        expect(agent!.prompt).toContain("Use Grep for exact identifiers or text")
        expect(agent!.prompt).toContain("do not repeatedly retry the retrieval tool")
      },
    })
  } finally {
    if (prev === undefined) delete process.env.CHIPMATE_INTERNAL_OFFLINE
    if (prev !== undefined) process.env.CHIPMATE_INTERNAL_OFFLINE = prev
  }
})

test("system utility agents ignore per-agent permission allows", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        title: {
          permission: {
            bash: "allow",
          },
        },
        summary: {
          permission: {
            read: "allow",
          },
        },
        compaction: {
          permission: {
            skill: "allow",
          },
        },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const title = await load(tmp.path, (svc) => svc.get("title"))
      const summary = await load(tmp.path, (svc) => svc.get("summary"))
      const compaction = await load(tmp.path, (svc) => svc.get("compaction"))
      expect(title).toBeDefined()
      expect(summary).toBeDefined()
      expect(compaction).toBeDefined()
      expect(Permission.evaluate("bash", "*", title!.permission).action).toBe("deny")
      expect(Permission.evaluate("read", "*", summary!.permission).action).toBe("deny")
      expect(Permission.evaluate("skill", "using-superpowers", compaction!.permission).action).toBe("deny")
    },
  })
})

test("system utility agents deny tools after configured name override", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        title: {
          name: "custom-title",
          permission: {
            bash: "allow",
            read: "allow",
            skill: "allow",
          },
        },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const title = await load(tmp.path, (svc) => svc.get("title"))
      expect(title).toBeDefined()
      expect(title?.name).toBe("custom-title")
      expect(Permission.evaluate("bash", "*", title!.permission).action).toBe("deny")
      expect(Permission.evaluate("read", "README.md", title!.permission).action).toBe("deny")
      expect(Permission.evaluate("skill", "using-superpowers", title!.permission).action).toBe("deny")
    },
  })
})
