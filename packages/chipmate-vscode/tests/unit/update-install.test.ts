import { afterEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import { installDetail, installInCurrentProfile } from "../../src/services/update-check/install"

const execute = vscode.commands.executeCommand

afterEach(() => { vscode.commands.executeCommand = execute })

describe("当前窗口的更新安装", () => {
  for (const file of [String.raw`C:\离线 用户\更新 包 (A&B)!%\chipmate.vsix`, "/tmp/更新 包/chipmate.vsix"]) {
    it(`通过 URI 安装，不使用 shell：${file}`, async () => {
      const command = mock(async () => undefined)
      vscode.commands.executeCommand = command as typeof execute
      await installInCurrentProfile(file)
      expect(command).toHaveBeenCalledWith("workbench.extensions.installExtension", vscode.Uri.file(file))
      expect(command).toHaveBeenCalledTimes(1)
    })
  }

  it("等待原生安装结束才完成", async () => {
    let finish!: () => void
    let completed = false
    vscode.commands.executeCommand = (() => new Promise<void>((resolve) => { finish = resolve })) as typeof execute
    const installing = installInCurrentProfile("/tmp/更新.vsix").then(() => { completed = true })
    await Promise.resolve()
    expect(completed).toBe(false)
    finish()
    await installing
    expect(completed).toBe(true)
  })

  it("取消或原生命令失败原样返回，不回退至 CLI", async () => {
    const failure = new Error("用户取消安装")
    const command = mock(async () => { throw failure })
    vscode.commands.executeCommand = command as typeof execute
    await expect(installInCurrentProfile("/tmp/更新.vsix")).rejects.toBe(failure)
    expect(command).toHaveBeenCalledTimes(1)
  })

  it("安装错误记录保持有界", () => {
    const detail = installDetail(Object.assign(new Error("安装失败"), { stderr: "错".repeat(5000) }))
    expect(detail).toContain("安装失败")
    expect(detail.length).toBeLessThan(4500)
  })
})
