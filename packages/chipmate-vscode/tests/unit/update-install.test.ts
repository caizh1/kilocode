import { describe, expect, it } from "bun:test"
import { installDetail, resolveInstall } from "../../src/services/update-check/install"

const vsix = String.raw`C:\离线 用户\更新 包 (A&B)!%\chipmate.vsix`

describe("更新安装器适配", () => {
  it("Windows 默认值使用当前 VS Code 内置 CLI，不读取 PATH 中的 code", () => {
    const exe = String.raw`C:\Program Files\Microsoft VS Code\Code.exe`
    const root = String.raw`C:\Program Files\Microsoft VS Code\resources\app`
    const call = resolveInstall("code", vsix, {
      platform: "win32",
      exe,
      root,
      env: {
        PATH: String.raw`C:\Windows\System32`,
        VSCODE_IPC_HOOK_CLI: String.raw`\\.\pipe\vscode-test`,
        NODE_OPTIONS: "--require test",
        NODE_REPL_EXTERNAL_MODULE: "test-repl",
      },
      exists: () => true,
    })

    expect(call.cmd).toBe(exe)
    expect(call.args).toEqual([
      String.raw`C:\Program Files\Microsoft VS Code\resources\app\out\cli.js`,
      "--install-extension",
      vsix,
      "--force",
    ])
    expect(call.opts.env).toMatchObject({
      PATH: String.raw`C:\Windows\System32`,
      VSCODE_IPC_HOOK_CLI: String.raw`\\.\pipe\vscode-test`,
      ELECTRON_RUN_AS_NODE: "1",
      VSCODE_NODE_OPTIONS: "--require test",
      VSCODE_NODE_REPL_EXTERNAL_MODULE: "test-repl",
    })
    expect(call.opts.env?.NODE_OPTIONS).toBeUndefined()
    expect(call.opts.env?.NODE_REPL_EXTERNAL_MODULE).toBeUndefined()
  })

  it("Windows cmd 和 bat 通过 ComSpec 与子进程环境安全传参", () => {
    for (const ext of ["cmd", "bat"]) {
      const cli = String.raw`C:\工具 目录\code.${ext}`
      const call = resolveInstall(cli, vsix, {
        platform: "win32",
        env: { ComSpec: String.raw`C:\Windows\System32\cmd.exe` },
        exists: () => true,
      })

      expect(call.cmd).toBe(String.raw`C:\Windows\System32\cmd.exe`)
      expect(call.args).toEqual([
        "/d",
        "/s",
        "/c",
        '""%CHIPMATE_UPDATE_CLI%" --install-extension "%CHIPMATE_UPDATE_VSIX%" --force"',
      ])
      expect(call.opts.env).toMatchObject({
        CHIPMATE_UPDATE_CLI: cli,
        CHIPMATE_UPDATE_VSIX: vsix,
      })
    }
  })

  it("Windows exe 与非 Windows 可执行文件保持直接执行", () => {
    const exe = String.raw`C:\VS Code\bin\code.exe`
    expect(
      resolveInstall(exe, vsix, { platform: "win32", exists: () => true }).cmd,
    ).toBe(exe)
    expect(resolveInstall("/opt/code/bin/code", "/tmp/a.vsix", { platform: "linux", exists: () => true })).toMatchObject(
      {
        cmd: "/opt/code/bin/code",
        args: ["--install-extension", "/tmp/a.vsix", "--force"],
        opts: {},
      },
    )
  })

  it("Windows 默认 CLI 入口缺失时立即返回可操作错误", () => {
    const exe = String.raw`C:\VS Code\Code.exe`
    expect(() =>
      resolveInstall("code", vsix, {
        platform: "win32",
        exe,
        root: String.raw`C:\VS Code\resources\app`,
        exists: (file) => file === exe,
      }),
    ).toThrow("当前 VS Code CLI 入口不存在")
  })

  it("显式绝对 CLI 路径缺失时不启动子进程", () => {
    expect(() =>
      resolveInstall(String.raw`C:\不存在\code.exe`, vsix, {
        platform: "win32",
        exists: () => false,
      }),
    ).toThrow("配置的 VS Code CLI 不存在")
  })

  it("提取退出码、信号和受限长度的子进程输出", () => {
    const err = Object.assign(new Error(`Command failed ${"m".repeat(5_000)}`), {
      code: 7,
      signal: "SIGTERM",
      stderr: "x".repeat(5_000),
      stdout: "安装输出",
    })
    const detail = installDetail(err)

    expect(detail).toContain("Command failed")
    expect(detail).toContain("退出码：7")
    expect(detail).toContain("信号：SIGTERM")
    expect(detail).toContain("stderr：")
    expect(detail).toContain("stdout：安装输出")
    expect(detail.length).toBeLessThan(8_500)
    expect(detail).not.toContain("m".repeat(4_500))
  })
})
