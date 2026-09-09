import * as vscode from "vscode"
import path from "node:path"
import type { ChipMateClient } from "@chipmate/sdk/v2/client"
import type { ChipMateConnectionService } from "../services/cli-backend"
import type { TurnChangesMessage, TurnChangesRequest, TurnChangesResult } from "../shared/turn-changes"

export async function handleTurnChanges(
  request: TurnChangesRequest,
  opts: {
    client: ChipMateClient
    directory: string
    current: () => string | undefined
    post: (message: TurnChangesMessage) => void
  },
) {
  const target = { sessionID: request.sessionID, messageID: request.messageID, directory: opts.directory }
  const result = await (async (): Promise<TurnChangesResult> => {
    if (opts.current() !== request.sessionID) return { ok: false, message: "会话已切换，请重新打开本轮修改" }
    if (request.type === "turnChangesRequest") {
      if (request.fileID)
        return (await opts.client.turnChanges.detail({ ...target, fileID: request.fileID }, { throwOnError: true }))
          .data
      return (await opts.client.turnChanges.get(target, { throwOnError: true })).data
    }
    const { data } = await opts.client.turnChanges.get(target, { throwOnError: true })
    if (!data.ok || !data.summary) return data
    if (data.summary.revision !== request.revision)
      return { ok: false, message: "修改记录已更新，请重新审阅", summary: data.summary }
    const files = data.summary.files.filter((file) => !request.fileID || file.id === request.fileID)
    const paths = new Set(
      files.flatMap((file) =>
        [file.file, file.oldFile]
          .filter((item): item is string => !!item)
          .map((file) => path.resolve(data.summary!.directory, file)),
      ),
    )
    const dirty = vscode.workspace.textDocuments.find(
      (document) => document.isDirty && paths.has(path.resolve(document.uri.fsPath)),
    )
    if (dirty) return { ok: false, message: `请先保存或关闭未保存的编辑：${path.basename(dirty.uri.fsPath)}` }
    if (opts.current() !== request.sessionID) return { ok: false, message: "会话已切换，操作未执行" }
    return (
      await opts.client.turnChanges.mutate(
        {
          ...target,
          revision: request.revision,
          requestID: request.requestID,
          action: request.action,
          fileID: request.fileID,
          hunkID: request.hunkID,
        },
        { throwOnError: true },
      )
    ).data
  })().catch(
    (error): TurnChangesResult => ({ ok: false, message: error instanceof Error ? error.message : String(error) }),
  )
  opts.post({
    type: "turnChangesResult",
    sessionID: request.sessionID,
    messageID: request.messageID,
    requestID: request.requestID,
    result,
  })
}

export function registerTurnChangesEdits(connection: ChipMateConnectionService): vscode.Disposable {
  const dirty = new Set<string>()
  return vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.scheme !== "file") return
    const file = event.document.uri.fsPath
    if (!event.document.isDirty) {
      dirty.delete(file)
      return
    }
    if (!event.contentChanges.length || dirty.has(file)) return
    dirty.add(file)
    try {
      const client = connection.getClient()
      void client.turnChanges
        .external({ directory: path.dirname(file), file }, { throwOnError: true })
        .catch((error) => {
          console.warn("[ChipMate New] 无法记录人工编辑状态", error)
        })
    } catch (error) {
      console.warn("[ChipMate New] 后端尚未连接，人工编辑状态未发送", error)
    }
  })
}

export function rejectTurnChanges(message: Record<string, unknown>, post: (message: TurnChangesMessage) => void) {
  if (message.type !== "turnChangesMutate") return false
  if (
    typeof message.sessionID !== "string" ||
    typeof message.messageID !== "string" ||
    typeof message.requestID !== "string"
  )
    return false
  post({
    type: "turnChangesResult",
    sessionID: message.sessionID,
    messageID: message.messageID,
    requestID: message.requestID,
    result: { ok: false, message: "会话写入权限已切换，操作未执行，请刷新记录" },
  })
  return true
}
