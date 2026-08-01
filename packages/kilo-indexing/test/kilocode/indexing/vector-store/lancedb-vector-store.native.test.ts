import { describe, expect, test } from "bun:test"

describe("LanceDB 原生批量 generation finalize", () => {
  test("在隔离进程中使用真实原生运行库", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "./test/kilocode/indexing/vector-store/lancedb-vector-store.native-case.ts",
        "--timeout",
        "30000",
      ],
      {
        cwd: import.meta.dir.replace("/test/kilocode/indexing/vector-store", ""),
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])

    expect(`${stdout}\n${stderr}`).toContain("1 pass")
    expect(code).toBe(0)
  }, 30_000)
})
