import { describe, expect, test } from "bun:test"
import { EmbeddedReviewThinRuntime } from "../../src/kilocode/embedded-review/thin-runtime"
import type { ThinPreparation } from "../../src/kilocode/embedded-review/thin-runtime"

function preparation(): ThinPreparation {
  const patch = [
    "diff --git a/driver.c b/driver.c",
    "--- a/driver.c",
    "+++ b/driver.c",
    "@@ -1,2 +1,2 @@",
    "-unsigned int end = start + count;",
    "+unsigned int end = start + count + 1U;",
    " return end;",
  ].join("\n")
  return {
    schemaVersion: 1,
    changes: {
      schemaVersion: 1,
      scope: { kind: "uncommitted" },
      root: "/tmp/embedded-review-thin",
      files: [
        {
          path: "driver.c",
          status: "modified",
          before: "unsigned int end = start + count;\nreturn end;\n",
          after: "unsigned int end = start + count + 1U;\nreturn end;\n",
          patch,
          hunks: [],
          changedLines: [1],
        },
      ],
      skipped: [],
      generatedAt: "2026-07-28T00:00:00.000Z",
      limits: {
        maxFiles: 40,
        maxHunks: 80,
        maxFileBytes: 1024 * 1024,
        maxEvidenceBytes: 5 * 1024 * 1024,
      },
    },
    standard: {
      mechanicalStatus: "NOT_EVALUATED",
      findings: [],
      evaluatedRuleIds: [],
      unsupportedRuleIds: [],
      semanticRuleIds: [],
    },
    warnings: [],
  }
}

describe("Embedded Review 薄 Runtime", () => {
  test("一次性提供原始 diff 且不生成风险分类和证据包", () => {
    const prompt = EmbeddedReviewThinRuntime.prompt(preparation())
    const serialized = JSON.stringify(prompt)
    expect(prompt.mode).toBe("thin")
    expect(serialized).toContain("start + count + 1U")
    expect(serialized).not.toContain("logicProfiles")
    expect(serialized).not.toContain("logicHints")
    expect(serialized).not.toContain("obligations")
    expect(serialized).not.toContain("packets")
  })

  test("不依赖预选类别接受支持范围内且证据完整的 blocker", () => {
    EmbeddedReviewThinRuntime.remember("thin-valid", preparation())
    const result = EmbeddedReviewThinRuntime.submit("thin-valid", {
      findings: [
        {
          category: "INTEGER_BOUNDARY",
          severity: "P1",
          path: "driver.c",
          line: 1,
          trigger: "start 接近 UINT_MAX 且 count 大于零。",
          pathEvidence: ["driver.c:1 加法在 unsigned int 中执行", "driver.c:2 返回已经回绕的 end"],
          causalChain: ["start 与 count 相加回绕", "调用方获得缩小后的 end"],
          impact: "边界校验被绕过并访问错误范围。",
          protectionCounterevidence: "表达式前没有提升、饱和或上界保护。",
        },
      ],
    })
    expect(result).toMatchObject({ complete: true, received: 1 })
    const sealed = EmbeddedReviewThinRuntime.seal("thin-valid", "{}")
    expect(sealed?.verdict).toBe("FAIL")
    expect(sealed?.logic).toHaveLength(1)
    expect(sealed?.text).toContain("REVIEW_MODE: THIN")
    expect(sealed?.text).toContain("INTEGER_BOUNDARY")
  })

  test("无效位置不会静默丢弃而是显示拒绝原因", () => {
    EmbeddedReviewThinRuntime.remember("thin-invalid", preparation())
    EmbeddedReviewThinRuntime.submit("thin-invalid", {
      findings: [
        {
          category: "CONDITION_USE",
          severity: "P1",
          path: "driver.c",
          line: 2,
          trigger: "条件与使用值矛盾。",
          pathEvidence: ["driver.c:1 计算 end", "driver.c:2 返回 end"],
          causalChain: ["检查旧值", "使用新值"],
          impact: "范围检查失效。",
          protectionCounterevidence: "没有同粒度保护。",
        },
      ],
    })
    const sealed = EmbeddedReviewThinRuntime.seal("thin-invalid", "{}")
    expect(sealed?.verdict).toBe("PASS")
    expect(sealed?.rejected).toHaveLength(1)
    expect(sealed?.text).toContain("位置不是本次变更后的 changed line")
  })

  test("唯一短文件名和行号范围会归一化为仓库相对引用", () => {
    const prep = preparation()
    const file = prep.changes.files[0]
    if (!file) throw new Error("缺少测试文件")
    file.path = "src/main.c"
    file.after = "int start = 1;\nunsigned int end = start + count + 1U;\nreturn end;\n"
    file.changedLines = [2]
    EmbeddedReviewThinRuntime.remember("thin-short-path", prep)
    EmbeddedReviewThinRuntime.submit("thin-short-path", {
      findings: [
        {
          category: "INTEGER_BOUNDARY",
          severity: "P1",
          path: "main.c",
          line: 2,
          trigger: "输入触发边界回绕",
          pathEvidence: ["main.c:2-3 发生回绕", "main.c:3 进入危险路径"],
          causalChain: ["输入达到边界", "结果回绕", "写入越界"],
          impact: "破坏关键数据",
          protectionCounterevidence: "现有检查发生在回绕之后",
        },
      ],
    })
    const sealed = EmbeddedReviewThinRuntime.seal("thin-short-path", "{}")
    expect(sealed?.verdict).toBe("FAIL")
    expect(sealed?.logic[0]?.path).toBe("src/main.c")
    expect(sealed?.logic[0]?.pathEvidence[0]).toStartWith("src/main.c:2")
  })

  test("模型未提交时明确标记 LOGIC 未评估", () => {
    EmbeddedReviewThinRuntime.remember("thin-incomplete", preparation())
    const sealed = EmbeddedReviewThinRuntime.seal("thin-incomplete", "{}")
    expect(sealed?.submitted).toBe(false)
    expect(sealed?.text).toContain("LOGIC: NOT_EVALUATED")
    expect(sealed?.text).toContain("模型没有调用 embedded_review_submit")
  })
})
