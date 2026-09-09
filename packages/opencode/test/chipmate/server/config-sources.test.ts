import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../../src/server/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

type Source = {
  order: number
  kind: string
  scope: string
  label: string
  source: string
  path?: string
  exists: boolean
  editable: boolean
  reason?: string
}

type Body = {
  sources: Source[]
}

const env = {
  CHIPMATE_CONFIG: process.env.CHIPMATE_CONFIG,
  CHIPMATE_CONFIG_CONTENT: process.env.CHIPMATE_CONFIG_CONTENT,
  CHIPMATE_CONFIG_DIR: process.env.CHIPMATE_CONFIG_DIR,
  CHIPMATE_INTERNAL_PROVIDER_DEFAULTS: process.env.CHIPMATE_INTERNAL_PROVIDER_DEFAULTS,
  CHIPMATE_DISABLE_PROJECT_CONFIG: process.env.CHIPMATE_DISABLE_PROJECT_CONFIG,
  CHIPMATE_TEST_MANAGED_CONFIG_DIR: process.env.CHIPMATE_TEST_MANAGED_CONFIG_DIR,
  flagConfig: Flag.CHIPMATE_CONFIG,
}

afterEach(async () => {
  restore()
  await disposeAllInstances()
  await resetDatabase()
})

function restore() {
  set("CHIPMATE_CONFIG", env.CHIPMATE_CONFIG)
  set("CHIPMATE_CONFIG_CONTENT", env.CHIPMATE_CONFIG_CONTENT)
  set("CHIPMATE_CONFIG_DIR", env.CHIPMATE_CONFIG_DIR)
  set("CHIPMATE_INTERNAL_PROVIDER_DEFAULTS", env.CHIPMATE_INTERNAL_PROVIDER_DEFAULTS)
  set("CHIPMATE_DISABLE_PROJECT_CONFIG", env.CHIPMATE_DISABLE_PROJECT_CONFIG)
  set("CHIPMATE_TEST_MANAGED_CONFIG_DIR", env.CHIPMATE_TEST_MANAGED_CONFIG_DIR)
  Flag.CHIPMATE_CONFIG = env.flagConfig
}

function set(key: keyof typeof process.env, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

async function sources(dir: string) {
  const response = await Server.Default().app.request("/config/sources", {
    headers: { "x-chipmate-directory": dir },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as Body
}

function order(body: Body, file: string) {
  const hit = body.sources.find((source) => source.path === file)
  expect(hit).toBeDefined()
  return hit!.order
}

describe("config source routes", () => {
  test("lists source metadata in load order without config contents", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "env.json"), "{}")
        await Bun.write(path.join(dir, "chipmate.json"), "{}")

        for (const root of [".opencode", ".chipmate"]) {
          const local = path.join(dir, root)
          await fs.mkdir(local, { recursive: true })
          await Bun.write(path.join(local, "chipmate.jsonc"), "{}")
        }

        const extra = path.join(dir, "extra")
        await fs.mkdir(extra, { recursive: true })
        await Bun.write(path.join(extra, "opencode.json"), "{}")

        const managed = path.join(dir, "managed")
        await fs.mkdir(managed, { recursive: true })
        await Bun.write(path.join(managed, "chipmate.json"), "{}")
      },
    })

    const envFile = path.join(tmp.path, "env.json")
    const projectFile = path.join(tmp.path, "chipmate.json")
    const opencodeFile = path.join(tmp.path, ".opencode", "chipmate.jsonc")
    const chipmateFile = path.join(tmp.path, ".chipmate", "chipmate.jsonc")
    const extraFile = path.join(tmp.path, "extra", "opencode.json")
    const managedFile = path.join(tmp.path, "managed", "chipmate.json")

    process.env.CHIPMATE_CONFIG = envFile
    Flag.CHIPMATE_CONFIG = envFile
    process.env.CHIPMATE_CONFIG_CONTENT = '{"username":"secret-inline-value"}'
    process.env.CHIPMATE_INTERNAL_PROVIDER_DEFAULTS = '{"provider":{"chipmate":{}}}'
    process.env.CHIPMATE_CONFIG_DIR = path.join(tmp.path, "extra")
    process.env.CHIPMATE_TEST_MANAGED_CONFIG_DIR = path.join(tmp.path, "managed")

    const body = await sources(tmp.path)
    const inline = body.sources.find((source) => source.source === "CHIPMATE_CONFIG_CONTENT")
    const defaults = body.sources.find((source) => source.source === "CHIPMATE_INTERNAL_PROVIDER_DEFAULTS")

    expect(defaults?.order).toBe(0)
    expect(defaults).toMatchObject({ kind: "env-content", scope: "env", editable: false })
    expect(order(body, envFile)).toBeLessThan(order(body, projectFile))
    expect(order(body, projectFile)).toBeLessThan(order(body, chipmateFile))
    expect(body.sources.some((source) => source.path === opencodeFile)).toBe(false)
    expect(order(body, chipmateFile)).toBeLessThan(order(body, extraFile))
    expect(inline?.order).toBeGreaterThan(order(body, extraFile))
    expect(inline?.order).toBeLessThan(order(body, managedFile))

    expect(body.sources.find((source) => source.path === chipmateFile)).toMatchObject({
      kind: "config-dir-file",
      scope: "project",
      exists: true,
      editable: true,
    })
    expect(body.sources.find((source) => source.path === managedFile)).toMatchObject({
      kind: "managed-file",
      scope: "managed",
      exists: true,
      editable: false,
    })
    expect(JSON.stringify(body)).not.toContain("secret-inline-value")
  })

  test("shows project config disabled by environment", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "chipmate.json"), "{}")
        await fs.mkdir(path.join(dir, ".chipmate"), { recursive: true })
        await Bun.write(path.join(dir, ".chipmate", "chipmate.json"), "{}")
      },
    })

    process.env.CHIPMATE_DISABLE_PROJECT_CONFIG = "1"

    const body = await sources(tmp.path)

    expect(body.sources.some((source) => source.path === path.join(tmp.path, "chipmate.json"))).toBe(false)
    expect(body.sources.some((source) => source.path === path.join(tmp.path, ".chipmate", "chipmate.json"))).toBe(false)
    expect(body.sources.find((source) => source.source === "CHIPMATE_DISABLE_PROJECT_CONFIG")).toMatchObject({
      kind: "runtime-env",
      scope: "env",
      exists: true,
      editable: false,
    })
  })
})
