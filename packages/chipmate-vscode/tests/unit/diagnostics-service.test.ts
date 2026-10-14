import { test, expect, afterEach } from "bun:test"
import * as vscode from "vscode"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DiagnosticsService } from "../../src/services/diagnostics/service"
import { initializeDiagnostics } from "../../src/services/diagnostics/record"
import type { DiagnosticResponse, DiagnosticRequest } from "../../src/shared/diagnostics"
import type { ChipMateConnectionService } from "../../src/services/cli-backend"
const configuration = vscode.workspace.getConfiguration
const workspace = vscode.workspace as unknown as { getConfiguration: typeof configuration }
afterEach(() => {
  workspace.getConfiguration = configuration
})

async function fixture(options: { lost?: boolean; mismatch?: boolean; unsupported?: boolean; pause?: boolean } = {}) {
  let uploaded = 0
  let credential = "test-diagnostic-access"
  let secretChanged: ((event: { key: string }) => void) | undefined
  let markReading: (() => void) | undefined
  const reading = new Promise<void>((resolve) => {
    markReading = resolve
  })
  let receipt: { id: string; sha256: string; size: number; status: string } | undefined
  let resume: (() => void) | undefined
  const paused = new Promise<void>((resolve) => {
    resume = resolve
  })
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/v1/capabilities")
        return Response.json({ diagnostics: { enabled: !options.unsupported, schemaVersion: 1 } })
      if (url.pathname === "/indexing/status") {
        markReading!()
        if (options.pause) await paused
        return Response.json({ pipelines: { documents: { diagnosticRunId: "run-1" } } })
      }
      if (url.pathname === "/indexing/documents/diagnostics/run-1")
        return Response.json({
          diagnostics: Array.from({ length: 12 }, () => ({ message: "ENOENT", category: "extractor-runtime" })),
        })
      if (url.pathname === "/api/v1/diagnostics/bundles" && request.method === "POST") {
        const body = await request.arrayBuffer()
        uploaded++
        expect(request.headers.get("authorization")).toBe("Bearer test-diagnostic-access")
        expect(createHash("sha256").update(Buffer.from(body)).digest("hex")).toBe(
          request.headers.get("x-content-sha256"),
        )
        receipt = {
          id: request.headers.get("idempotency-key")!,
          size: body.byteLength,
          sha256: options.mismatch ? "0".repeat(64) : request.headers.get("x-content-sha256")!,
          status: "submitted",
        }
        return Response.json(options.lost ? { message: "提交后响应失败" } : receipt, {
          status: options.lost ? 503 : 201,
        })
      }
      if (url.pathname.startsWith("/api/v1/diagnostics/bundles/"))
        return Response.json(receipt ?? {}, { status: receipt ? 200 : 404 })
      return Response.json({}, { status: 404 })
    },
  })
  const base = server.url.origin
  workspace.getConfiguration = (() => ({
    get: (_key: string, fallback: unknown) => fallback,
    inspect: () => ({ globalValue: base }),
  })) as typeof configuration
  const root = await mkdtemp(join(tmpdir(), "chipmate-diagnostics-service-"))
  const context = {
    globalStorageUri: { fsPath: root },
    extension: { packageJSON: { version: "1.2.19" } },
    subscriptions: [],
    secrets: {
      get: async (key: string) =>
        key.endsWith("active-origin")
          ? base
          : JSON.stringify({
              accessToken: credential,
              refreshToken: "test-refresh",
              accessExpiresAt: Date.now() + 3600000,
              refreshExpiresAt: Date.now() + 86400000,
              user: { name: "测试用户" },
            }),
      store: async () => {},
      delete: async () => {},
      onDidChange: (callback: (event: { key: string }) => void) => {
        secretChanged = callback
        return { dispose() {} }
      },
    },
  } as unknown as vscode.ExtensionContext
  initializeDiagnostics(context)
  const connection = {
    getServerConfig: () => ({ baseUrl: base, password: "test-cli" }),
    getConnectionState: () => "connected",
  } as unknown as ChipMateConnectionService
  const service = new DiagnosticsService(context, connection)
  const messages: DiagnosticResponse[] = []
  const surface = { directory: "/repo", post: (message: DiagnosticResponse) => messages.push(message) }
  const start: DiagnosticRequest = {
    type: "diagnostics.start",
    options: { requestId: "测试任务", mode: "submit", hours: 24, description: "诊断验收", includeSession: false },
  }
  return {
    service,
    reading,
    changeCredential: (value: string) => {
      credential = value
      secretChanged?.({ key: "chipmate.v2.marketplace.ldap.test" })
    },
    messages,
    surface,
    start,
    resume: () => resume!(),
    uploaded: () => uploaded,
    async close() {
      service.dispose()
      context.subscriptions.forEach((item) => item.dispose())
      server.stop(true)
      await rm(root, { recursive: true, force: true })
    },
  }
}

test("正式消息入口到真实 HTTP 上传及收据；响应丢失只查询原编号，不重复上传", async () => {
  const f = await fixture({ lost: true })
  try {
    await f.service.handle(f.start, f.surface)
    const states = f.messages.filter((message) => message.type === "diagnostics.state").map((message) => message.state)
    expect(states.map((state) => state.phase)).toEqual([
      "collecting",
      "packaging",
      "login",
      "uploading",
      "verifying",
      "submitted",
    ])
    expect(f.uploaded()).toBe(1)
    expect(states.at(-1)?.id).toBeDefined()
  } finally {
    await f.close()
  }
})

test("收据不匹配和旧服务端不能显示成功，完整包仍可保存", async () => {
  for (const options of [{ mismatch: true }, { unsupported: true }]) {
    const f = await fixture(options)
    try {
      await f.service.handle(f.start, f.surface)
      const last = f.messages.at(-1)
      expect(last?.type).toBe("diagnostics.state")
      if (last?.type === "diagnostics.state") {
        expect(last.state.phase).toBe("failed")
        expect(last.state.canSave).toBe(true)
      }
    } finally {
      await f.close()
    }
  }
})

test("收集中重复点击复用原任务；取消不会推进上传", async () => {
  const f = await fixture({ pause: true })
  try {
    const running = f.service.handle(f.start, f.surface)
    await f.reading
    await f.service.handle({ ...f.start, options: { ...f.start.options, requestId: "重复任务" } }, f.surface)
    const latest = f.messages.at(-1)
    expect(latest?.type === "diagnostics.state" && latest.state.requestId).toBe("测试任务")
    await f.service.handle({ type: "diagnostics.cancel", requestId: "测试任务" }, f.surface)
    f.resume()
    await running
    expect(f.uploaded()).toBe(0)
    const last = f.messages.at(-1)
    expect(last?.type === "diagnostics.state" && last.state.phase).toBe("cancelled")
  } finally {
    f.resume()
    await f.close()
  }
})

test("正常凭据通知不取消任务，真实账号变化终止旧任务", async () => {
  for (const changed of [false, true]) {
    const f = await fixture({ pause: true })
    try {
      const running = f.service.handle(f.start, f.surface)
      await f.reading
      f.changeCredential(changed ? "another-account-access" : "test-diagnostic-access")
      await Promise.resolve()
      f.resume()
      await running
      const last = f.messages.at(-1)
      expect(last?.type === "diagnostics.state" && last.state.phase).toBe(changed ? "cancelled" : "submitted")
      expect(f.uploaded()).toBe(changed ? 0 : 1)
    } finally {
      f.resume()
      await f.close()
    }
  }
})
