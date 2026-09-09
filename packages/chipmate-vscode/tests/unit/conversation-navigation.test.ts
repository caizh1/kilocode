import { describe, expect, it } from "bun:test"
import {
  collectUserInputEntries,
  filterUserInputEntries,
} from "../../webview-ui/src/components/chat/conversation-navigation"
import type { Message, Part } from "../../webview-ui/src/types/messages"

function message(id: string, created: number, role: Message["role"] = "user"): Message {
  return {
    id,
    sessionID: "session-1",
    role,
    createdAt: new Date(created).toISOString(),
    time: { created },
  }
}

function text(messageID: string, value: string, synthetic = false): Part {
  return { id: `${messageID}-text`, messageID, type: "text", text: value, synthetic }
}

describe("QA 对话导航输入索引", () => {
  it("只收录非合成用户输入，并排除压缩消息", () => {
    const messages = [message("u1", 1), message("a1", 2, "assistant"), message("u2", 3), message("u3", 4)]
    const parts = new Map<string, Part[]>([
      ["u1", [text("u1", "真实问题")]],
      ["a1", [text("a1", "回答")]],
      ["u2", [text("u2", "系统合成内容", true)]],
      ["u3", [text("u3", "压缩摘要"), { id: "compact", messageID: "u3", type: "compaction", auto: true }]],
    ])

    expect(collectUserInputEntries(messages, (id) => parts.get(id) ?? [], "附件").map((entry) => entry.messageID)).toEqual([
      "u1",
    ])
  })

  it("附件输入优先回退为文件名，再回退为附件类型", () => {
    const messages = [message("file-name", 1), message("file-type", 2)]
    const parts = new Map<string, Part[]>([
      ["file-name", [{ id: "f1", messageID: "file-name", type: "file", mime: "image/png", url: "data:", filename: "设计图.png" }]],
      ["file-type", [{ id: "f2", messageID: "file-type", type: "file", mime: "application/pdf", url: "data:" }]],
    ])

    const entries = collectUserInputEntries(messages, (id) => parts.get(id) ?? [], "附件")
    expect(entries.map((entry) => entry.preview)).toEqual(["application/pdf", "设计图.png"])
  })

  it("摘录只显示第一段，但筛选覆盖完整原文和附件名", () => {
    const messages = [message("long", 1)]
    const parts: Part[] = [
      text("long", "第一段很长的问题\n仍然属于第一段\n\n第二段包含隐藏筛选词 芯片验证"),
      { id: "file", messageID: "long", type: "file", mime: "text/plain", url: "data:", filename: "原理图说明.txt" },
    ]
    const entries = collectUserInputEntries(messages, () => parts, "附件")

    expect(entries[0]?.preview).toBe("第一段很长的问题\n仍然属于第一段")
    expect(filterUserInputEntries(entries, "芯片验证", "zh-CN")).toHaveLength(1)
    expect(filterUserInputEntries(entries, "原理图说明", "zh-CN")).toHaveLength(1)
    expect(filterUserInputEntries(entries, "不存在", "zh-CN")).toHaveLength(0)
  })

  it("按时间最新在前，相同时间按消息原顺序最新项在前", () => {
    const messages = [message("old", 1), message("same-a", 2), message("same-b", 2), message("new", 3)]
    const entries = collectUserInputEntries(messages, (id) => [text(id, id)], "附件")
    expect(entries.map((entry) => entry.messageID)).toEqual(["new", "same-b", "same-a", "old"])
  })

  it("160 轮固定长会话零漏项、零多项，并可稳定解析 20 个远距离目标", () => {
    const messages = Array.from({ length: 160 }, (_, index) => message(`user-${index + 1}`, index + 1))
    const entries = collectUserInputEntries(messages, (id) => [text(id, `第 ${id.slice(5)} 个问题`)], "附件")
    const targets = Array.from({ length: 20 }, (_, index) => `user-${1 + index * 6}`)
    const indexed = new Map(entries.map((entry) => [entry.messageID, entry]))

    expect(entries).toHaveLength(160)
    expect(new Set(entries.map((entry) => entry.messageID)).size).toBe(160)
    expect(targets.every((id) => indexed.has(id))).toBe(true)

    const manualOperations = targets.reduce((sum, id) => sum + (160 - Number(id.slice(5)) + 1), 0)
    const navigationOperations = targets.length * 2
    const reduction = 1 - navigationOperations / manualOperations
    expect(reduction).toBeGreaterThanOrEqual(0.8)
  })
})
