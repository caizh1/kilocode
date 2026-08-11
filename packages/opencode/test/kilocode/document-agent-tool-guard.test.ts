import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { DocumentAgentScope } from "../../src/kilocode/document-agent/scope"
import { LLMAISDK } from "../../src/session/llm/ai-sdk"
import { documentAgentHistory } from "../../src/kilocode/document-agent/history"
import type { ModelMessage } from "ai"

type AdapterEvent = Parameters<typeof LLMAISDK.toLLMEvents>[1]

describe("Document Agent tool guard", () => {
  test("repairs an unavailable code tool to the document-only guard", () => {
    expect(
      DocumentAgentScope.repairUnavailableTool({
        agent: "document",
        toolName: "glob",
        available: new Set(["document_search", "document_scope"]),
      }),
    ).toEqual({
      toolName: "document_scope",
      input: JSON.stringify({ action: "document_only" }),
    })
  })

  test("does not change existing agents or available tools", () => {
    const available = new Set(["document_search", "document_scope"])

    expect(DocumentAgentScope.repairUnavailableTool({ agent: "code", toolName: "glob", available })).toBeUndefined()
    expect(
      DocumentAgentScope.repairUnavailableTool({ agent: "document", toolName: "document_search", available }),
    ).toBeUndefined()
  })

  test("hides an unavailable streamed preview and emits only the repaired tool", async () => {
    const state = LLMAISDK.adapterState(["document_search", "document_scope"])
    const adapt = (event: AdapterEvent) => Effect.runPromise(LLMAISDK.toLLMEvents(state, event))

    expect(await adapt({ type: "tool-input-start", id: "call-1", toolName: "glob" })).toEqual([])
    expect(await adapt({ type: "tool-input-delta", id: "call-1", delta: '{"pattern":"**/*.ts"}' })).toEqual([])
    expect(await adapt({ type: "tool-input-end", id: "call-1" })).toEqual([])

    const repaired = await adapt({
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "document_scope",
      input: { action: "document_only" },
    })
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({ type: "tool-call", name: "document_scope" })
  })

  test("keeps runtime-only repair tools hidden until their validated call", async () => {
    const state = LLMAISDK.adapterState(["bash"], ["bash", "invalid"])
    const adapt = (event: AdapterEvent) => Effect.runPromise(LLMAISDK.toLLMEvents(state, event))

    expect(await adapt({ type: "tool-input-start", id: "call-2", toolName: "invalid" })).toEqual([])
    const repaired = await adapt({
      type: "tool-call",
      toolCallId: "call-2",
      toolName: "invalid",
      input: { tool: "read", error: "malformed" },
    })
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({ type: "tool-call", name: "invalid" })
  })

  test("removes unavailable code and invalid calls from reused session history", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "先前的代码问题" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "旧回答" },
          { type: "tool-call", toolCallId: "call-glob", toolName: "glob", input: { pattern: "**/*.ts" } },
          { type: "tool-call", toolCallId: "call-doc", toolName: "document_search", input: { query: "规范" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-glob",
            toolName: "glob",
            output: { type: "text", value: "src/index.ts" },
          },
          {
            type: "tool-result",
            toolCallId: "call-doc",
            toolName: "document_search",
            output: { type: "text", value: "文档结果" },
          },
        ],
      },
    ]

    const result = documentAgentHistory(messages, new Set(["document_search", "document_scope"]))
    expect(JSON.stringify(result)).not.toContain('"toolName":"glob"')
    expect(JSON.stringify(result)).toContain('"toolName":"document_search"')
    expect(JSON.stringify(result)).toContain("旧回答")
  })
})
