import * as path from "path"
import { open, rename, unlink } from "fs/promises"
import { randomUUID } from "crypto"
import * as vscode from "vscode"
import type { ChipMateClient } from "@chipmate/sdk/v2/client"

const confirmLabel = "确认并选择保存位置"
const openLabel = "打开文件"

type Input = {
  sessionID: string
  dir: string
  waitForIdle?: (sessionIDs: string[], token: vscode.CancellationToken) => Promise<void>
  now?: () => Date
}

export async function exportTranscript(client: ChipMateClient, input: Input) {
  const confirmed = await vscode.window.showWarningMessage(
    "导出的原始 QA 会话不会脱敏",
    {
      modal: true,
      detail:
        "文件将包含根会话及全部子 Agent 的持久化文本、reasoning、工具参数和结果、错误、权限、路径、费用及原始 JSON。请只保存到可信位置。",
    },
    confirmLabel,
  )
  if (confirmed !== confirmLabel) return false

  const now = input.now?.() ?? new Date()
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(
      path.join(input.dir, `chipmate-session-${input.sessionID.slice(0, 8)}-${timestamp(now)}.md`),
    ),
    filters: { Markdown: ["md"] },
    saveLabel: "导出",
    title: "保存 ChipMate QA 原始会话",
  })
  if (!uri) return false

  const saved = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "正在导出 ChipMate QA 原始会话",
      cancellable: true,
    },
    async (progress, token) => {
      const controller = new AbortController()
      let cancelled = token.isCancellationRequested
      const cancellation = token.onCancellationRequested(() => {
        cancelled = true
        controller.abort()
      })
      try {
        let snapshotRetries = 0
        while (!cancelled) {
          progress.report({ message: "正在核对根会话与全部子 Agent…" })
          const result = await client.chipmate.sessionExport(
            { sessionID: input.sessionID, directory: input.dir },
            { signal: controller.signal },
          )
          if (typeof result.data === "string") {
            if (cancelled || token.isCancellationRequested) return false
            progress.report({ message: "正在原子写入 UTF-8 文件…" })
            await writeTranscriptAtomically(uri, result.data, () => cancelled || token.isCancellationRequested)
            return true
          }
          if (result.response.status !== 409) throw responseError(result.response.status, result.error)
          const sessionIDs = busySessionIDs(result.error)
          if (sessionIDs.length === 0) {
            snapshotRetries++
            if (snapshotRetries > 5) throw new Error("会话树持续变化，暂时无法取得稳定快照，请稍后重试。")
            continue
          }
          snapshotRetries = 0
          if (!input.waitForIdle) throw new Error("会话仍在运行，当前客户端无法等待状态更新。")
          progress.report({ message: `等待 ${sessionIDs.length} 个会话完成，可随时取消…` })
          await input.waitForIdle(sessionIDs, token)
        }
        return false
      } catch (error) {
        if (cancelled || token.isCancellationRequested) return false
        throw error
      } finally {
        cancellation.dispose()
      }
    },
  )
  if (!saved) return false
  const action = await vscode.window.showInformationMessage("ChipMate QA 原始会话已导出。", openLabel)
  if (action === openLabel) await vscode.commands.executeCommand("vscode.open", uri)
  return true
}

export async function writeTranscriptAtomically(uri: vscode.Uri, text: string, cancelled: () => boolean = () => false) {
  if (uri.scheme !== "file") throw new Error("原始会话只能保存到本地文件系统。")
  const temporary = path.join(path.dirname(uri.fsPath), `.${path.basename(uri.fsPath)}.${randomUUID()}.tmp`)
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(temporary, "wx", 0o600)
    await file.writeFile(text, { encoding: "utf8" })
    await file.sync()
    if (cancelled()) throw new Error("已取消导出。")
    await file.close()
    file = undefined
    await rename(temporary, uri.fsPath)
  } catch (error) {
    await file?.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function timestamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)
}

function busySessionIDs(error: unknown) {
  if (!error || typeof error !== "object" || !("sessionIDs" in error) || !Array.isArray(error.sessionIDs)) return []
  return error.sessionIDs.filter((item): item is string => typeof item === "string")
}

function responseError(status: number, error: unknown) {
  const detail = error && typeof error === "object" ? JSON.stringify(error) : String(error ?? "")
  return new Error(`导出会话失败（HTTP ${status}）${detail ? `：${detail}` : ""}`)
}
