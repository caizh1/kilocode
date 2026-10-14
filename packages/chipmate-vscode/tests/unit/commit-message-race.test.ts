import { afterEach, expect, it, spyOn } from "bun:test"
import * as vscode from "vscode"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { registerCommitMessageService } from "../../src/services/commit-message"

const roots: string[] = []
const restores: Array<() => void> = []
afterEach(async () => {
  restores.splice(0).forEach((restore) => restore())
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "chipmate-提交竞争-"))
  roots.push(root)
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root })
  git("init", "-q")
  await Bun.write(path.join(root, "中文文件.ts"), "export const 值 = 1\n")
  git("add", ".")
  const inputBox = { value: "初始说明" }
  let command: () => Promise<void> = async () => {
    throw new Error("命令未注册")
  }
  let cancel = () => {}
  let calls = 0
  let started = Promise.withResolvers<void>()
  let response = Promise.withResolvers<{ data: { message: string } }>()
  const register = spyOn(vscode.commands, "registerCommand").mockImplementation((_id, callback) => {
    command = callback
    return { dispose() {} }
  })
  const extension = spyOn(vscode.extensions, "getExtension").mockReturnValue({
    isActive: true,
    exports: { getAPI: () => ({ repositories: [{ rootUri: vscode.Uri.file(root), inputBox }] }) },
  } as never)
  const progress = spyOn(vscode.window, "withProgress").mockImplementation(async (_options, task) =>
    task(
      {} as never,
      {
        isCancellationRequested: false,
        onCancellationRequested: (callback: () => void) => {
          cancel = callback
          return { dispose() {} }
        },
      } as never,
    ),
  )
  restores.push(
    () => register.mockRestore(),
    () => extension.mockRestore(),
    () => progress.mockRestore(),
  )
  registerCommitMessageService(
    { subscriptions: [] } as never,
    {
      getClientAsync: async () => ({
        commitMessage: {
          generate: async () => {
            calls++
            started.resolve()
            return response.promise
          },
        },
      }),
    } as never,
  )
  return {
    root,
    git,
    inputBox,
    run: () => command(),
    cancel: () => cancel(),
    calls: () => calls,
    started: () => started.promise,
    finish: () => response.resolve({ data: { message: "生成说明" } }),
    reset: () => {
      response = Promise.withResolvers()
      started = Promise.withResolvers()
    },
  }
}

it("QA-033 同一仓库连续点击十次只发一次请求，结束后可重新生成", async () => {
  const env = await setup()
  const runs = Array.from({ length: 10 }, () => env.run())
  await env.started()
  expect(env.calls()).toBe(1)
  env.finish()
  await Promise.all(runs)
  expect(env.inputBox.value).toBe("生成说明")
  env.reset()
  const next = env.run()
  await env.started()
  env.finish()
  await next
  expect(env.calls()).toBe(2)
})

for (const action of ["编辑说明", "修改暂存内容", "取消"] as const) {
  it(`QA-032 ${action}后迟到的提交说明不能覆盖输入`, async () => {
    const env = await setup()
    const pending = env.run()
    await env.started()
    if (action === "编辑说明") env.inputBox.value = "用户正在写的说明"
    if (action === "修改暂存内容") {
      await Bun.write(path.join(env.root, "中文文件.ts"), "export const 值 = 2\n")
      env.git("add", ".")
    }
    if (action === "取消") env.cancel()
    const expected = env.inputBox.value
    env.finish()
    await pending
    expect(env.inputBox.value).toBe(expected)
  })
}
