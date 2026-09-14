import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createTurnRecord } from "../../webview-ui/src/context/turn-changes-record"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"
import type { TurnChangesResult } from "../../src/shared/turn-changes"

function fixture() {
  const sent: WebviewMessage[] = []
  const listeners = new Set<(message: ExtensionMessage) => void>()
  let dispose = () => {}
  const record = createRoot((cleanup) => {
    dispose = cleanup
    return createTurnRecord(
      {
        postMessage: (message) => sent.push(message),
        onMessage: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      },
      "会话甲",
      "第一轮",
    )
  })
  const send = (message: ExtensionMessage) => {
    for (const listener of listeners) listener(message)
  }
  const requests = () => sent.filter((message) => message.type === "turnChangesRequest")
  const mutations = () => sent.filter((message) => message.type === "turnChangesMutate")
  const reply = (result: TurnChangesResult, id = requests().at(-1)!.requestID) =>
    send({ type: "turnChangesResult", sessionID: "会话甲", messageID: "第一轮", requestID: id, result })
  const summary = (revision = 1, files = ["文件甲", "文件乙"]) => ({
    directory: "/甲工作树",
    sessionID: "会话甲",
    messageID: "第一轮",
    revision,
    phase: "ready" as const,
    outcome: "completed" as const,
    canRevert: true,
    canRestore: true,
    files: files.map((id) => ({
      id,
      file: `${id}.ts`,
      status: "modified" as const,
      additions: 1,
      deletions: 1,
      binary: false,
      undone: [],
      state: "kept" as const,
    })),
  })
  const detail = (fileID = "文件甲", revision = 1) => ({ fileID, revision, patch: "差异", hunks: [] })
  const updated = () => send({ type: "turnChangesUpdated", sessionID: "会话甲", messageID: "第一轮" })
  const open = () => {
    reply({ ok: true, summary: summary() })
    record.setExpanded(true)
    reply({ ok: true, summary: summary() })
    record.setSelected("文件甲")
    reply({ ok: true, detail: detail() })
  }
  return { record, dispose, sent, listeners, send, requests, mutations, reply, summary, detail, updated, open }
}

test("后台更新不发读取，切回自动刷新并保留展开轮次和文件", () => {
  const t = fixture()
  try {
    t.open()
    t.record.setAvailability(false, true)
    const count = t.sent.length
    for (let n = 0; n < 10; n++) t.updated()
    expect(t.sent).toHaveLength(count)
    expect(t.record.error()).toBeUndefined()
    expect(t.record.ready()).toBe(false)
    t.record.setAvailability(true, true)
    expect(t.requests()).toHaveLength(count + 1)
    expect(t.record.expanded()).toBe(true)
    expect(t.record.selected()).toBe("文件甲")
    t.reply({ ok: true, summary: t.summary(2) })
    expect(t.requests().at(-1)?.fileID).toBe("文件甲")
    expect(t.record.ready()).toBe(false)
    t.reply({ ok: true, detail: t.detail("文件甲", 2) })
    expect(t.record.detail()?.revision).toBe(2)
    expect(t.record.ready()).toBe(true)
  } finally {
    t.dispose()
  }
})

test("合并重复摘要刷新，摘要与详情响应独立关联", () => {
  const t = fixture()
  try {
    t.open()
    t.record.setSelected("文件乙")
    const file = t.requests().at(-1)!
    t.updated()
    const summary = t.requests().at(-1)!
    for (let n = 0; n < 10; n++) t.updated()
    expect(t.requests().at(-1)).toBe(summary)
    t.reply({ ok: true, detail: t.detail("文件乙") }, file.requestID)
    expect(t.record.detail()?.fileID).toBe("文件乙")
    t.reply({ ok: true, summary: t.summary() }, summary.requestID)
    expect(t.requests().length).toBe(6)
    t.reply({ ok: true, summary: t.summary() })
    expect(t.record.ready()).toBe(true)
    expect(t.record.detail()?.fileID).toBe("文件乙")
  } finally {
    t.dispose()
  }
})

test("切换文件的迟到响应与旧版本不能覆盖新选择", () => {
  const t = fixture()
  try {
    t.reply({ ok: true, summary: t.summary() })
    t.record.setExpanded(true)
    t.reply({ ok: true, summary: t.summary() })
    t.record.setSelected("文件甲")
    const old = t.requests().at(-1)!
    t.record.setSelected("文件乙")
    const latest = t.requests().at(-1)!
    t.reply({ ok: true, detail: t.detail("文件甲") }, old.requestID)
    expect(t.record.detail()).toBeUndefined()
    t.reply({ ok: true, detail: t.detail("文件乙") }, latest.requestID)
    t.updated()
    t.reply({ ok: true, summary: t.summary(2) })
    const next = t.requests().at(-1)!
    t.reply({ ok: true, detail: t.detail("文件乙", 2) }, next.requestID)
    t.reply({ ok: true, detail: t.detail("文件乙", 1) }, latest.requestID)
    expect(t.record.detail()?.revision).toBe(2)
  } finally {
    t.dispose()
  }
})

test("断线取消旧读取，重连自动恢复，旧连接错误不会污染记录", () => {
  const t = fixture()
  try {
    const old = t.requests().at(-1)!
    t.record.setAvailability(true, false)
    t.updated()
    expect(t.requests()).toHaveLength(1)
    t.record.setAvailability(true, true)
    const latest = t.requests().at(-1)!
    t.reply({ ok: true, summary: t.summary(3) }, latest.requestID)
    t.reply({ ok: false, message: "旧连接已断开" }, old.requestID)
    expect(t.record.error()).toBeUndefined()
    expect(t.record.summary()?.revision).toBe(3)
    expect(t.record.ready()).toBe(true)
  } finally {
    t.dispose()
  }
})

test("收起时保留选择且不读详情，文件消失只清除选择", () => {
  const t = fixture()
  try {
    t.open()
    t.record.setExpanded(false)
    t.updated()
    t.reply({ ok: true, summary: t.summary(2) })
    expect(t.record.selected()).toBe("文件甲")
    expect(t.requests().at(-1)?.fileID).toBeUndefined()
    t.record.setExpanded(true)
    t.reply({ ok: true, summary: t.summary(3, ["文件乙"]) })
    expect(t.record.selected()).toBeUndefined()
    expect(t.record.detail()).toBeUndefined()
    expect(t.record.expanded()).toBe(true)
  } finally {
    t.dispose()
  }
})

test("刷新期间不发写入，成功读取不抹掉真实撤销冲突", () => {
  const t = fixture()
  try {
    t.reply({ ok: true, summary: t.summary() })
    t.updated()
    t.record.mutate("revert")
    expect(t.mutations()).toHaveLength(0)
    t.reply({ ok: true, summary: t.summary() })
    t.record.mutate("revert")
    const operation = t.mutations()[0]!
    t.reply({ ok: false, message: "目标文件有冲突", summary: t.summary() }, operation.requestID)
    t.reply({ ok: true, summary: t.summary() })
    expect(t.record.error()).toBe("目标文件有冲突")
    expect(t.record.busy()).toBe(false)
    expect(t.mutations()).toHaveLength(1)
  } finally {
    t.dispose()
  }
})

test("切走后的撤销结果归还原轮次，切回只刷新不重放", () => {
  const t = fixture()
  try {
    t.reply({ ok: true, summary: t.summary() })
    t.record.mutate("revert")
    const operation = t.mutations()[0]!
    t.record.setAvailability(false, true)
    const count = t.sent.length
    t.reply({ ok: true, summary: t.summary(2) }, operation.requestID)
    expect(t.sent).toHaveLength(count)
    expect(t.record.busy()).toBe(false)
    t.record.setAvailability(true, true)
    t.reply({ ok: true, summary: t.summary(2) })
    expect(t.mutations()).toHaveLength(1)
    expect(t.record.summary()?.revision).toBe(2)
  } finally {
    t.dispose()
  }
})

test("撤销中断线不重放，销毁后无订阅、请求或忙碌残留", () => {
  const t = fixture()
  t.reply({ ok: true, summary: t.summary() })
  t.record.mutate("revert")
  t.record.setAvailability(true, false)
  expect(t.record.busy()).toBe(false)
  expect(t.record.error()).toContain("操作结果待核对")
  t.record.setAvailability(true, true)
  t.reply({ ok: true, summary: t.summary(2) })
  expect(t.mutations()).toHaveLength(1)
  t.dispose()
  const count = t.sent.length
  t.updated()
  t.record.load()
  t.record.setAvailability(true, true)
  t.record.mutate("revert")
  expect(t.sent).toHaveLength(count)
  expect(t.listeners.size).toBe(0)
  expect(t.record.loading()).toBe(false)
  expect(t.record.ready()).toBe(false)
})
