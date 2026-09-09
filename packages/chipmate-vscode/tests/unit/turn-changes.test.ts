import { afterEach, expect, test } from "bun:test"
import * as vscode from "vscode"
import { createChipMateClient } from "@chipmate/sdk/v2/client"
import { handleTurnChanges, rejectTurnChanges } from "../../src/chipmate-provider/turn-changes"
import { isSessionSurfaceMutation } from "../../src/shared/session-surface"
import type { TurnChangesMessage, TurnChangesResult } from "../../src/shared/turn-changes"

afterEach(() => {
  ;(vscode.workspace.textDocuments as unknown[]).splice(0)
})
const summary: NonNullable<TurnChangesResult["summary"]> = {
  directory: "/工作区",
  sessionID: "会话",
  messageID: "本轮",
  revision: 3,
  phase: "ready",
  outcome: "interrupted",
  files: [
    {
      id: "文件",
      file: "a.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
      undone: [],
      state: "kept",
    },
  ],
  canRevert: true,
  canRestore: false,
}
function setup(current = () => "会话") {
  const bodies: unknown[] = [],
    messages: TurnChangesMessage[] = []
  const client = createChipMateClient({
    baseUrl: "http://127.0.0.1:1234",
    fetch: async (request) => {
      const req = request as Request
      if (req.method === "POST") bodies.push(await req.json())
      return Response.json({ ok: true, summary })
    },
  })
  return {
    bodies,
    messages,
    opts: { client, directory: "/工作区", current, post: (message: TurnChangesMessage) => messages.push(message) },
  }
}
test("差异块操作通过正式 SDK 并携带会话、版本和关联标识", async () => {
  const t = setup()
  await handleTurnChanges(
    {
      type: "turnChangesMutate",
      sessionID: "会话",
      messageID: "本轮",
      requestID: "操作",
      revision: 3,
      action: "revert",
      fileID: "文件",
      hunkID: "块",
    },
    t.opts,
  )
  expect(t.bodies).toEqual([{ revision: 3, requestID: "操作", action: "revert", fileID: "文件", hunkID: "块" }])
  expect(t.messages[0]).toMatchObject({
    type: "turnChangesResult",
    sessionID: "会话",
    messageID: "本轮",
    requestID: "操作",
    result: { ok: true },
  })
  expect(isSessionSurfaceMutation("turnChangesMutate")).toBe(true)
})
test("未保存的目标文件阻止后端写入", async () => {
  const t = setup()
  ;(vscode.workspace.textDocuments as unknown[]).push({ isDirty: true, uri: { fsPath: "/工作区/a.ts" } })
  await handleTurnChanges(
    {
      type: "turnChangesMutate",
      sessionID: "会话",
      messageID: "本轮",
      requestID: "操作",
      revision: 3,
      action: "revert",
    },
    t.opts,
  )
  expect(t.bodies).toEqual([])
  expect(t.messages[0]).toMatchObject({ result: { ok: false, message: "请先保存或关闭未保存的编辑：a.ts" } })
})
test("错误版本和切换后的会话不会发起写入", async () => {
  const t = setup()
  await handleTurnChanges(
    {
      type: "turnChangesMutate",
      sessionID: "会话",
      messageID: "本轮",
      requestID: "过期",
      revision: 2,
      action: "revert",
    },
    t.opts,
  )
  expect(t.bodies).toEqual([])
  expect(t.messages[0]).toMatchObject({ result: { ok: false } })
  const switched = setup(() => "其他会话")
  await handleTurnChanges(
    {
      type: "turnChangesMutate",
      sessionID: "会话",
      messageID: "本轮",
      requestID: "错位",
      revision: 3,
      action: "revert",
    },
    switched.opts,
  )
  expect(switched.bodies).toEqual([])
  expect(switched.messages[0]).toMatchObject({ result: { ok: false } })
})

test("操作权切换拒绝撤销时返回关联结果，避免界面一直等待", () => {
  const messages: TurnChangesMessage[] = []
  expect(
    rejectTurnChanges(
      { type: "turnChangesMutate", sessionID: "会话", messageID: "本轮", requestID: "操作" },
      (message) => messages.push(message),
    ),
  ).toBe(true)
  expect(messages).toEqual([
    {
      type: "turnChangesResult",
      sessionID: "会话",
      messageID: "本轮",
      requestID: "操作",
      result: { ok: false, message: "会话写入权限已切换，操作未执行，请刷新记录" },
    },
  ])
})
