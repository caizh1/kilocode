import { test, expect } from "bun:test"
import * as vscode from "vscode"
import { mkdtemp, rm, readFile, writeFile, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ChipMateProvider } from "../../src/ChipMateProvider"
import { initializeDiagnostics } from "../../src/services/diagnostics/record"
import { DiagnosticsService } from "../../src/services/diagnostics/service"
import type { DiagnosticResponse } from "../../src/shared/diagnostics"
import type { ChipMateConnectionService } from "../../src/services/cli-backend"

test("提供商正式请求处理到正式导出入口保留环境和请求关联", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-provider-export-"))
  const target = join(root, "诊断.zip")
  const uri = (path: string): vscode.Uri =>
    ({ fsPath: path, path, with: (value: { path: string }) => uri(value.path) }) as vscode.Uri
  const window = vscode.window as unknown as { showSaveDialog: typeof vscode.window.showSaveDialog }
  const storage = vscode.workspace.fs as unknown as {
    writeFile: typeof vscode.workspace.fs.writeFile
    rename: typeof vscode.workspace.fs.rename
  }
  const original = { save: window.showSaveDialog, write: storage.writeFile, rename: storage.rename }
  window.showSaveDialog = async () => uri(target)
  storage.writeFile = async (file, data) => writeFile(file.fsPath, data)
  storage.rename = async (before, after) => rename(before.fsPath, after.fsPath)
  const context = {
    globalStorageUri: { fsPath: root },
    extension: { packageJSON: { version: "测试版本" } },
    subscriptions: [],
    secrets: { onDidChange: () => ({ dispose() {} }) },
  } as unknown as vscode.ExtensionContext
  initializeDiagnostics(context)
  const connection = {
    getServerConfig: () => undefined,
    getConnectionState: () => "disconnected",
  } as unknown as ChipMateConnectionService
  const service = new DiagnosticsService(context, connection)
  const responses: Record<string, unknown>[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("响应正文哨兵", { status: 503 }),
  })
  const handler = ChipMateProvider.prototype as unknown as {
    handleFetchCustomProviderModels: (message: Record<string, unknown>) => Promise<void>
  }
  try {
    await handler.handleFetchCustomProviderModels.call(
      {
        getWorkspaceDirectory: () => root,
        postMessage: (message: Record<string, unknown>) => responses.push(message),
      } as unknown as typeof handler,
      {
        type: "fetchCustomProviderModels",
        requestId: "真实处理请求一",
        providerID: "测试提供商",
        baseURL: `${server.url.origin}/v1`,
        apiKey: "qa-only-secret-sentinel",
      },
    )
    expect(responses).toEqual([
      {
        type: "customProviderModelsFetched",
        requestId: "真实处理请求一",
        error: "HTTP 503: 响应正文哨兵",
        auth: false,
      },
    ])
    const messages: DiagnosticResponse[] = []
    await service.handle(
      {
        type: "diagnostics.start",
        options: {
          requestId: "导出请求一",
          mode: "export",
          hours: 1,
          description: "模型请求失败验收",
          includeSession: false,
        },
      },
      { directory: root, post: (message) => messages.push(message) },
    )
    expect(messages.at(-1)).toMatchObject({ type: "diagnostics.state", state: { phase: "saved" } })
    expect((await readFile(target)).byteLength).toBeGreaterThan(0)
    const zip = Bun.spawnSync(["unzip", "-p", target, "日志/provider.models.jsonl"])
    expect(zip.exitCode).toBe(0)
    const text = zip.stdout.toString()
    const records = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(records).toHaveLength(3)
    const failure = records.find((record) => record.data.phase === "失败")
    expect(failure.data).toMatchObject({
      requestId: "真实处理请求一",
      httpStatus: 503,
      budget: 15000,
      remoteName: "local",
      platform: process.platform,
      version: process.versions.node,
    })
    expect(failure.data.elapsed).toBeGreaterThanOrEqual(0)
    expect(text).not.toContain("qa-only-secret-sentinel")
    expect(text).not.toContain("响应正文哨兵")
    expect(text).not.toContain("127.0.0.1")
  } finally {
    window.showSaveDialog = original.save
    storage.writeFile = original.write
    storage.rename = original.rename
    service.dispose()
    context.subscriptions.forEach((item) => item.dispose())
    server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})
