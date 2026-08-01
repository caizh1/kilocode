import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  codexEventLog,
  config,
  parseDescriptor,
  parseSse,
  reviewCommand,
  reviewPass,
  snapshotIncluded,
  stageCommand,
} from "../src/runner.js"

describe("ChipMate 自动执行器", () => {
  test("监控模式不要求修复和发布命令", () => {
    const previous = { ...process.env }
    try {
      process.env.CHIPMATE_WORKER_TOKEN = "monitor-worker-token-for-tests-000000000"
      process.env.CHIPMATE_RUNNER_MODE = "monitor"
      delete process.env.CHIPMATE_VERIFY_COMMAND
      delete process.env.CHIPMATE_CODEX_COMMAND
      delete process.env.CHIPMATE_SANDBOX_COMMAND
      delete process.env.CHIPMATE_PACKAGE_COMMAND
      delete process.env.CHIPMATE_PUBLISH_COMMAND
      const value = config()
      assert.equal(value.mode, "monitor")
      assert.deepEqual(value.verify, [])
      assert.deepEqual(value.publish, [])
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key]
      }
      Object.assign(process.env, previous)
    }
  })

  test("影子模式强制配置工作区沙箱", () => {
    const previous = { ...process.env }
    try {
      process.env.CHIPMATE_WORKER_TOKEN = "shadow-worker-token-for-tests-0000000000"
      process.env.CHIPMATE_RUNNER_MODE = "shadow"
      process.env.CHIPMATE_VERIFY_COMMAND = "[\"bun\",\"run\",\"typecheck\"]"
      process.env.CHIPMATE_CODEX_COMMAND = "[\"codex\"]"
      delete process.env.CHIPMATE_SANDBOX_COMMAND
      assert.throws(() => config(), /CHIPMATE_SANDBOX_COMMAND 未配置/)
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key]
      }
      Object.assign(process.env, previous)
    }
  })

  test("默认不设置额外 Token 上限并允许 Codex 自动压缩", () => {
    const previous = { ...process.env }
    try {
      process.env.CHIPMATE_WORKER_TOKEN = "shadow-worker-token-for-tests-0000000000"
      process.env.CHIPMATE_RUNNER_MODE = "shadow"
      process.env.CHIPMATE_VERIFY_COMMAND = "[\"bun\",\"run\",\"typecheck\"]"
      process.env.CHIPMATE_CODEX_COMMAND = "[\"codex\"]"
      process.env.CHIPMATE_SANDBOX_COMMAND = "[\"sandbox\"]"
      process.env.CHIPMATE_MAX_TOKENS = "0"
      assert.equal(config().tokens, null)
      process.env.CHIPMATE_MAX_TOKENS = "250000"
      assert.equal(config().tokens, 250_000)
      process.env.CHIPMATE_MAX_TOKENS = "-1"
      assert.throws(() => config(), /必须是非负整数/)
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key]
      }
      Object.assign(process.env, previous)
    }
  })

  test("工作区快照保留源码并排除构建产物", () => {
    assert.equal(snapshotIncluded("packages/chipmate-extension/src/extension.ts"), true)
    assert.equal(snapshotIncluded("packages/chipmate-extension/tests/unit/update-check.test.ts"), true)
    assert.equal(snapshotIncluded("packages/chipmate-extension/.qa-runtime/output.json"), false)
    assert.equal(snapshotIncluded("packages/chipmate-extension/qa/artifacts/candidate.vsix"), false)
    assert.equal(snapshotIncluded("packages/chipmate-core/dist/cli.js"), false)
  })

  test("只接受明确的 PASS 审查结论", () => {
    assert.equal(reviewPass("VERDICT: PASS\nP0/P1 BLOCKERS:\n无"), true)
    assert.equal(reviewPass("VERDICT: FAIL\nP0/P1 BLOCKERS:\n存在阻塞"), false)
    assert.equal(reviewPass("文字中提到 VERDICT: PASS 但不是独立结论"), false)
  })

  test("独立审查使用可携带自定义 Prompt 的普通 Codex 会话", () => {
    const command = reviewCommand(
      ["bash", "/runner/run-codex-sandboxed.sh"],
      "/worktrees/run-4",
      "/worktrees/run-4/.chipmate/results/review-4-1.txt",
    )
    assert.deepEqual(command, [
      "bash",
      "/runner/run-codex-sandboxed.sh",
      "exec",
      "--ephemeral",
      "--json",
      "-C",
      "/worktrees/run-4",
      "-o",
      "/worktrees/run-4/.chipmate/results/review-4-1.txt",
      "-",
    ])
    assert.equal(command.includes("review"), false)
    assert.equal(command.includes("--uncommitted"), false)
  })

  test("提交修复时排除 Codex 临时结果", () => {
    assert.deepEqual(stageCommand(), [
      "add",
      "-A",
      "--",
      ".",
      ":(exclude).chipmate/results/**",
    ])
  })

  test("解析断行的 SSE 任务事件", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("id: 1\nevent: run."))
        controller.enqueue(encoder.encode("queued\ndata: {\"runId\":7,\"bugId\":3}\n\n"))
        controller.close()
      },
    })
    const events = []
    for await (const event of parseSse(stream)) events.push(event)
    assert.deepEqual(events, [{
      type: "run.queued",
      data: { runId: 7, bugId: 3 },
    }])
  })

  test("只提取 Codex 可公开摘要，不回传推理过程或凭据", () => {
    assert.equal(codexEventLog({
      type: "item.completed",
      item: { type: "reasoning", text: "内部推理内容" },
    }, "diagnosing"), undefined)
    const log = codexEventLog({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "已定位更新状态丢失。token=private-value /Users/archer/Work/project/file.ts",
      },
    }, "fixing")
    assert.equal(log?.message, "Codex 已更新输出摘要")
    assert.equal(log?.summary, "已定位更新状态丢失。token=[已脱敏] [任务工作区]")
  })

  test("展示工作区命令、退出码和脱敏后的多行输出", () => {
    const started = codexEventLog({
      type: "item.started",
      item: {
        type: "command_execution",
        command: "bun test --token private-value",
      },
    }, "testing")
    assert.equal(started?.message, "Codex 正在执行工作区命令")
    assert.equal(started?.detail, "bun test --token [已脱敏]")

    const completed = codexEventLog({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "bun test",
        aggregated_output: "第一项通过\n{\"secret\":\"json-private\"}\npassword=private-value\n第二项失败",
        exit_code: 1,
      },
    }, "testing")
    assert.equal(completed?.level, "warning")
    assert.equal(completed?.message, "工作区命令结束，退出码 1")
    assert.equal(
      completed?.detail,
      "$ bun test\n\n第一项通过\n{\"secret\":\"[已脱敏]\"}\npassword=[已脱敏]\n第二项失败",
    )
  })

  test("执行日志移除私钥、常见访问令牌和 URL 凭据", () => {
    const log = codexEventLog({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "检查输出",
        aggregated_output: [
          "-----BEGIN PRIVATE KEY-----",
          "private-material",
          "-----END PRIVATE KEY-----",
          "ghp_123456789012345678901234567890",
          "https://user:pass@example.invalid/path",
        ].join("\n"),
        exit_code: 0,
      },
    }, "testing")
    assert.equal(log?.detail?.includes("private-material"), false)
    assert.equal(log?.detail?.includes("ghp_123456789012345678901234567890"), false)
    assert.equal(log?.detail?.includes("user:pass"), false)
  })

  test("本轮完成日志包含 Codex 用量但不包含推理正文", () => {
    const log = codexEventLog({
      type: "turn.completed",
      usage: { input_tokens: 1200, cached_input_tokens: 100, output_tokens: 300 },
    }, "fixing")
    assert.equal(log?.message, "Codex 已完成本轮处理 · 1,500 Token")
    assert.equal(log?.detail, undefined)
  })

  test("产物契约强制双平台和统一版本", () => {
    const value = parseDescriptor({
      version: "1.0.11",
      artifacts: [
        { path: "/tmp/chipmate-1.0.11-win32-x64-baseline.vsix", platform: "win32-x64-baseline" },
        { path: "/tmp/chipmate-1.0.11-linux-x64-baseline.vsix", platform: "linux-x64-baseline" },
      ],
    })
    assert.equal(value.version, "1.0.11")
    assert.throws(
      () => parseDescriptor({
        version: "1.0.11",
        artifacts: [{ path: "/tmp/chipmate.vsix", platform: "win32-x64-baseline" }],
      }),
      /必须恰好包含/,
    )
  })
})
