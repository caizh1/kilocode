import { test, expect } from "bun:test"
import { mkdtemp, rm, readFile, readdir, symlink, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DiagnosticStore, snapshot, retention, RETENTION } from "@opencode-ai/core/chipmate/diagnostics/store"
import { sanitize, redactText, anonymous } from "@opencode-ai/core/chipmate/diagnostics/redact"
import { buildBundle, verifyBundle } from "../../src/services/diagnostics/bundle"

test("嵌套凭据、跨行认证、私人路径和默认正文在记录阶段即被排除", async () => {
  const clean = JSON.stringify(
    sanitize({
      apiKey: "密钥甲",
      config: { password: "密钥乙" },
      details: [
        {
          headers: { cookie: "密钥丙" },
          message: 'password="跨行\n密钥丁" authorization: Bearer test-secret',
          file: "C:\\Users\\Alice\\Project\\a.pdf",
        },
      ],
      prompt: "业务正文",
      message: "ECONNRESET HTTP 502",
    }),
  )
  for (const value of ["密钥甲", "密钥乙", "密钥丙", "密钥丁", "test-secret", "Alice", "Project", "业务正文"])
    expect(clean).not.toContain(value)
  expect(clean).toContain("ECONNRESET HTTP 502")
  expect(clean).toContain(".pdf")
  expect(redactText("https://example.test/api?token=test-token")).not.toContain("test-token")
})

test("十二类故障固定样本持久化后可按时间和工作区读取，跨 Profile 不共享", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-diagnostics-"))
  try {
    const store = new DiagnosticStore({ root, source: "extension", workspace: "/workspace/甲", salt: "profile-A" })
    const samples = [
      "CLI ENOENT",
      "CLI SIGSEGV",
      "ECONNREFUSED",
      "embedding dimension mismatch",
      "LanceDB ABI mismatch",
      "pdftotext executable not found",
      "PDF password required",
      "HTTP 429",
      "compaction exceeded budget",
      "Webview unhandled rejection",
      "update SHA-256 mismatch",
      "runtime download failed",
    ]
    for (const message of samples)
      store.append(message, { password: "不可落盘", prompt: "不应收集", statusCode: 500 }, "ERROR")
    await store.flush()
    const text = (await Promise.all((await readdir(root)).map((name) => readFile(join(root, name), "utf8")))).join("")
    expect(text).not.toContain("不可落盘")
    expect(text).not.toContain("不应收集")
    const read = (salt: string, directory: string) =>
      snapshot(root, anonymous(directory, salt), 0, Date.now() + 1000, new AbortController().signal)
    expect((await read("profile-A", "/workspace/甲")).records.map((record) => record.event)).toEqual(samples)
    expect((await read("profile-B", "/workspace/甲")).records).toHaveLength(0)
    expect((await read("profile-A", "/workspace/乙")).records).toHaveLength(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("取消不生成完整包，符号链接来源被拒绝；正常包可重新校验", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-diagnostics-"))
  try {
    const input = {
      root: join(root, "bundles"),
      salt: "test",
      version: "1.0.0",
      platform: "darwin-arm64",
      from: new Date().toISOString(),
      to: new Date().toISOString(),
      description: "",
      environment: {},
      records: [],
      sources: [],
    }
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(buildBundle(input, cancelled.signal)).rejects.toThrow()
    const bundle = await buildBundle(input, new AbortController().signal)
    await verifyBundle(bundle)
    await symlink(input.root, join(root, "link"))
    await expect(buildBundle({ ...input, root: join(root, "link") }, new AbortController().signal)).rejects.toThrow(
      "链接",
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("多写入者共同轮转预算且记录不串行丢失", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-diagnostics-concurrent-"))
  try {
    const first = new DiagnosticStore({ root, source: "extension", workspace: "/repo", salt: "same-profile" })
    const second = new DiagnosticStore({ root, source: "cli", workspace: "/repo", salt: "same-profile" })
    for (let index = 0; index < 50; index++) {
      first.append(`扩展事件 ${index}`)
      second.append(`CLI 事件 ${index}`)
    }
    const results = await Promise.all([first.flush(), second.flush()])
    expect(results.every((result) => result.dropped === 0)).toBe(true)
    const captured = await snapshot(root, first.workspaceId, 0, Date.now() + 1000, new AbortController().signal)
    expect(captured.records).toHaveLength(100)
    expect(new Set(captured.records.map((record) => record.runId)).size).toBe(2)
    expect((await readdir(root)).includes(".write-lock")).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("真实主日志器通过旁路落盘；移除旁路后新事件不会伪造为已采集", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-diagnostics-log-"))
  const log = await import("@opencode-ai/core/util/log")
  const store = new DiagnosticStore({ root, source: "cli", workspace: "/repo", salt: "logger-test" })
  const detach = log.onDiagnostic((level, message, data) => {
    if (level !== "DEBUG") store.append(String(message), data, level)
  })
  try {
    const logger = log.create({ service: "diagnostics-test" })
    logger.error("CLI 启动错误", { code: "ENOENT", operationId: "启动测试" })
    await store.flush()
    detach()
    logger.warn("未接入旁路的反例事件")
    const captured = await snapshot(root, store.workspaceId, 0, Date.now() + 1000, new AbortController().signal)
    expect(captured.records).toHaveLength(1)
    expect(captured.records[0]?.event).toBe("CLI 启动错误")
    expect(captured.records.some((record) => record.event === "未接入旁路的反例事件")).toBe(false)
  } finally {
    detach()
    await rm(root, { recursive: true, force: true })
  }
})

test("stderr 跨数据块凭据不会落盘，原生堆栈保留且业务正文被排除", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-diagnostics-stderr-"))
  try {
    const { DiagnosticStderr } = await import("../../src/services/diagnostics/stderr")
    const store = new DiagnosticStore({ root, source: "cli.stderr", workspace: "/repo", salt: "stderr-test" })
    const stderr = new DiagnosticStderr("崩溃测试", (event, data, level, source) =>
      store.append(event, data, level, source),
    )
    stderr.append(Buffer.from("ERROR authorization: Bea"))
    stderr.append(Buffer.from("rer secret-across-chunks\n    at run (/home/private/work/file.ts:4:2)\n"))
    stderr.append(Buffer.from('ERROR {"content":"业务正文", "password":"another-secret"}\n'))
    stderr.append(Buffer.from('ERROR password="开头\nERROR 不可泄漏的续行"\n'))
    stderr.append(Buffer.from("普通聊天正文不应收集\n"))
    stderr.finish()
    await store.flush()
    const files = (await readdir(root)).filter((file) => file.endsWith(".jsonl"))
    const text = (await Promise.all(files.map((file) => readFile(join(root, file), "utf8")))).join("")
    expect(text).not.toContain("secret-across-chunks")
    expect(text).not.toContain("业务正文")
    expect(text).not.toContain("another-secret")
    expect(text).not.toContain("普通聊天")
    expect(text).not.toContain("不可泄漏的续行")
    expect(text).not.toContain("/home/private")
    expect(text).toContain("at run")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("过期记录轮转后保留可观察的缺失计数", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-diagnostics-retention-"))
  try {
    const store = new DiagnosticStore({ root, source: "extension", workspace: "/repo", salt: "retention" })
    store.append("过期事件")
    await store.flush()
    const expired = new Date(Date.now() - RETENTION - 1000)
    for (const name of await readdir(root))
      if (name.endsWith(".jsonl")) await utimes(join(root, name), expired, expired)
    store.append("新事件")
    await store.flush()
    const result = await snapshot(root, store.workspaceId, 0, Date.now() + 1000, new AbortController().signal)
    expect(result.records.map((record) => record.event)).toEqual(["新事件"])
    expect(await retention(root)).toMatchObject({ files: 1 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
