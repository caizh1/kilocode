import { describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { Process } from "../../src/util/process"
import { loadChangeSet, parseHunks } from "../../src/chipmate/embedded-review/change-set"
import { embeddedReviewCommand } from "../../src/chipmate/embedded-review/command"
import { packets } from "../../src/chipmate/embedded-review/context"
import { logicHints } from "../../src/chipmate/embedded-review/hints"
import { runMechanical } from "../../src/chipmate/embedded-review/mechanical"
import { logicProfiles } from "../../src/chipmate/embedded-review/risks"
import { EmbeddedReviewRuntime } from "../../src/chipmate/embedded-review/runtime"
import { requestedScope } from "../../src/chipmate/embedded-review/scope"
import type { ChangeFile, EmbeddedReviewPreparation, RulePack } from "../../src/chipmate/embedded-review/types"

describe("嵌入式审查范围", () => {
  test("只接受未提交变更或一个十六进制 commit", () => {
    expect(requestedScope("")).toEqual({ kind: "uncommitted" })
    expect(requestedScope("uncommitted")).toEqual({ kind: "uncommitted" })
    expect(requestedScope("deadbeef")).toEqual({ kind: "commit", requested: "deadbeef" })
    expect(() => requestedScope("branch main")).toThrow(/不支持|只接受/)
    expect(() => requestedScope("origin/main")).toThrow(/不支持/)
    expect(() => requestedScope("-p")).toThrow(/不支持/)
  })

  test("注册范围受限的只读命令提示词", async () => {
    const cmd = embeddedReviewCommand()
    const template = await cmd.template
    expect(cmd.name).toBe("embedded-review")
    expect(template).toContain("禁止编辑文件")
    expect(template).toContain("$PREPARATION")
    expect(template).toContain("embedded_review_submit")
    expect(template).toContain("Read、Grep、Glob")
    expect(template).not.toContain("embedded_review_packet")
    expect(template).not.toContain("six tracks")
  })
})

describe("确定性变更加载", () => {
  test("从所选工作树加载暂存、未暂存、未跟踪和已删除的 C 文件", async () => {
    await using tmp = await tmpdir({ git: true })
    await Promise.all([
      Bun.write(path.join(tmp.path, "staged.c"), "int staged = 0;\n"),
      Bun.write(path.join(tmp.path, "unstaged.c"), "int unstaged = 0;\n"),
      Bun.write(path.join(tmp.path, "deleted.c"), "int deleted = 0;\n"),
    ])
    await git(tmp.path, ["add", "--", "staged.c", "unstaged.c", "deleted.c"])
    await git(tmp.path, ["commit", "-m", "fixture"])
    await Bun.write(path.join(tmp.path, "staged.c"), "int staged = 1;\n")
    await git(tmp.path, ["add", "--", "staged.c"])
    await Bun.write(path.join(tmp.path, "unstaged.c"), "int unstaged = 2;\n")
    await Bun.write(path.join(tmp.path, "new.h"), "#pragma once\n")
    await git(tmp.path, ["rm", "--", "deleted.c"])

    const changes = await loadChangeSet({ root: tmp.path, arguments: "uncommitted" })
    expect(
      changes.files.map((file) => [file.path, file.status]).sort((left, right) => left[0].localeCompare(right[0])),
    ).toEqual([
      ["deleted.c", "deleted"],
      ["new.h", "untracked"],
      ["staged.c", "modified"],
      ["unstaged.c", "modified"],
    ])
    expect(changes.files.find((file) => file.path === "staged.c")?.changedLines).toEqual([1])
    expect(changes.files.find((file) => file.path === "new.h")?.before).toBe("")
  })

  test("只加载一个普通 commit 并拒绝 merge commit", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "main.c"), "int value = 0;\n")
    await git(tmp.path, ["add", "--", "main.c"])
    await git(tmp.path, ["commit", "-m", "base"])
    await Bun.write(path.join(tmp.path, "main.c"), "int value = 1;\n")
    await git(tmp.path, ["commit", "-am", "change"])
    const commit = (await git(tmp.path, ["rev-parse", "HEAD"])).trim()
    const changes = await loadChangeSet({ root: tmp.path, arguments: commit })
    expect(changes.scope).toMatchObject({ kind: "commit", commit })
    expect(changes.files).toHaveLength(1)

    await git(tmp.path, ["checkout", "-b", "side", "HEAD~1"])
    await Bun.write(path.join(tmp.path, "side.c"), "int side = 1;\n")
    await git(tmp.path, ["add", "--", "side.c"])
    await git(tmp.path, ["commit", "-m", "side"])
    await git(tmp.path, ["checkout", "-"])
    await git(tmp.path, ["merge", "--no-ff", "side", "-m", "merge"])
    const merge = (await git(tmp.path, ["rev-parse", "HEAD"])).trim()
    const error = await loadChangeSet({ root: tmp.path, arguments: merge }).then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toMatch(/不支持 merge commit/)
  })

  test("不会读取其他仓库的变更", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    await Bun.write(path.join(first.path, "first.c"), "int first = 1;\n")
    await Bun.write(path.join(second.path, "second.c"), "int second = 1;\n")
    const changes = await loadChangeSet({ root: first.path, arguments: "uncommitted" })
    expect(changes.files.map((file) => file.path)).toEqual(["first.c"])
  })

  test("从统一 hunk 跟踪新增和删除行号", () => {
    const hunks = parseHunks(["@@ -1,2 +1,2 @@", "-old", "+new", " same"].join("\n"))
    expect(hunks[0]?.changed).toEqual([{ old: 1 }, { next: 1 }])
  })
})

describe("机械 RulePack 检查", () => {
  test.each([
    ["C-011", "} else\n", 1],
    ["C-011", "else\n", 0],
    ["C-014", "int value = 1; \n", 1],
    ["C-014", "int value = 1;\n", 0],
    ["C-015", "value=1;\n", 1],
    ["C-015", "value = 1;\n", 0],
    ["C-018", "value = array [index];\n", 1],
    ["C-018", "value = array[index];\n", 0],
    ["C-018", "if (ready)\n", 0],
    ["C-035", "if (ready) {\n", 1],
    ["C-035", "if (ready)\n{\n", 0],
    ["C-035", "int values[] = { 1, 2 };\n", 0],
    ["C-038", "int run(void);\n", 1],
    ["C-038", "#ifndef MOTOR_H\n#define MOTOR_H\n#endif\n", 0],
  ])("%s 只报告配对样本中的违规一侧", (id, source, count) => {
    const file = changedFile(id === "C-038" ? "motor.h" : "motor.c", source)
    expect(runMechanical([file], pack(id)).findings).toHaveLength(count)
  })

  test("存在未结构化例外的规则不得生成机械违规", () => {
    const rules = pack("C-014")
    rules.rules[0].exceptions = ["生成代码允许保留行尾空格"]
    const result = runMechanical([changedFile("motor.c", "int value = 1; \n")], rules)
    expect(result.findings).toHaveLength(0)
    expect(result.evaluatedRuleIds).toHaveLength(0)
    expect(result.unsupportedRuleIds).toEqual(["C-014"])
  })
})

describe("嵌入式审查 Runtime", () => {
  test("固定一个已发布 RulePack，服务不可用时仍保留逻辑证据包", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "motor.c"),
      [
        "void run(ctx_t *ctx)",
        "{",
        "    if (ctx != NULL) ",
        "    {",
        "        return;",
        "    }",
        "    ctx->ready = 1;",
        "}",
        "",
      ].join("\n"),
    )
    const state = { status: 200 }
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json(pack("C-014"), {
          status: state.status,
        }),
    })
    const endpoint = `http://127.0.0.1:${server.port}/api/v1/review-rule-packs/latest`
    try {
      const first = await EmbeddedReviewRuntime.prepare({
        root: tmp.path,
        arguments: "uncommitted",
        endpoint,
      })
      expect(first.rulePack?.version).toBe("1.0.0")
      expect(first.packets).toHaveLength(1)
      expect(JSON.stringify(EmbeddedReviewRuntime.prompt(first))).not.toContain("ctx->ready")
      EmbeddedReviewRuntime.remember("valid", first)
      const packet = EmbeddedReviewRuntime.next("valid", {
        action: "start",
        packet: 0,
      })
      expect(packet).toMatchObject({ complete: false, packet: 1, total: 1 })
      expect(JSON.stringify(packet)).toContain("ctx->ready")
      const completed = EmbeddedReviewRuntime.next("valid", {
        action: "submit",
        packet: 1,
        submission: {
          standardFindings: [],
          logicFindings: [
            {
              category: "MEMORY_SECURITY",
              severity: "P1",
              path: "motor.c",
              line: 3,
              trigger: "空指针上下文能够到达解引用。",
              pathEvidence: ["line 3: 空指针保护条件反向", "motor.c:7 指针解引用"],
              causalChain: ["空指针绕过提前返回", "ctx 随后被解引用"],
              impact: "可达的空指针解引用会导致固件崩溃。",
              protectionCounterevidence: "唯一保护条件已经反向，后续也没有空指针检查。",
            },
          ],
          obligationReviews: [],
          unverifiedRisks: [],
          nonBlockingFindings: [],
        },
      })
      expect(completed).toMatchObject({ complete: true, processed: 1, total: 1 })
      const sealed = EmbeddedReviewRuntime.seal("valid", "{}")
      expect(sealed?.verdict).toBe("FAIL")
      expect(sealed?.status).toBe("NON_COMPLIANT")
      expect(sealed?.text).toContain("::code-comment")

      EmbeddedReviewRuntime.remember("sequence", first)
      EmbeddedReviewRuntime.next("sequence", { action: "start", packet: 0 })
      const mismatch = EmbeddedReviewRuntime.next("sequence", {
        action: "submit",
        packet: 2,
        submission: empty(),
      })
      expect(mismatch).toMatchObject({ complete: false, error: expect.stringContaining("packet 1") })
      const accepted = EmbeddedReviewRuntime.next("sequence", {
        action: "submit",
        packet: 1,
        submission: empty(),
      })
      expect(accepted).toMatchObject({ complete: true, processed: 1 })
      EmbeddedReviewRuntime.discard("sequence")

      EmbeddedReviewRuntime.remember("invalid", first)
      EmbeddedReviewRuntime.next("invalid", { action: "start", packet: 0 })
      EmbeddedReviewRuntime.next("invalid", {
        action: "submit",
        packet: 1,
        submission: {
          standardFindings: [],
          logicFindings: [
            {
              category: "MEMORY_SECURITY",
              severity: "P1",
              path: "motor.c",
              line: 999,
              trigger: "位于 diff 之外",
              pathEvidence: ["位于 diff 之外"],
              causalChain: ["位于 diff 之外"],
              impact: "无效",
              protectionCounterevidence: "无效",
            },
          ],
          obligationReviews: [],
          unverifiedRisks: [],
          nonBlockingFindings: [],
        },
      })
      const invalid = EmbeddedReviewRuntime.seal("invalid", "{}")
      expect(invalid?.verdict).toBe("PASS")

      EmbeddedReviewRuntime.remember("wrong-category", first)
      EmbeddedReviewRuntime.next("wrong-category", { action: "start", packet: 0 })
      EmbeddedReviewRuntime.next("wrong-category", {
        action: "submit",
        packet: 1,
        submission: {
          standardFindings: [],
          logicFindings: [
            {
              category: "UPDATE_PERSISTENCE",
              severity: "P1",
              path: "motor.c",
              line: 3,
              trigger: "提交了证据包未选择的逻辑类别。",
              pathEvidence: ["motor.c:3 空指针保护条件反向", "motor.c:7 指针解引用"],
              causalChain: ["候选类别不在包内", "Runtime 必须丢弃"],
              impact: "无效候选不得影响审查结论。",
              protectionCounterevidence: "证据完整也不能越过类别门禁。",
            },
          ],
          obligationReviews: [],
          unverifiedRisks: [],
          nonBlockingFindings: [],
        },
      })
      const wrong = EmbeddedReviewRuntime.seal("wrong-category", "{}")
      expect(wrong?.verdict).toBe("PASS")
      expect(wrong?.logic).toHaveLength(0)

      state.status = 503
      const degraded = await EmbeddedReviewRuntime.prepare({
        root: tmp.path,
        arguments: "uncommitted",
        endpoint,
      })
      expect(degraded.standard.mechanicalStatus).toBe("NOT_EVALUATED")
      expect(degraded.packets).toHaveLength(1)
      expect(first.rulePack?.version).toBe("1.0.0")
    } finally {
      await server.stop(true)
    }
  })

  test("语义审查输出无效时不会宣称合规", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "clean.c"), "int run(void)\n{\n    return 0;\n}\n")
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json(pack("C-043", "semantic")),
    })
    try {
      const preparation = await EmbeddedReviewRuntime.prepare({
        root: tmp.path,
        arguments: "uncommitted",
        endpoint: `http://127.0.0.1:${server.port}/api/v1/review-rule-packs/latest`,
      })
      expect(preparation.standard.mechanicalStatus).toBe("COMPLIANT")
      EmbeddedReviewRuntime.remember("invalid-semantic", preparation)
      const sealed = EmbeddedReviewRuntime.seal("invalid-semantic", "not valid JSON")
      expect(sealed?.status).toBe("NOT_EVALUATED")
      expect(sealed?.verdict).toBe("PASS")
    } finally {
      await server.stop(true)
    }
  })

  test("接受跨文件范围证据并把并发问题锚定到消费者清空行", () => {
    const host = changedFile("host.c", "g_mailbox.pending = 1U;\n")
    const main = changedFile(
      "main.c",
      ["event.code = g_mailbox.code;", "g_mailbox.code = 0U;", "g_mailbox.pending = 0U;", ""].join("\n"),
    )
    const preparation: EmbeddedReviewPreparation = {
      schemaVersion: 1,
      changes: {
        schemaVersion: 1,
        scope: { kind: "uncommitted" },
        root: "/tmp/embedded-review",
        files: [host, main],
        skipped: [],
        generatedAt: "2026-07-28T00:00:00.000Z",
        limits: {
          maxFiles: 2,
          maxHunks: 2,
          maxFileBytes: 1024,
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
      packets: [
        {
          path: "host.c",
          hunk: "+g_mailbox.pending = 1U;",
          changedLines: [1],
          function: {
            name: "dev_irq_handler",
            signature: "void dev_irq_handler(void)",
            startLine: 1,
            endLine: 1,
            source: host.after,
            calls: [],
          },
          relatedFunctions: [
            {
              path: "main.c",
              name: "consume",
              signature: "void consume(void)",
              startLine: 1,
              endLine: 3,
              source: main.after,
              relation: "shared",
            },
          ],
          macros: [],
          types: [],
          rules: [],
          logicProfiles: [
            {
              category: "REALTIME_CONCURRENCY",
              signals: ["中断与主循环共享邮箱"],
              checks: ["检查读清序列是否会覆盖中断写入。"],
            },
          ],
          logicHints: [],
          obligations: [],
        },
      ],
      warnings: [],
    }
    EmbeddedReviewRuntime.remember("concurrency-range", preparation)
    EmbeddedReviewRuntime.next("concurrency-range", { action: "start", packet: 0 })
    EmbeddedReviewRuntime.next("concurrency-range", {
      action: "submit",
      packet: 1,
      submission: {
        standardFindings: [],
        logicFindings: [
          {
            category: "REALTIME_CONCURRENCY",
            severity: "P1",
            path: "host.c",
            line: 1,
            trigger: "中断生产者能在消费者读清序列中写入同一邮箱。",
            pathEvidence: [
              "host.c:1 中断生产者置位 pending",
              "main.c:1 消费者先读取邮箱",
              "main.c:2-3 消费者随后清空 code 和 pending",
            ],
            causalChain: ["main.c:1 读取旧事件", "host.c:1 中断写入新事件", "main.c:2-3 清空新事件的通知"],
            impact: "新错误事件被静默丢弃，错误恢复无法执行。",
            protectionCounterevidence: "证据包中没有锁、关中断或原子交换保护该读清窗口。",
          },
        ],
        obligationReviews: [],
        unverifiedRisks: [],
        nonBlockingFindings: [],
      },
    })
    const sealed = EmbeddedReviewRuntime.seal("concurrency-range", "{}")
    expect(sealed?.verdict).toBe("FAIL")
    expect(sealed?.logic).toMatchObject([
      {
        path: "main.c",
        line: 3,
      },
    ])
    expect(sealed?.logic[0]?.pathEvidence).toContain("main.c:3 消费者随后清空 code 和 pending")
    expect(sealed?.logic[0]?.pathEvidence.some((value) => value.startsWith("main.c:2-3"))).toBe(false)
  })
})

describe("确定性逻辑分类", () => {
  test.each([
    ["CONTROL_CONTRACT", "timer_set_us(timeout_ms);"],
    ["MEMORY_SECURITY", "memcpy(dst, src, packet_len);"],
    ["REALTIME_CONCURRENCY", "void uart_isr(void) { mutex_lock(&lock); }"],
    ["RESOURCE_LIFECYCLE", "handle = device_open(); return ERROR;"],
    ["UPDATE_PERSISTENCE", "flash_write(slot, image, image_len);"],
  ] as const)("%s 可由代码特征稳定选择", (category, source) => {
    const profiles = logicProfiles({ source })
    expect(profiles.length).toBeLessThanOrEqual(2)
    expect(profiles.map((profile) => profile.category)).toContain(category)
  })

  test.each([
    [
      "派生计数边界矛盾",
      "range->blockCount = nlb + 1U;\nif (range->startLba > (capacity - nlb)) return ERROR;",
      "CONTROL_CONTRACT",
    ],
    ["地址低位对齐矛盾", "if ((cmd->PRP2[1] & 0xFFFU) != 0U) return ERROR;", "MEMORY_SECURITY"],
    ["请求槽所有权矛盾", "slot = ReserveReqSlot();\nPutToSliceReqQ(slot);\nReleaseReqBatch(1U);", "RESOURCE_LIFECYCLE"],
    ["持久化提交顺序矛盾", "EraseBbtSlot(oldSlot);\nWriteBbtHeader(newSlot);", "UPDATE_PERSISTENCE"],
  ])("%s 只生成待反证的窄问题", (_name, source, category) => {
    expect(logicHints(source).some((hint) => hint.startsWith(`${category}:`))).toBe(true)
  })

  test("修复后的配对代码不生成对应逻辑提示", () => {
    expect(
      logicHints("range->blockCount = nlb + 1U;\nif (range->startLba > (capacity - range->blockCount)) return ERROR;"),
    ).toHaveLength(0)
    expect(logicHints("if ((cmd->PRP2[0] & 0xFFFU) != 0U) return ERROR;")).toHaveLength(0)
    expect(logicHints("ReserveReqBatch(4U);\nPutToSliceReqQ(slot);")).toHaveLength(0)
    expect(logicHints("WriteBbtHeader(newSlot);\nEraseBbtSlot(oldSlot);")).toHaveLength(0)
  })

  test("同一 hunk 跨两个函数时保留一个主函数并附带其他变更函数", () => {
    const source = [
      "static int consume(int value)",
      "{",
      "    return value + 1;",
      "}",
      "",
      "int produce(int value)",
      "{",
      "    return consume(value);",
      "}",
      "",
    ].join("\n")
    const rows = source.trimEnd().split("\n")
    const file: ChangeFile = {
      path: "flow.c",
      status: "modified",
      before: "",
      after: source,
      patch: "",
      hunks: [
        {
          header: "@@ -0,0 +1,9 @@",
          oldStart: 0,
          oldCount: 0,
          nextStart: 1,
          nextCount: 9,
          lines: rows.map((line) => `+${line}`),
          changed: rows.map((_, index) => ({ next: index + 1 })),
        },
      ],
      changedLines: rows.map((_, index) => index + 1),
    }
    const result = packets([file], [])
    expect(result.map((packet) => packet.function?.name)).toEqual(["consume"])
    expect(result[0]?.relatedFunctions).toMatchObject([
      {
        path: "flow.c",
        name: "produce",
        relation: "changed",
      },
    ])
    expect(result[0]?.changedLines).toEqual([1, 2, 3, 4, 6, 7, 8, 9])
  })
})

function changedFile(file: string, after: string): ChangeFile {
  const lines = after.split(/\r?\n/)
  if (lines.at(-1) === "") lines.pop()
  return {
    path: file,
    status: "modified",
    before: "",
    after,
    patch: "",
    hunks: [],
    changedLines: lines.map((_, index) => index + 1),
  }
}

function empty() {
  return {
    standardFindings: [],
    logicFindings: [],
    obligationReviews: [],
    unverifiedRisks: [],
    nonBlockingFindings: [],
  }
}

function pack(id: string, check: RulePack["rules"][number]["check"] = "mechanical"): RulePack {
  return {
    schemaVersion: 1,
    version: "1.0.0",
    status: "PUBLISHED",
    contentHash: "a".repeat(64),
    sourceHash: "b".repeat(64),
    rules: [
      {
        id,
        revision: 1,
        level: "MUST",
        title: id,
        description: id,
        appliesTo: [],
        languages: ["c", "cpp"],
        exceptions: [],
        check,
        contentHash: "c".repeat(64),
      },
    ],
  }
}

async function git(root: string, args: string[]) {
  return (await Process.text(["git", ...args], { cwd: root })).text
}
