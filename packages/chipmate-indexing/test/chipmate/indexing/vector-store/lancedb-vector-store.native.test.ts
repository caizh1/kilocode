import { describe, expect, test } from "bun:test"

describe("LanceDB 原生批量 generation finalize", () => {
  test("在隔离进程中使用真实原生运行库", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "./test/chipmate/indexing/vector-store/lancedb-vector-store.native-case.ts",
        "--timeout",
        "30000",
      ],
      {
        cwd: import.meta.dir.replace("/test/chipmate/indexing/vector-store", ""),
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])

    const output = `${stdout}\n${stderr}`
    expect(output).toContain("使用当前原生运行库激活新 generation 并清理旧数据")
    expect(output).toContain("清空候选代后保留完整向量身份并支持中断恢复和跨进程重开")
    expect(output).toContain("0 fail")
    expect(code).toBe(0)
  }, 30_000)
})
