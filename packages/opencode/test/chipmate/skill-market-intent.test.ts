import { describe, expect, test } from "bun:test"
import { SkillMarketIntent } from "../../src/chipmate/skill-market/intent"

function messages(text: string): Parameters<typeof SkillMarketIntent.filter>[1] {
  return [
    {
      info: { role: "user" },
      parts: [{ type: "text", text, synthetic: false, ignored: false }],
    },
  ] as unknown as Parameters<typeof SkillMarketIntent.filter>[1]
}

describe("SkillMarketIntent", () => {
  test.each([
    "Skill 是什么？",
    "解释 Skill 加载机制。",
    "如何设计一个 Skill Market？",
    "为什么这个 skill 没有触发？",
    "review this log: install skill failed",
    "普通代码为什么编译失败？",
  ])("keeps ordinary QA isolated: %s", (text) => {
    expect([...SkillMarketIntent.classify(text)]).toEqual([])
  })

  test("exposes only search for an explicit lookup", () => {
    expect([...SkillMarketIntent.classify("帮我在 Skill 市场找一下生成 Word 的工具")]).toEqual([
      "skill_market_search",
    ])
  })

  test("exposes search, install, and transaction for a combined request", () => {
    expect([...SkillMarketIntent.classify("帮我搜索相关 Skill，找到后安装")]).toEqual([
      "skill_market_search",
      "skill_market_install",
      "skill_transaction",
    ])
  })

  test("exposes create and publish inside one transaction", () => {
    expect([...SkillMarketIntent.classify("请创建一个 Skill 并发布到市场")]).toEqual([
      "skill_create",
      "skill_transaction",
      "skill_market_publish",
    ])
  })

  test("allows a contextual follow-up without repeating Skill", () => {
    expect([...SkillMarketIntent.classify("安装第一个", true)]).toEqual([
      "skill_market_install",
      "skill_transaction",
    ])
  })

  test("filters the provider schema before an ordinary QA model step", () => {
    const items = [
      { id: "read" },
      { id: "grep" },
      { id: "skill_market_search" },
      { id: "skill_market_install" },
      { id: "skill_create" },
      { id: "skill_market_publish" },
      { id: "skill_transaction" },
    ]
    expect(SkillMarketIntent.filter(items, messages("解释 Skill 加载机制。"))).toEqual([
      { id: "read" },
      { id: "grep" },
    ])
  })

  test("does not admit a hidden write tool without matching intent", () => {
    expect(SkillMarketIntent.allows("skill_market_install", messages("帮我在 Skill 市场找一个 Word Skill"))).toBe(
      false,
    )
  })

  test("does not carry market visibility into a later code review", () => {
    const history = [
      ...messages("帮我在 Skill 市场找一个 C++ Skill"),
      {
        info: { role: "assistant" },
        parts: [{ type: "tool", tool: "skill_market_search" }],
      },
      ...messages("帮我看看这段代码里的 install skill 函数"),
    ] as unknown as Parameters<typeof SkillMarketIntent.filter>[1]
    expect([...SkillMarketIntent.visible(history)]).toEqual([])
  })
})
