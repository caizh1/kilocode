import { describe, expect, test } from "bun:test"
import type { SessionSummary } from "@deepseek-ai/dsh-client-runtime/client"
import { projectDeepSeekHarnessHeader } from "../../webview-ui/src/context/deepseek-harness-header"

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "official-session" as never,
    displayTitle: "官方显示标题",
    running: false,
    blank: false,
    updatedAt: 1,
    ...overrides,
  }
}

describe("ChipMate DeepSeek Harness 会话标题隔离", () => {
  test("优先显示官方持久标题", () => {
    expect(projectDeepSeekHarnessHeader("official-session", summary({ title: "官方持久标题" }))).toEqual({
      sessionId: "official-session",
      title: "官方持久标题",
      loading: false,
    })
  })

  test("没有持久标题时使用官方 displayTitle", () => {
    expect(projectDeepSeekHarnessHeader("official-session", summary())).toEqual({
      sessionId: "official-session",
      title: "官方显示标题",
      loading: false,
    })
  })

  test("目标 Session 改变后不会复用旧标题", () => {
    const previous = projectDeepSeekHarnessHeader("official-session", summary({ title: "旧官方标题" }))
    expect(projectDeepSeekHarnessHeader("next-session", undefined, previous)).toEqual({
      sessionId: "next-session",
      loading: true,
    })
  })

  test("同一 Session 重连的瞬时列表缺口保留官方标题", () => {
    const previous = projectDeepSeekHarnessHeader("official-session", summary({ title: "重连前标题" }))
    expect(projectDeepSeekHarnessHeader("official-session", undefined, previous)).toEqual(previous)
  })

  test("官方标题为空时交给展示层使用中性未命名文案", () => {
    expect(
      projectDeepSeekHarnessHeader("official-session", summary({ title: " ", displayTitle: "" })),
    ).toEqual({ sessionId: "official-session", loading: false })
  })
})
