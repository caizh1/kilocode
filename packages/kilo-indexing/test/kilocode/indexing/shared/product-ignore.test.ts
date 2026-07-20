import { describe, expect, test } from "bun:test"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../../..")

describe("ChipMate v2 ignore isolation", () => {
  test("loads only .chipmate-v2ignore for the ChipMate product profile", async () => {
    const code = [
      'import { mkdtemp, writeFile } from "node:fs/promises"',
      'import os from "node:os"',
      'import path from "node:path"',
      'const dir = await mkdtemp(path.join(os.tmpdir(), "chipmate-ignore-"))',
      'await writeFile(path.join(dir, ".kilocodeignore"), "official.ts\\n")',
      'await writeFile(path.join(dir, ".chipmate-v2ignore"), "chipmate.ts\\n")',
      'const { loadIgnore } = await import("./src/indexing/shared/load-ignore.ts")',
      "const ignore = await loadIgnore(dir)",
      'console.log(JSON.stringify({ official: ignore.ignores("official.ts"), chipmate: ignore.ignores("chipmate.ts") }))',
    ].join(";")
    const child = Bun.spawn([process.execPath, "-e", code], {
      cwd: root,
      env: { ...process.env, KILO_PRODUCT_PROFILE: "chipmate-v2" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect(stderr).toBe("")
    expect(status).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ official: false, chipmate: true })
  })
})
