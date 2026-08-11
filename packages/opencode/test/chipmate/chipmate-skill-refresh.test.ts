import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")

describe("ChipMate Skill refresh", () => {
  test("discovers a project Skill root created after instance initialization", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-skill-refresh-"))
    const storage = path.join(dir, "storage")
    const state = path.join(dir, "state")
    const code = [
      'import { Effect, Layer } from "effect"',
      'import fs from "node:fs/promises"',
      'import path from "node:path"',
      'import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"',
      'import { Command } from "./src/command"',
      'import { Config } from "./src/config/config"',
      'import { MCP } from "./src/mcp"',
      'import { Skill } from "./src/skill"',
      'import { provideTmpdirInstance } from "./test/fixture/fixture"',
      "const layer = Command.layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(MCP.defaultLayer), Layer.provideMerge(Skill.defaultLayer), Layer.provideMerge(CrossSpawnSpawner.defaultLayer))",
      "const effect = provideTmpdirInstance((dir) => Effect.gen(function* () {",
      "  const command = yield* Command.Service",
      "  const skill = yield* Skill.Service",
      "  const before = yield* command.list()",
      '  const base = path.join(dir, ".chipmate-v2", "skills")',
      "  for (let i = 1; i <= 18; i++) {",
      '    const id = `local-${String(i).padStart(2, "0")}`',
      "    const target = path.join(base, id)",
      "    yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))",
      '    yield* Effect.promise(() => fs.writeFile(path.join(target, "SKILL.md"), `---\\nname: ${id}\\ndescription: Imported ${id}\\n---\\n\\n# ${id}\\n`))',
      "  }",
      '  yield* skill.refresh("project")',
      "  const imported = (name) => /^local-\\d{2}$/.test(name)",
      '  const installed = (yield* command.list()).filter((item) => item.source === "skill" && imported(item.name))',
      '  yield* Effect.promise(() => fs.rm(path.join(dir, ".chipmate-v2"), { recursive: true }))',
      '  yield* skill.refresh("project")',
      '  const removed = (yield* command.list()).filter((item) => item.source === "skill" && imported(item.name))',
      "  console.log(`CHIPMATE_RESULT=${JSON.stringify({ before: before.some((item) => imported(item.name)), installed: installed.length, removed: removed.length })}`)",
      "}), { git: true })",
      "await Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.scoped))",
    ].join(";")

    try {
      for (const item of [
        { disabled: "", installed: 18 },
        { disabled: "1", installed: 0 },
      ]) {
        const child = Bun.spawn([process.execPath, "-e", code], {
          cwd: root,
          env: {
            ...process.env,
            CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
            CHIPMATE_STORAGE_ROOT: state,
            CHIPMATE_VSCODE_GLOBAL_STORAGE: storage,
            CHIPMATE_DISABLE_PROJECT_CONFIG: item.disabled,
          },
          stdout: "pipe",
          stderr: "pipe",
        })
        const [stdout, stderr, status] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        expect(status, stderr).toBe(0)
        const line = stdout.split(/\r?\n/).find((value) => value.startsWith("CHIPMATE_RESULT="))
        expect(line).toBeDefined()
        expect(JSON.parse(line!.slice("CHIPMATE_RESULT=".length))).toEqual({
          before: false,
          installed: item.installed,
          removed: 0,
        })
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("uses only fixed roots, validates identity, and prefers the project instance", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-skill-identity-"))
    const storage = path.join(dir, "storage")
    const state = path.join(dir, "state")
    const global = path.join(storage, "config", "skills")
    await write(path.join(global, "shared", "SKILL.md"), "shared", "Global v2")
    await write(path.join(global, "global-only", "SKILL.md"), "global-only", "Global only")
    const code = [
      'import { Effect, Layer } from "effect"',
      'import fs from "node:fs/promises"',
      'import path from "node:path"',
      'import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"',
      'import { Config } from "./src/config/config"',
      'import { Skill } from "./src/skill"',
      'import { provideTmpdirInstance } from "./test/fixture/fixture"',
      "const layer = Skill.defaultLayer.pipe(Layer.provide(Config.defaultLayer), Layer.provideMerge(CrossSpawnSpawner.defaultLayer))",
      'const write = async (file, name, description, metadata) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `---\\nname: ${name}\\ndescription: ${description}\\n---\\n\\n# ${name}\\n`); if (metadata) await fs.writeFile(path.join(path.dirname(file), "skill.json"), JSON.stringify(metadata)) }',
      "const effect = provideTmpdirInstance((dir) => Effect.gen(function* () {",
      '  yield* Effect.promise(() => Promise.all([write(path.join(dir, ".chipmate-v2", "skills", "shared", "SKILL.md"), "shared", "Project v1"), write(path.join(dir, ".agents", "skills", "agents-old", "SKILL.md"), "agents-old", "Ignored agents"), write(path.join(dir, ".chipmate", "skills", "chipmate-old", "SKILL.md"), "chipmate-old", "Ignored chipmate"), write(path.join(dir, ".chipmate", "skills", "chipmate-old", "SKILL.md"), "chipmate-old", "Ignored chipmate"), write(path.join(dir, ".chipmate-v2", "skills", "bad-name", "SKILL.md"), "Bad Name", "Invalid name"), write(path.join(dir, ".chipmate-v2", "skills", "wrong-folder", "SKILL.md"), "other", "Mismatch"), write(path.join(dir, ".chipmate-v2", "skills", "bad-metadata", "SKILL.md"), "bad-metadata", "Mismatch metadata", { id: "other" })]))',
      "  const list = yield* (yield* Skill.Service).all()",
      '  const user = list.filter((item) => item.location !== "builtin" && !item.location.includes("builtin-skills")).map((item) => ({ name: item.name, description: item.description, location: item.location }))',
      "  console.log(`CHIPMATE_IDENTITY=${JSON.stringify(user)}`)",
      "}), { git: true })",
      "await Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.scoped))",
    ].join(";")

    try {
      const child = Bun.spawn([process.execPath, "-e", code], {
        cwd: root,
        env: {
          ...process.env,
          CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
          CHIPMATE_STORAGE_ROOT: state,
          CHIPMATE_VSCODE_GLOBAL_STORAGE: storage,
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(status, stderr).toBe(0)
      const line = stdout.split(/\r?\n/).find((value) => value.startsWith("CHIPMATE_IDENTITY="))
      expect(line).toBeDefined()
      const items = JSON.parse(line!.slice("CHIPMATE_IDENTITY=".length)) as Array<{
        name: string
        description: string
        location: string
      }>
      expect(items.map((item) => item.name).toSorted()).toEqual(["global-only", "shared"])
      expect(items.find((item) => item.name === "shared")?.description).toBe("Project v1")
      expect(items.find((item) => item.name === "shared")?.location).toContain(
        `${path.sep}.chipmate-v2${path.sep}skills${path.sep}shared${path.sep}SKILL.md`,
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

async function write(file: string, name: string, description: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`)
}
