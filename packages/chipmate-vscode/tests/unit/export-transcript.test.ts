import { afterEach, describe, expect, it, mock } from "bun:test"
import { mkdtemp, readFile, readdir, rm, stat } from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import type { ChipMateClient } from "@chipmate/sdk/v2/client"
import { exportTranscript, writeTranscriptAtomically } from "../../src/chipmate-provider/export-transcript"

const original = {
  warning: vscode.window.showWarningMessage,
  save: vscode.window.showSaveDialog,
  progress: vscode.window.withProgress,
  information: vscode.window.showInformationMessage,
  execute: vscode.commands.executeCommand,
}

afterEach(() => {
  Object.assign(vscode.window, {
    showWarningMessage: original.warning,
    showSaveDialog: original.save,
    withProgress: original.progress,
    showInformationMessage: original.information,
  })
  vscode.commands.executeCommand = original.execute
})

describe("QA 原始会话导出", () => {
  it("每次都先确认未脱敏风险，并允许取消确认或保存", async () => {
    const warning = mock().mockResolvedValueOnce(undefined).mockResolvedValueOnce("确认并选择保存位置")
    const save = mock().mockResolvedValue(undefined)
    vscode.window.showWarningMessage = warning as never
    vscode.window.showSaveDialog = save as never
    const api = mock()
    const input = { sessionID: "ses_123456789", dir: "/repo" }

    expect(await exportTranscript(client(api), input)).toBe(false)
    expect(await exportTranscript(client(api), input)).toBe(false)
    expect(warning).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledTimes(1)
    expect(api).not.toHaveBeenCalled()
  })

  it("等待 409 中的活动会话后重试，原子写入 0600 文件并提供打开操作", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chipmate-export-test-"))
    try {
      const target = vscode.Uri.file(path.join(directory, "会话.md"))
      vscode.window.showWarningMessage = mock(() => Promise.resolve("确认并选择保存位置")) as never
      const save = mock(() => Promise.resolve(target))
      vscode.window.showSaveDialog = save as never
      progressImmediately()
      vscode.window.showInformationMessage = mock(() => Promise.resolve("打开文件")) as never
      const execute = mock(() => Promise.resolve())
      vscode.commands.executeCommand = execute as never
      const api = mock()
        .mockResolvedValueOnce({
          data: undefined,
          error: { sessionIDs: ["ses_child", "ses_grandchild"] },
          response: { status: 409 },
        })
        .mockResolvedValueOnce({ data: "# 中文导出\n\n完整内容", error: undefined, response: { status: 200 } })
      const wait = mock(() => Promise.resolve())

      expect(
        await exportTranscript(client(api), {
          sessionID: "ses_123456789",
          dir: directory,
          waitForIdle: wait,
          now: () => new Date("2026-08-17T01:02:03.000Z"),
        }),
      ).toBe(true)
      expect(wait).toHaveBeenCalledWith(["ses_child", "ses_grandchild"], expect.anything())
      expect(api).toHaveBeenCalledTimes(2)
      expect((save.mock.calls[0]?.[0] as { defaultUri: vscode.Uri }).defaultUri.fsPath).toEndWith(
        "chipmate-session-ses_1234-20260817-010203.md",
      )
      expect(await readFile(target.fsPath, "utf8")).toBe("# 中文导出\n\n完整内容")
      expect((await stat(target.fsPath)).mode & 0o777).toBe(0o600)
      expect((await readdir(directory)).filter((item) => item.endsWith(".tmp"))).toEqual([])
      expect(execute).toHaveBeenCalledWith("vscode.open", target)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("进度取消时中止且不请求、不留下半成品", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chipmate-export-cancel-"))
    try {
      const target = vscode.Uri.file(path.join(directory, "cancelled.md"))
      vscode.window.showWarningMessage = mock(() => Promise.resolve("确认并选择保存位置")) as never
      vscode.window.showSaveDialog = mock(() => Promise.resolve(target)) as never
      vscode.window.withProgress = (async (_options: unknown, task: Function) =>
        task(
          { report: () => undefined },
          { isCancellationRequested: true, onCancellationRequested: () => ({ dispose: () => undefined }) },
        )) as never
      const api = mock()

      expect(await exportTranscript(client(api), { sessionID: "ses_cancel", dir: directory })).toBe(false)
      expect(api).not.toHaveBeenCalled()
      expect(await readdir(directory)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("等待期间断线时失败且不留下半成品", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chipmate-export-offline-"))
    try {
      const target = vscode.Uri.file(path.join(directory, "offline.md"))
      vscode.window.showWarningMessage = mock(() => Promise.resolve("确认并选择保存位置")) as never
      vscode.window.showSaveDialog = mock(() => Promise.resolve(target)) as never
      progressImmediately()
      const api = mock(() =>
        Promise.resolve({ data: undefined, error: { sessionIDs: ["ses_busy"] }, response: { status: 409 } }),
      )

      await expect(
        exportTranscript(client(api), {
          sessionID: "ses_offline",
          dir: directory,
          waitForIdle: () => Promise.reject(new Error("ChipMate 后端连接已断开，导出已停止。")),
        }),
      ).rejects.toThrow("连接已断开")
      expect(await readdir(directory)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("原子写入拒绝非本地 URI", async () => {
    await expect(
      writeTranscriptAtomically({ scheme: "vscode-remote", fsPath: "/tmp/export.md" } as vscode.Uri, "内容"),
    ).rejects.toThrow("只能保存到本地")
  })

  it("原子改名前取消会清理临时文件", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chipmate-export-atomic-cancel-"))
    try {
      const target = vscode.Uri.file(path.join(directory, "cancel-before-rename.md"))
      await expect(writeTranscriptAtomically(target, "敏感原始内容", () => true)).rejects.toThrow("已取消")
      expect(await readdir(directory)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("保留历史菜单和 /export 两个既有入口", async () => {
    const root = path.resolve(import.meta.dir, "../..")
    const [history, slash, prompt, provider] = await Promise.all([
      readFile(path.join(root, "webview-ui/src/components/history/SessionList.tsx"), "utf8"),
      readFile(path.join(root, "webview-ui/src/hooks/useSlashCommand.ts"), "utf8"),
      readFile(path.join(root, "webview-ui/src/components/chat/PromptInput.tsx"), "utf8"),
      readFile(path.join(root, "src/ChipMateProvider.ts"), "utf8"),
    ])
    expect(history).toContain("session.exportSessionTranscript(item.id)")
    expect(slash).toContain('CustomEvent("exportSessionTranscript")')
    expect(prompt).toContain("session.exportSessionTranscript(id)")
    expect(provider).toContain("handleExportSessionTranscript(sessionID)")
  })
})

function client(sessionExport: ReturnType<typeof mock>): ChipMateClient {
  return { chipmate: { sessionExport } } as never
}

function progressImmediately() {
  vscode.window.withProgress = (async (_options: unknown, task: Function) =>
    task(
      { report: () => undefined },
      { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) },
    )) as never
}
