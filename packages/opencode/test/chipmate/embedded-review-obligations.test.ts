import { describe, expect, test } from "bun:test"
import { packets } from "../../src/chipmate/embedded-review/context"
import { catalog, derive } from "../../src/chipmate/embedded-review/obligations"
import { EmbeddedReviewRuntime } from "../../src/chipmate/embedded-review/runtime"
import type { ChangeFile, EmbeddedReviewPreparation } from "../../src/chipmate/embedded-review/types"

describe("通用数值义务", () => {
  test("窄类型乘法在外层转换为宽类型时生成候选", () => {
    const source = ["uint64_t expand_count(uint32_t count)", "{", "    return (uint64_t)(count * 512U);", "}", ""].join(
      "\n",
    )
    const result = analyze("scale.c", source)
    expect(result).toMatchObject([
      {
        kind: "INTEGER_PROMOTION",
        category: "CONTROL_CONTRACT",
        path: "scale.c",
        line: 3,
        expression: "count * 512U",
      },
    ])
    expect(result[0]?.counterexample).toContain("UINT32_MAX / 512U + 1")
  })

  test("在乘法前提升任一操作数后不生成候选", () => {
    const source = ["uint64_t expand_count(uint32_t count)", "{", "    return (uint64_t)count * 512U;", "}", ""].join(
      "\n",
    )
    expect(analyze("scale.c", source)).toHaveLength(0)
  })

  test("存在同粒度上界保护时不生成候选", () => {
    const source = [
      "uint64_t expand_count(uint32_t count)",
      "{",
      "    if(count > (UINT32_MAX / 512U))",
      "        return 0U;",
      "    return (uint64_t)(count * 512U);",
      "}",
      "",
    ].join("\n")
    expect(analyze("scale.c", source)).toHaveLength(0)
  })

  test("跨文件常量进入事实账本且不依赖业务命名", () => {
    const header = changed("clock_limits.h", "#define RATE_PER_UNIT 400U\n")
    const source = [
      "unsigned long long convert_units(unsigned int units)",
      "{",
      "    return (unsigned long long)(units * RATE_PER_UNIT);",
      "}",
      "",
    ].join("\n")
    const file = changed("converter.c", source)
    const facts = catalog([header, file])
    const result = derive({
      path: file.path,
      source,
      signature: "unsigned long long convert_units(unsigned int units)",
      start: 1,
      end: 4,
      changed: file.changedLines,
      catalog: facts,
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.facts).toContain("clock_limits.h:1 RATE_PER_UNIT = 400U。")
    expect(result[0]?.counterexample).toContain("UINT_MAX / RATE_PER_UNIT + 1")
  })

  test("宽变量接收窄乘法结果时同样生成候选", () => {
    const source = [
      "uint64_t area(uint32_t width, uint32_t height)",
      "{",
      "    uint64_t result;",
      "    result = width * height;",
      "    return result;",
      "}",
      "",
    ].join("\n")
    expect(analyze("geometry.c", source)).toMatchObject([
      {
        kind: "INTEGER_PROMOTION",
        path: "geometry.c",
        line: 4,
        expression: "width * height",
      },
    ])
  })

  test("只执行无关动作的安全分支不能冒充乘法保护", () => {
    const source = [
      "uint64_t expand_count(uint32_t count)",
      "{",
      "    if(count <= (UINT32_MAX / 512U))",
      "        trace_safe_value();",
      "    return (uint64_t)(count * 512U);",
      "}",
      "",
    ].join("\n")
    expect(analyze("scale.c", source)).toHaveLength(1)
  })

  test("常量乘法不因目标类型更宽而产生噪声", () => {
    const source = ["uint64_t fixed_size(void)", "{", "    return (uint64_t)(2U * 3U);", "}", ""].join("\n")
    expect(analyze("fixed.c", source)).toHaveLength(0)
  })

  test("危险表达式不在 changed line 时不扩大审查范围", () => {
    const source = ["uint64_t expand_count(uint32_t count)", "{", "    return (uint64_t)(count * 512U);", "}", ""].join(
      "\n",
    )
    const file = changed("scale.c", source)
    expect(
      derive({
        path: file.path,
        source,
        signature: "uint64_t expand_count(uint32_t count)",
        start: 1,
        end: 4,
        changed: [1],
        catalog: catalog([file]),
      }),
    ).toHaveLength(0)
  })
})

describe("通用累计容量义务", () => {
  test("单段检查不能证明循环累计写入边界", () => {
    const source = [
      "int collect_parts(PART *parts, unsigned int count)",
      "{",
      "    unsigned int cursor;",
      "    unsigned int index;",
      "    cursor = 0U;",
      "    for(index = 0U; index < count; index++)",
      "    {",
      "        if(parts[index].bytes > FRAME_CAPACITY)",
      "            return -1;",
      "        copy_bytes(frame + cursor, parts[index].data, parts[index].bytes);",
      "        cursor += parts[index].bytes;",
      "    }",
      "    return 0;",
      "}",
      "",
    ].join("\n")
    const result = analyze("collector.c", source)
    expect(result).toMatchObject([
      {
        kind: "CUMULATIVE_CAPACITY",
        category: "MEMORY_SECURITY",
        path: "collector.c",
        line: 8,
        expression: "cursor + parts[index].bytes <= FRAME_CAPACITY",
      },
    ])
    expect(result[0]?.counterexample).toContain("循环至少执行两次")
  })

  test.each([
    "if(parts[index].bytes > (FRAME_CAPACITY - cursor))",
    "if((cursor + parts[index].bytes) > FRAME_CAPACITY)",
  ])("累计保护 %s 能关闭义务", (guard) => {
    const source = [
      "int collect_parts(PART *parts, unsigned int count)",
      "{",
      "    unsigned int cursor;",
      "    unsigned int index;",
      "    cursor = 0U;",
      "    for(index = 0U; index < count; index++)",
      "    {",
      `        ${guard}`,
      "            return -1;",
      "        copy_bytes(frame + cursor, parts[index].data, parts[index].bytes);",
      "        cursor += parts[index].bytes;",
      "    }",
      "    return 0;",
      "}",
      "",
    ].join("\n")
    expect(analyze("collector.c", source)).toHaveLength(0)
  })

  test("没有内存或设备写入汇点的普通累计值不生成容量候选", () => {
    const source = [
      "unsigned int sum_parts(PART *parts, unsigned int count)",
      "{",
      "    unsigned int total;",
      "    unsigned int index;",
      "    total = 0U;",
      "    for(index = 0U; index < count; index++)",
      "    {",
      "        if(parts[index].bytes > FRAME_CAPACITY)",
      "            return 0U;",
      "        total += parts[index].bytes;",
      "    }",
      "    return total;",
      "}",
      "",
    ].join("\n")
    expect(analyze("stats.c", source)).toHaveLength(0)
  })

  test("编译期只能执行一次的循环不生成累计反例", () => {
    const source = [
      "int collect_once(PART *parts)",
      "{",
      "    unsigned int cursor;",
      "    unsigned int index;",
      "    cursor = 0U;",
      "    for(index = 0U; index < 1U; index++)",
      "    {",
      "        if(parts[index].bytes > FRAME_CAPACITY)",
      "            return -1;",
      "        copy_bytes(frame + cursor, parts[index].data, parts[index].bytes);",
      "        cursor += parts[index].bytes;",
      "    }",
      "    return 0;",
      "}",
      "",
    ].join("\n")
    expect(analyze("single.c", source)).toHaveLength(0)
  })

  test("每轮写入前重置偏移时不生成累计反例", () => {
    const source = [
      "int copy_independent(PART *parts, unsigned int count)",
      "{",
      "    unsigned int offset;",
      "    unsigned int index;",
      "    offset = 0U;",
      "    for(index = 0U; index < count; index++)",
      "    {",
      "        offset = 0U;",
      "        if(parts[index].bytes > FRAME_CAPACITY)",
      "            return -1;",
      "        copy_bytes(frame + offset, parts[index].data, parts[index].bytes);",
      "        offset += parts[index].bytes;",
      "    }",
      "    return 0;",
      "}",
      "",
    ].join("\n")
    expect(analyze("independent.c", source)).toHaveLength(0)
  })

  test("只记录累计越界但不退出的条件不能关闭义务", () => {
    const source = [
      "int collect_parts(PART *parts, unsigned int count)",
      "{",
      "    unsigned int cursor;",
      "    unsigned int index;",
      "    cursor = 0U;",
      "    for(index = 0U; index < count; index++)",
      "    {",
      "        if(parts[index].bytes > FRAME_CAPACITY)",
      "            return -1;",
      "        if((cursor + parts[index].bytes) > FRAME_CAPACITY)",
      "            trace_overflow();",
      "        copy_bytes(frame + cursor, parts[index].data, parts[index].bytes);",
      "        cursor += parts[index].bytes;",
      "    }",
      "    return 0;",
      "}",
      "",
    ].join("\n")
    expect(analyze("logging.c", source)).toHaveLength(1)
  })
})

describe("义务与 Runtime 集成", () => {
  test("证据包携带义务并把 finding 固定到实际表达式", () => {
    const source = ["uint64_t expand_count(uint32_t count)", "{", "    return (uint64_t)(count * 512U);", "}", ""].join(
      "\n",
    )
    const file = changed("scale.c", source)
    const reviewPackets = packets([file], [])
    const obligation = reviewPackets[0]?.obligations[0]
    expect(obligation).toMatchObject({
      kind: "INTEGER_PROMOTION",
      path: "scale.c",
      line: 3,
    })
    if (!obligation) throw new Error("测试必须生成义务")
    const preparation: EmbeddedReviewPreparation = {
      schemaVersion: 1,
      changes: {
        schemaVersion: 1,
        scope: { kind: "uncommitted" },
        root: "/tmp/embedded-obligations",
        files: [file],
        skipped: [],
        generatedAt: "2026-07-28T00:00:00.000Z",
        limits: {
          maxFiles: 1,
          maxHunks: 1,
          maxFileBytes: 4096,
          maxEvidenceBytes: 4096,
        },
      },
      standard: {
        mechanicalStatus: "NOT_EVALUATED",
        findings: [],
        reason: "测试未固定 RulePack。",
        evaluatedRuleIds: [],
        semanticRuleIds: [],
      },
      packets: reviewPackets,
      warnings: [],
    }
    EmbeddedReviewRuntime.remember("generic-obligation", preparation)
    EmbeddedReviewRuntime.next("generic-obligation", { action: "start", packet: 0 })
    EmbeddedReviewRuntime.next("generic-obligation", {
      action: "submit",
      packet: 1,
      submission: {
        standardFindings: [],
        logicFindings: [
          {
            obligationId: obligation.id,
            category: "MEMORY_SECURITY",
            severity: "P1",
            path: "wrong.c",
            line: 999,
            trigger: "调用方允许 count 超过安全上界。",
            pathEvidence: ["scale.c:1 返回接口承诺 64 位结果", "scale.c:3 乘法在 32 位操作数域中完成"],
            causalChain: ["输入超过安全上界", "乘法先截断", "宽类型结果携带错误值"],
            impact: "错误长度进入持久化写入路径并破坏数据完整性。",
            protectionCounterevidence: "证据路径没有输入上界、饱和运算或运算前类型提升。",
          },
        ],
        obligationReviews: [
          {
            obligationId: obligation.id,
            disposition: "CONFIRMED",
            reason: "调用范围能够越过安全上界，且不存在运算前提升。",
            evidence: ["scale.c:3 乘法表达式"],
          },
        ],
        unverifiedRisks: [],
        nonBlockingFindings: [],
      },
    })
    const sealed = EmbeddedReviewRuntime.seal("generic-obligation", "{}")
    expect(sealed?.logic).toMatchObject([
      {
        obligationId: obligation.id,
        category: "CONTROL_CONTRACT",
        path: "scale.c",
        line: 3,
      },
    ])

    EmbeddedReviewRuntime.remember("unknown-obligation", preparation)
    EmbeddedReviewRuntime.next("unknown-obligation", { action: "start", packet: 0 })
    EmbeddedReviewRuntime.next("unknown-obligation", {
      action: "submit",
      packet: 1,
      submission: {
        standardFindings: [],
        logicFindings: [
          {
            obligationId: "not-issued-by-runtime",
            category: "CONTROL_CONTRACT",
            severity: "P1",
            path: "scale.c",
            line: 3,
            trigger: "模型伪造义务 ID。",
            pathEvidence: ["scale.c:1 返回接口", "scale.c:3 乘法表达式"],
            causalChain: ["伪造候选", "不得进入结果"],
            impact: "无效候选不得阻塞。",
            protectionCounterevidence: "无。",
          },
        ],
        obligationReviews: [
          {
            obligationId: "not-issued-by-runtime",
            disposition: "CONFIRMED",
            reason: "伪造处置。",
            evidence: ["scale.c:3 乘法表达式"],
          },
        ],
        unverifiedRisks: [],
        nonBlockingFindings: [],
      },
    })
    const unknown = EmbeddedReviewRuntime.seal("unknown-obligation", "{}")
    expect(unknown?.verdict).toBe("PASS")
    expect(unknown?.text).toContain("未被模型提交处置")

    const refutedSource = [
      "static uint64_t expand_fixed(uint32_t count)",
      "{",
      "    return (uint64_t)(count * 512U);",
      "}",
      "",
      "int use_fixed_count(void)",
      "{",
      "    return (int)expand_fixed(1U);",
      "}",
      "",
    ].join("\n")
    const refutedFile = changed("bounded.c", refutedSource)
    const refutedPackets = packets([refutedFile], [])
    const refutedObligation = refutedPackets.flatMap((packet) => packet.obligations)[0]
    expect(refutedObligation).toMatchObject({
      kind: "INTEGER_PROMOTION",
      path: "bounded.c",
      line: 3,
    })
    if (!refutedObligation) throw new Error("测试必须生成可反证义务")
    const refutedPreparation: EmbeddedReviewPreparation = {
      ...preparation,
      changes: {
        ...preparation.changes,
        files: [refutedFile],
      },
      packets: refutedPackets,
    }
    EmbeddedReviewRuntime.remember("refuted-obligation", refutedPreparation)
    EmbeddedReviewRuntime.next("refuted-obligation", { action: "start", packet: 0 })
    EmbeddedReviewRuntime.next("refuted-obligation", {
      action: "submit",
      packet: 1,
      submission: {
        standardFindings: [],
        logicFindings: [
          {
            obligationId: refutedObligation.id,
            category: "CONTROL_CONTRACT",
            severity: "P1",
            path: "bounded.c",
            line: 3,
            trigger: "模型同时提交了已被调用范围反证的候选。",
            pathEvidence: ["bounded.c:1 函数为 static", "bounded.c:8 唯一调用方固定传入 1U"],
            causalChain: ["固定输入 1U", "乘积为 512", "不会溢出"],
            impact: "该候选不应形成阻塞结论。",
            protectionCounterevidence: "唯一调用方的常量实参构成决定性反证。",
          },
        ],
        obligationReviews: [
          {
            obligationId: refutedObligation.id,
            disposition: "REFUTED",
            reason: "函数为文件内静态函数，唯一调用方固定传入 1U，乘积不会越过无符号 32 位上界。",
            evidence: ["bounded.c:1 函数为 static", "bounded.c:8 唯一调用方固定传入 1U"],
          },
        ],
        unverifiedRisks: [],
        nonBlockingFindings: [],
      },
    })
    const refuted = EmbeddedReviewRuntime.seal("refuted-obligation", "{}")
    expect(refuted?.verdict).toBe("PASS")
    expect(refuted?.logic).toHaveLength(0)
    expect(refuted?.text).not.toContain(`通用义务 ${refutedObligation.id}`)

    EmbeddedReviewRuntime.remember("duplicate-obligation", refutedPreparation)
    EmbeddedReviewRuntime.next("duplicate-obligation", { action: "start", packet: 0 })
    EmbeddedReviewRuntime.next("duplicate-obligation", {
      action: "submit",
      packet: 1,
      submission: {
        standardFindings: [],
        logicFindings: [],
        obligationReviews: [
          {
            obligationId: refutedObligation.id,
            disposition: "REFUTED",
            reason: "唯一调用方固定传入 1U。",
            evidence: ["bounded.c:8 唯一调用方固定传入 1U"],
          },
          {
            obligationId: refutedObligation.id,
            disposition: "UNVERIFIED",
            reason: "重复处置不得覆盖上一项。",
            evidence: ["bounded.c:3 乘法表达式"],
          },
        ],
        unverifiedRisks: [],
        nonBlockingFindings: [],
      },
    })
    const duplicate = EmbeddedReviewRuntime.seal("duplicate-obligation", "{}")
    expect(duplicate?.verdict).toBe("PASS")
    expect(duplicate?.text).toContain("被重复处置")
  })
})

function analyze(path: string, source: string) {
  const file = changed(path, source)
  const signature = /^([^{]+)\{/s.exec(source)?.[1]?.trim() ?? ""
  return derive({
    path,
    source,
    signature,
    start: 1,
    end: source.trimEnd().split("\n").length,
    changed: file.changedLines,
    catalog: catalog([file]),
  })
}

function changed(path: string, after: string): ChangeFile {
  const rows = after.trimEnd().split(/\r?\n/)
  return {
    path,
    status: "modified",
    before: "",
    after,
    patch: "",
    hunks: [
      {
        header: `@@ -0,0 +1,${rows.length} @@`,
        oldStart: 0,
        oldCount: 0,
        nextStart: 1,
        nextCount: rows.length,
        lines: rows.map((row) => `+${row}`),
        changed: rows.map((_, index) => ({ next: index + 1 })),
      },
    ],
    changedLines: rows.map((_, index) => index + 1),
  }
}
