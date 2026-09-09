import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createTurnRecord, pendingChanges } from "../../webview-ui/src/context/turn-changes-record"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"
import type { TurnChangesSummary } from "../../src/shared/turn-changes"
const summary = (revision: number, phase: TurnChangesSummary["phase"] = "running"): TurnChangesSummary => ({
  directory: "/项目",
  sessionID: "会话",
  messageID: "本轮",
  revision,
  phase,
  outcome: "completed",
  files: [],
  canRevert: false,
  canRestore: false,
})
function setup() {
  const sent: WebviewMessage[] = []
  const listeners = new Set<(message: ExtensionMessage) => void>()
  let dispose = () => {}
  const record = createRoot((cleanup) => {
    dispose = cleanup
    return createTurnRecord(
      {
        postMessage: (message) => sent.push(message),
        onMessage: (handler) => {
          listeners.add(handler)
          return () => {
            listeners.delete(handler)
          }
        },
      },
      "会话",
      "本轮",
    )
  })
  const reply = (value: TurnChangesSummary, requestID = (sent.at(-1) as { requestID: string }).requestID) => {
    for (const handler of listeners)
      handler({
        type: "turnChangesResult",
        sessionID: "会话",
        messageID: "本轮",
        requestID,
        result: { ok: true, summary: value },
      })
  }
  const event = (messageID = "本轮") => {
    for (const handler of listeners) handler({ type: "turnChangesUpdated", sessionID: "会话", messageID })
  }
  return { sent, record, reply, event, dispose, listeners }
}
test("视图收起时仍接收收尾记录，未完成阶段不算结果", () => {
  const t = setup()
  try {
    t.reply(summary(1))
    expect(pendingChanges(t.record.summary())).toBe(true)
    t.event()
    t.reply(summary(2, "settling"))
    expect(pendingChanges(t.record.summary())).toBe(true)
    t.event()
    t.reply(summary(3, "ready"))
    expect(pendingChanges(t.record.summary())).toBe(false)
  } finally {
    t.dispose()
  }
  expect(t.listeners.size).toBe(0)
})
test("迟到响应、旧版本和其他轮次不能替换当前记录", () => {
  const t = setup()
  try {
    const old = (t.sent.at(-1) as { requestID: string }).requestID
    t.record.load()
    t.reply(summary(4))
    t.reply(summary(99, "ready"), old)
    expect(t.record.summary()?.revision).toBe(4)
    t.event()
    t.reply(summary(2))
    expect(t.record.summary()?.revision).toBe(4)
    const count = t.sent.length
    t.event("其他轮")
    expect(t.sent.length).toBe(count)
  } finally {
    t.dispose()
  }
})
test("撤销中更新延后刷新，关联响应结束等待且只发送一次修改", () => {
  const t = setup()
  try {
    t.reply(summary(1, "ready"))
    t.record.mutate("revert")
    const request = t.sent.at(-1) as { requestID: string }
    t.record.mutate("revert")
    t.event()
    expect(t.sent.filter((message) => message.type === "turnChangesMutate")).toHaveLength(1)
    t.reply(summary(2, "ready"), request.requestID)
    expect(t.record.busy()).toBe(false)
    expect(t.sent.at(-1)?.type).toBe("turnChangesRequest")
  } finally {
    t.dispose()
  }
})
