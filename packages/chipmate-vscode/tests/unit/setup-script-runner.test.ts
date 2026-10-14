import { expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { SetupScriptRunner } from "../../src/agent-manager/SetupScriptRunner"

it("QA-022 真实准备脚本失败阻止推进，修复脚本后可恢复", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "chipmate-准备脚本-"))
  try {
    const file = path.join(root, "setup.sh")
    const logs: string[] = []
    const runner = new SetupScriptRunner(
      (text) => logs.push(text),
      {
        resolveScript: () => ({ path: file, kind: "shell" }),
      } as never,
      async (config) => {
        const child = Bun.spawn([config.command, ...config.args], {
          cwd: config.cwd,
          env: { ...process.env, ...config.env },
          stdout: "pipe",
          stderr: "pipe",
        })
        return child.exited
      },
    )
    await Bun.write(file, "#!/bin/sh\nexit 7\n")
    await expect(runner.runIfConfigured({ worktreePath: root, repoPath: root })).rejects.toThrow("code 7")
    await Bun.write(file, "#!/bin/sh\nprintf '准备完成' > 结果.txt\n")
    await expect(runner.runIfConfigured({ worktreePath: root, repoPath: root })).resolves.toBe(true)
    expect(await Bun.file(path.join(root, "结果.txt")).text()).toBe("准备完成")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it("QA-022 没有退出码的中断不能当作成功", async () => {
  const runner = new SetupScriptRunner(
    () => {},
    { resolveScript: () => ({ path: "/测试/setup.sh", kind: "shell" }) } as never,
    async () => undefined,
  )
  await expect(runner.runIfConfigured({ worktreePath: "/测试", repoPath: "/测试" })).rejects.toThrow("已中断")
})
