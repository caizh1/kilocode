import { describe, expect, test } from "bun:test"
import {
  EMBEDDED_REVIEW_CASES,
  b0Prompt,
  scoreBenchmark,
  scoreBenchmarkModes,
  type BenchmarkObservation,
} from "../../src/chipmate/embedded-review/benchmark"
import { logicProfiles } from "../../src/chipmate/embedded-review/risks"
import type { LogicCategory } from "../../src/chipmate/embedded-review/types"
import { reviewCommand } from "../../src/chipmate/review/command"

const categories: LogicCategory[] = [
  "CONTROL_CONTRACT",
  "MEMORY_SECURITY",
  "REALTIME_CONCURRENCY",
  "RESOURCE_LIFECYCLE",
  "UPDATE_PERSISTENCE",
]

describe("嵌入式审查固定基准", () => {
  test("包含 112 组 C/C++ 缺陷与干净对照", () => {
    expect(EMBEDDED_REVIEW_CASES).toHaveLength(224)
    const pairs = Map.groupBy(EMBEDDED_REVIEW_CASES, (item) => item.pair)
    expect(pairs.size).toBe(112)
    for (const cases of pairs.values()) {
      expect(cases).toHaveLength(2)
      expect(cases.some((item) => item.expected.track === "CLEAN")).toBe(true)
      expect(cases.some((item) => item.expected.track !== "CLEAN")).toBe(true)
    }
    for (const category of categories) {
      const cases = EMBEDDED_REVIEW_CASES.filter(
        (item) => item.expected.track === "LOGIC" && item.expected.category === category,
      )
      expect(cases).toHaveLength(20)
    }
  })

  test("按发布门槛统计完美观测集", () => {
    const observations: BenchmarkObservation[] = EMBEDDED_REVIEW_CASES.map((item) => ({
      id: item.id,
      findings:
        item.expected.track === "CLEAN"
          ? []
          : [
              {
                track: item.expected.track,
                ...(item.expected.track === "STANDARD" ? { ruleId: item.expected.ruleId } : {}),
                ...(item.expected.track === "LOGIC"
                  ? { category: item.expected.category, severity: item.expected.severity }
                  : {}),
                evidenceValid: true,
              },
            ],
    }))
    expect(scoreBenchmark(observations)).toEqual({
      caseCount: 224,
      defectRecall: 1,
      logicRecall: 1,
      categoryRecall: {
        CONTROL_CONTRACT: 1,
        MEMORY_SECURITY: 1,
        REALTIME_CONCURRENCY: 1,
        RESOURCE_LIFECYCLE: 1,
        UPDATE_PERSISTENCE: 1,
      },
      findingPrecision: 1,
      cleanFalsePositiveRate: 0,
      blockerEvidenceValidity: 1,
    })
    expect(scoreBenchmarkModes(observations.map((item) => ({ ...item, mode: "runtime" })))).toHaveProperty(
      "runtime.caseCount",
      224,
    )
  })

  test("从当前通用审查提示词生成 B0，且不发布额外命令", async () => {
    const prompt = b0Prompt(await reviewCommand().template)
    expect(prompt).toContain("The following six tracks")
    expect(prompt).not.toContain("- code style")
    expect(prompt).not.toContain("- formatting")
  })

  test("把证据有效但结论错误的 finding 计入精确率失败", () => {
    const item = EMBEDDED_REVIEW_CASES.find((candidate) => candidate.expected.track === "STANDARD")
    expect(item).toBeDefined()
    const scores = scoreBenchmark([
      {
        id: item!.id,
        findings: [{ track: "STANDARD", ruleId: "C-999", evidenceValid: true }],
      },
    ])
    expect(scores.findingPrecision).toBe(0)
  })

  test("错误逻辑类别不能命中基准答案", () => {
    const item = EMBEDDED_REVIEW_CASES.find(
      (candidate) => candidate.expected.track === "LOGIC" && candidate.expected.category === "MEMORY_SECURITY",
    )
    expect(item).toBeDefined()
    const scores = scoreBenchmark([
      {
        id: item!.id,
        findings: [
          {
            track: "LOGIC",
            category: "CONTROL_CONTRACT",
            severity: "P1",
            evidenceValid: true,
          },
        ],
      },
    ])
    expect(scores.logicRecall).toBeLessThan(1)
    expect(scores.findingPrecision).toBe(0)
  })

  test("确定性路由覆盖全部逻辑正反样本且每包最多选择两类", () => {
    const pairs = Map.groupBy(EMBEDDED_REVIEW_CASES, (item) => item.pair)
    for (const cases of pairs.values()) {
      const defect = cases.find((item) => item.expected.track === "LOGIC")
      if (!defect || defect.expected.track !== "LOGIC") continue
      for (const item of cases) {
        const profiles = logicProfiles({ source: item.source })
        expect(profiles.length).toBeLessThanOrEqual(2)
        expect(profiles.map((profile) => profile.category)).toContain(defect.expected.category)
      }
    }
  })

  test("普通 update 函数名不会误选固件升级与持久化类别", () => {
    const profiles = logicProfiles({ source: "int update(void) { return device_read(); }" })
    expect(profiles.map((profile) => profile.category)).not.toContain("UPDATE_PERSISTENCE")
  })
})
