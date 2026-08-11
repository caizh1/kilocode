import { describe, expect, test } from "bun:test"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")

async function run(env: Record<string, string>, code?: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      code ??
        'import { ProductProfile } from "./src/chipmate/product-profile.ts"; console.log(JSON.stringify({ chipmate: ProductProfile.chipmate, dirs: ProductProfile.dirs, root: ProductProfile.root, project: ProductProfile.project("/repo", "plans"), config: ProductProfile.config() }))',
    ],
    { cwd: root, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" },
  )
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), code: status }
}

describe("product profile", () => {
  test("uses only the ChipMate v2 directory and storage root", async () => {
    const result = await run({
      CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
      CHIPMATE_VSCODE_GLOBAL_STORAGE: "/tmp/chipmate-storage/v2",
    })

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      chipmate: true,
      dirs: [".chipmate-v2"],
      root: ".chipmate-v2",
      project: "/repo/.chipmate-v2/plans",
      config: "/tmp/chipmate-storage/v2/config",
    })
  })

  test("keeps native ChipMate writes in the canonical .chipmate directory", async () => {
    const result = await run({
      CHIPMATE_PRODUCT_PROFILE: "",
      CHIPMATE_VSCODE_GLOBAL_STORAGE: "",
    })

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      chipmate: false,
      dirs: [".chipmate"],
      root: ".chipmate",
      project: "/repo/.chipmate/plans",
    })
  })

  test("removes private product routing variables from user processes", async () => {
    const code = [
      'import { userEnv } from "./src/chipmate/product-env.ts"',
      'console.log(JSON.stringify(userEnv({ CHIPMATE_PRODUCT_PROFILE: "chipmate-v2", CHIPMATE_STORAGE_ROOT: "/tmp/root", CHIPMATE_VSCODE_GLOBAL_STORAGE: "/tmp/global", USER_VALUE: "kept" })))',
    ].join(";")
    const result = await run({}, code)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ USER_VALUE: "kept" })
  })

  test("removes backend secrets and only the bundled bin from user PATH", async () => {
    const code = [
      'import { cleanEnv } from "./src/chipmate/product-env.ts"',
      'const input = { PATH: "/extension/bin/poppler:/extension/bin:/user/bin", CHIPMATE_SERVER_PASSWORD: "secret", CHIPMATE_SERVER_USERNAME: "chipmate", CHIPMATE_PARENT_PID: "42", CHIPMATE_PRODUCT_PROFILE: "chipmate-v2", USER_VALUE: "kept" }',
      'const result = cleanEnv(input, { profile: "chipmate-v2", bin: "/extension/bin" }, "linux")',
      "console.log(JSON.stringify({ result, input }))",
    ].join(";")
    const result = await run({}, code)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      result: { PATH: "/extension/bin/poppler:/user/bin", USER_VALUE: "kept" },
      input: {
        PATH: "/extension/bin/poppler:/extension/bin:/user/bin",
        CHIPMATE_SERVER_PASSWORD: "secret",
        CHIPMATE_SERVER_USERNAME: "chipmate",
        CHIPMATE_PARENT_PID: "42",
        CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
        USER_VALUE: "kept",
      },
    })
  })

  test("handles Windows PATH and private keys case-insensitively", async () => {
    const code = [
      'import { cleanEnv } from "./src/chipmate/product-env.ts"',
      'const result = cleanEnv({ Path: "C:\\\\Extension\\\\bin;C:\\\\User\\\\bin;", chipmate_server_password: "secret", chipmate_vscode_bundled_bin: "spoofed" }, { profile: "chipmate-v2", bin: "c:\\\\extension\\\\BIN" }, "win32")',
      "console.log(JSON.stringify(result))",
    ].join(";")
    const result = await run({}, code)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ Path: "C:\\User\\bin;" })
  })

  test("uses exact sanitized env when Process helpers spawn a child", async () => {
    const code = [
      'import { Process } from "./src/util/process.ts"',
      'import { userOptions } from "./src/chipmate/product-env.ts"',
      'process.env.CHIPMATE_SERVER_PASSWORD = "must-not-leak"',
      'const out = await Process.text([process.execPath, "-e", "console.log(JSON.stringify({ secret: process.env.CHIPMATE_SERVER_PASSWORD, kept: process.env.KEPT }))"], userOptions({ env: { KEPT: "yes" } }))',
      "console.log(out.text.trim())",
    ].join(";")
    const result = await run({}, code)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ kept: "yes" })
  })

  test("keeps user-controlled child process boundaries on sanitized environments", async () => {
    const files = new Map([
      ["src/format/formatter.ts", "userOptions("],
      ["src/tool/shell.ts", "return modelEnv(extra.env)"],
      ["src/chipmate/ts-check.ts", "env: userEnv(process.env)"],
      ["src/chipmate/commit-message/git-context.ts", "env: userEnv(process.env)"],
      ["src/chipmate/session-export/workspace-provider.ts", "env: userEnv(process.env)"],
      ["src/chipmate/documents/mermaid.ts", "env: userEnv(process.env)"],
      ["src/chipmate/documents/word.ts", "env: userEnv(process.env)"],
      ["src/chipmate/session-portability/session-diff-restore.ts", "env: userEnv(process.env)"],
      ["src/chipmate/anaconda-desktop/platform.ts", "extendEnv: false"],
      ["src/chipmate/indexing-worker-client.ts", "...selfEnv()"],
    ])

    for (const [file, token] of files) {
      expect(await Bun.file(path.join(root, file)).text(), file).toContain(token)
    }
  })

  test("resolves bare chipmate from the user PATH instead of the extension bin", async () => {
    if (process.platform === "win32") return
    const code = [
      'import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises"',
      'import os from "node:os"',
      'import path from "node:path"',
      'const dir = await mkdtemp(path.join(os.tmpdir(), "chipmate-path-"))',
      'const bundled = path.join(dir, "extension", "bin")',
      'const user = path.join(dir, "user", "bin")',
      "await mkdir(bundled, { recursive: true }); await mkdir(user, { recursive: true })",
      'await writeFile(path.join(bundled, "chipmate"), "#!/bin/sh\\nprintf bundled")',
      'await writeFile(path.join(user, "chipmate"), "#!/bin/sh\\nprintf user")',
      'await chmod(path.join(bundled, "chipmate"), 0o755); await chmod(path.join(user, "chipmate"), 0o755)',
      'process.env.CHIPMATE_PRODUCT_PROFILE = "chipmate-v2"',
      'process.env.CHIPMATE_VSCODE_GLOBAL_STORAGE = path.join(dir, "storage")',
      "process.env.CHIPMATE_VSCODE_BUNDLED_BIN = bundled",
      "process.env.PATH = `${bundled}:${user}`",
      'const { userEnv } = await import("./src/chipmate/product-env.ts")',
      'const child = Bun.spawn(["chipmate"], { env: userEnv(process.env), stdout: "pipe", stderr: "pipe" })',
      "const output = await new Response(child.stdout).text(); const status = await child.exited",
      "console.log(JSON.stringify({ output, status }))",
    ].join(";")
    const result = await run({}, code)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ output: "user", status: 0 })
  })

  test("keeps trusted bundled self on ChipMate routing without server secrets", async () => {
    const code = [
      'import { selfEnv } from "./src/chipmate/product-env.ts"',
      "console.log(JSON.stringify(selfEnv()))",
    ].join(";")
    const result = await run(
      {
        CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
        CHIPMATE_STORAGE_ROOT: "/tmp/chipmate-storage/v2",
        CHIPMATE_VSCODE_GLOBAL_STORAGE: "/tmp/chipmate-storage/v2",
        CHIPMATE_SERVER_PASSWORD: "secret",
      },
      code,
    )

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
      CHIPMATE_STORAGE_ROOT: "/tmp/chipmate-storage/v2",
      CHIPMATE_VSCODE_GLOBAL_STORAGE: "/tmp/chipmate-storage/v2",
    })
  })

  test("disables legacy auth migration only for ChipMate", async () => {
    const code = [
      'import { ProductProfile } from "./src/chipmate/product-profile.ts"',
      "console.log(JSON.stringify(ProductProfile.allowsLegacyAuthMigration()))",
    ].join(";")
    const chipmate = await run(
      { CHIPMATE_PRODUCT_PROFILE: "chipmate-v2", CHIPMATE_VSCODE_GLOBAL_STORAGE: "/tmp/chipmate-storage/v2" },
      code,
    )
    const native = await run({ CHIPMATE_PRODUCT_PROFILE: "", CHIPMATE_VSCODE_GLOBAL_STORAGE: "" }, code)

    expect(JSON.parse(chipmate.stdout)).toBe(false)
    expect(JSON.parse(native.stdout)).toBe(true)
  })

  test("keeps config-agent deletion inside .chipmate-v2", async () => {
    const code = [
      'import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"',
      'import os from "node:os"',
      'import path from "node:path"',
      'const dir = await mkdtemp(path.join(os.tmpdir(), "chipmate-agent-remove-"))',
      'const own = path.join(dir, ".chipmate-v2")',
      "await mkdir(own, { recursive: true })",
      'const root = path.join(dir, "chipmate.jsonc")',
      'const local = path.join(own, "chipmate.jsonc")',
      'await writeFile(root, JSON.stringify({ agent: { reviewer: { description: "native" } } }, null, 2))',
      'await writeFile(local, JSON.stringify({ default_agent: "reviewer", agent: { reviewer: { description: "chipmate" }, code: {} } }, null, 2))',
      'const { remove } = await import("./src/chipmate/agent/index.ts")',
      'await remove({ name: "reviewer", agent: { name: "reviewer", native: false, options: {} }, dirs: [own], directory: dir })',
      'console.log(JSON.stringify({ root: JSON.parse(await readFile(root, "utf8")), local: JSON.parse(await readFile(local, "utf8")) }))',
    ].join(";")
    const result = await run(
      {
        CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
        CHIPMATE_STORAGE_ROOT: "/tmp/chipmate-storage/v2",
        CHIPMATE_VSCODE_GLOBAL_STORAGE: "/tmp/chipmate-storage/v2",
      },
      code,
    )

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      root: { agent: { reviewer: { description: "native" } } },
      local: { agent: { code: {} } },
    })
  })

  test("ships profile-safe built-in instructions for ChipMate", async () => {
    const code = [
      'import { BUILTIN_SKILLS } from "./src/chipmate/skills/builtin.ts"',
      'const config = BUILTIN_SKILLS.find((item) => item.name === "chipmate-config")',
      'const all = BUILTIN_SKILLS.flatMap((item) => [item.content, ...Object.values(item.files ?? {})]).join("\\n")',
      "console.log(JSON.stringify({ description: config?.description, config: config?.content, all }))",
    ].join(";")
    const result = await run(
      { CHIPMATE_PRODUCT_PROFILE: "chipmate-v2", CHIPMATE_VSCODE_GLOBAL_STORAGE: "/tmp/chipmate-storage/v2" },
      code,
    )

    expect(result.code).toBe(0)
    const value = JSON.parse(result.stdout) as { description: string; config: string; all: string }
    expect(value.description).toContain("ChipMate v2")
    expect(value.config).toContain(".chipmate-v2/chipmate.jsonc")
    expect(value.all).not.toContain("~/.config/chipmate")
    expect(value.all).not.toContain("~/.chipmate")
    expect(value.all).not.toContain(".chipmate/artifacts")
  })

  test("honors disabled project config in the ChipMate profile", async () => {
    const code = [
      'import { mkdtemp, mkdir } from "node:fs/promises"',
      'import os from "node:os"',
      'import path from "node:path"',
      'import { Effect } from "effect"',
      'import { FSUtil } from "@opencode-ai/core/fs-util"',
      'import { ConfigPaths } from "./src/config/paths.ts"',
      'const dir = await mkdtemp(path.join(os.tmpdir(), "chipmate-config-"))',
      'await mkdir(path.join(dir, ".chipmate-v2"))',
      "const result = await Effect.runPromise(ConfigPaths.directories(dir, dir).pipe(Effect.provide(FSUtil.defaultLayer)))",
      "console.log(JSON.stringify(result))",
    ].join(";")
    const result = await run(
      {
        CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
        CHIPMATE_STORAGE_ROOT: "/tmp/chipmate-storage/v2",
        CHIPMATE_VSCODE_GLOBAL_STORAGE: "/tmp/chipmate-storage/v2",
        CHIPMATE_DISABLE_PROJECT_CONFIG: "1",
      },
      code,
    )

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(["/tmp/chipmate-storage/v2/config"])
  })

  test("rejects a relative ChipMate v2 storage path", async () => {
    const result = await run({ CHIPMATE_PRODUCT_PROFILE: "chipmate-v2", CHIPMATE_VSCODE_GLOBAL_STORAGE: "relative" })

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("CHIPMATE_VSCODE_GLOBAL_STORAGE must be an absolute path")
  })

  test("loads ChipMate ignore rules without reading the ChipMate ignore file", async () => {
    const code = [
      'import { mkdtemp, writeFile } from "node:fs/promises"',
      'import os from "node:os"',
      'import path from "node:path"',
      'const dir = await mkdtemp(path.join(os.tmpdir(), "chipmate-permission-"))',
      'await writeFile(path.join(dir, ".chipmateignore"), "official.ts\\n")',
      'await writeFile(path.join(dir, ".chipmate-v2ignore"), "chipmate.ts\\n")',
      'const { IgnoreMigrator } = await import("./src/chipmate/ignore-migrator.ts")',
      "const result = await IgnoreMigrator.migrate({ projectDir: dir, skipGlobalPaths: true })",
      "console.log(JSON.stringify(result.permission))",
    ].join(";")
    const result = await run(
      {
        CHIPMATE_PRODUCT_PROFILE: "chipmate-v2",
        CHIPMATE_STORAGE_ROOT: "/tmp/chipmate-storage/v2",
        CHIPMATE_VSCODE_GLOBAL_STORAGE: "/tmp/chipmate-storage/v2",
      },
      code,
    )

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      read: { "*": "allow", "chipmate.ts": "deny" },
      edit: { "*": "allow", "chipmate.ts": "deny" },
    })
  })
})
