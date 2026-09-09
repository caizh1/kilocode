import { describe, expect, test } from "bun:test"
import type { AssistantBlock } from "@deepseek-ai/dsh-client-runtime/client"
import {
  projectAssistantBlocks,
  splitTaggedReasoning,
} from "../../webview-ui/src/components/deepseek-harness/deepseek-harness-presentation"

describe("ChipMate DeepSeek Harness 思考展示投影", () => {
  test("优先使用官方 reasoning 块且不修改输入", () => {
    const blocks = [
      { kind: "reasoning", text: "官方思考" },
      { kind: "text", text: "<think>不应再次拆分</think>回答" },
    ] satisfies AssistantBlock[]
    const before = structuredClone(blocks)

    expect(projectAssistantBlocks("node-1", blocks, false)).toEqual([
      {
        kind: "reasoning",
        key: "node-1:0:official-reasoning",
        text: "官方思考",
        running: false,
        source: "official",
      },
      { kind: "content", key: "node-1:1:content", block: blocks[1] },
    ])
    expect(blocks).toEqual(before)
  })

  test("把文本开头的完整 think 标签拆成思考和回答", () => {
    const blocks = [{ kind: "text", text: "  <ThInK>先检查证据</tHiNk>\n最终回答" }] satisfies AssistantBlock[]
    expect(projectAssistantBlocks("node-2", blocks, false)).toEqual([
      {
        kind: "reasoning",
        key: "node-2:0:tagged-reasoning",
        text: "先检查证据",
        running: false,
        source: "think-tag",
      },
      {
        kind: "content",
        key: "node-2:0:tagged-answer",
        block: { kind: "text", text: "最终回答" },
      },
    ])
  })

  test("流式半截标签不会作为正文暴露", () => {
    expect(splitTaggedReasoning("<thi", true)).toEqual({ reasoning: "", answer: "", running: true })
    expect(splitTaggedReasoning("<think>分析中</thi", true)).toEqual({
      reasoning: "分析中",
      answer: "",
      running: true,
    })
    expect(splitTaggedReasoning("<think>分析中</think>回答", true)).toEqual({
      reasoning: "分析中",
      answer: "回答",
      running: false,
    })
  })

  test("完成时未闭合的 think 内容不会丢失", () => {
    expect(splitTaggedReasoning("<think>仍然保留</thi", false)).toEqual({
      reasoning: "仍然保留</thi",
      answer: "",
      running: false,
    })
    expect(splitTaggedReasoning("<thi", false)).toBeUndefined()
  })

  test("回答中部和代码示例中的 think 保持普通文本", () => {
    const values = [
      "前言 <think>这是示例</think> 后文",
      "```xml\n<think>这是示例</think>\n```",
      "XML 示例：<think>literal</think>",
    ]
    for (const [index, value] of values.entries()) {
      const block = { kind: "text", text: value } satisfies AssistantBlock
      expect(projectAssistantBlocks(`node-${index + 3}`, [block], false)).toEqual([
        { kind: "content", key: `node-${index + 3}:0:content`, block },
      ])
    }
  })

  test("只检查第一个非空文本块并保持展示键稳定", () => {
    const empty = { kind: "text", text: "" } satisfies AssistantBlock
    const tagged = { kind: "text", text: "<think>分析" } satisfies AssistantBlock
    const later = { kind: "text", text: "<think>后续字面量</think>" } satisfies AssistantBlock
    expect(projectAssistantBlocks("node-6", [empty, tagged, later], true)).toEqual([
      { kind: "content", key: "node-6:0:content", block: empty },
      {
        kind: "reasoning",
        key: "node-6:1:tagged-reasoning",
        text: "分析",
        running: true,
        source: "think-tag",
      },
      { kind: "content", key: "node-6:2:content", block: later },
    ])
  })
})
