import { describe, expect, it } from "bun:test"
import { createReferenceRequest } from "../../webview-ui/src/utils/prompt-reference-request"
import { promptCodeReferences } from "../../webview-ui/src/utils/prompt-code-references"
import { createPrompt } from "../../src/services/code-actions/support-prompt"

describe("引用请求绑定当前草稿", () => {
  it("代码摘要复用正式引用格式并可按精确范围移除", () => {
    const quote = createPrompt("ADD_TO_CONTEXT", {
      filePath: "C:\\验收\\入口.c",
      startLine: "3",
      endLine: "4",
      selectedText: "return 7;",
    })
    const text = `保留前文\n${quote}\n保留后文`
    const items = promptCodeReferences(text)
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe("C:\\验收\\入口.c:3-4")
    expect(text.slice(0, items[0].start) + text.slice(items[0].end)).toBe("保留前文\n\n保留后文")
    expect(promptCodeReferences("普通正文和没有文件位置的代码块")).toHaveLength(0)
  })
  it("匹配请求和选区，拒绝其他草稿、内容与请求", () => {
    const requests = createReferenceRequest()
    const id = requests.begin("会话甲", "已有草稿", 1, 3)
    expect(requests.read(id, "会话甲", "已有草稿")).toMatchObject({ start: 1, end: 3 })
    expect(requests.read(id, "会话乙", "已有草稿")).toBeUndefined()
    expect(requests.read(id, "会话甲", "已编辑")).toBeUndefined()
    expect(requests.read("其他请求", "会话甲", "已有草稿")).toBeUndefined()
  })
  it("重复点击只接受最后一次，清理后回到原草稿也不能接收迟到结果", () => {
    const requests = createReferenceRequest()
    const first = requests.begin("甲", "草稿", 0, 0)
    const second = requests.begin("甲", "草稿", 1, 1)
    expect(requests.read(first, "甲", "草稿")).toBeUndefined()
    expect(requests.read(second, "甲", "草稿")).toBeDefined()
    requests.clear()
    expect(requests.read(second, "甲", "草稿")).toBeUndefined()
  })
})
