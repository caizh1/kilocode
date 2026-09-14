import * as vscode from "vscode"
import path from "node:path"
import type { ChipMateClient } from "@chipmate/sdk/v2/client"
import type { ChipMateConnectionService } from "../services/cli-backend"
import type { TurnChangesMessage, TurnChangesRequest, TurnChangesResult } from "../shared/turn-changes"

// 只合并正在进行的元数据读取；工作树迁移后不复用旧目录。
const directories = new WeakMap<ChipMateClient, Map<string, Promise<string>>>()
export function resolveTurnChangesDirectory(client: ChipMateClient, sessionID: string, directory: string) {
  const pending = directories.get(client) ?? new Map<string, Promise<string>>()
  directories.set(client, pending)
  const key = JSON.stringify([sessionID, directory])
  const existing = pending.get(key)
  if (existing) return existing
  const request = client.session
    .get({ sessionID, directory }, { throwOnError: true })
    .then(({ data }) => {
      if (data.id !== sessionID || !data.directory) throw new Error("无法确定修改记录所属的工作目录")
      return data.directory
    })
    .finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

export async function handleTurnChanges(
  request: TurnChangesRequest,
  opts: {
    client: ChipMateClient
    directory: string | (() => Promise<string>)
    current: () => string | undefined
    authorize: () => boolean
    post: (message: TurnChangesMessage) => void
  },
) {
  const result = await (async (): Promise<TurnChangesResult> => {
    const writable = () => opts.current() === request.sessionID && opts.authorize()
    if (request.type === "turnChangesMutate" && !writable())
      return { ok: false, message: "会话或操作权已切换，操作未执行" }
    const directory = typeof opts.directory === "string" ? opts.directory : await opts.directory()
    const target = { sessionID: request.sessionID, messageID: request.messageID, directory }
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
    if (!writable()) return { ok: false, message: "会话或操作权已切换，操作未执行" }
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
