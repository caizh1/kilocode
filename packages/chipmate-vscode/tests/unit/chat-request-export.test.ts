import { expect, test } from "bun:test"
import * as vscode from "vscode"
import { mkdtemp, rm, readFile, writeFile, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Log from "@opencode-ai/core/util/log"
import { RequestTrace } from "../../../opencode/src/chipmate/provider/request-diagnostics"
import { initializeDiagnostics } from "../../src/services/diagnostics/record"
import { DiagnosticsService } from "../../src/services/diagnostics/service"
import type { DiagnosticResponse } from "../../src/shared/diagnostics"
import type { ChipMateConnectionService } from "../../src/services/cli-backend"

test("聊天传输日志经现有保存入口导出，工作树关联正确且完整错误链不会泄露正文和凭据", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-chat-export-"))
  const target = join(root, "诊断.zip")
  const directory = join(root, "另一个工作树")
  const uri = (path: string): vscode.Uri =>
    ({ fsPath: path, path, with: (value: { path: string }) => uri(value.path) }) as vscode.Uri
  const window = vscode.window as unknown as { showSaveDialog: typeof vscode.window.showSaveDialog }
  const storage = vscode.workspace.fs as unknown as {
    writeFile: typeof vscode.workspace.fs.writeFile
    rename: typeof vscode.workspace.fs.rename
  }
  const original = {
    save: window.showSaveDialog,
    write: storage.writeFile,
    rename: storage.rename,
    salt: process.env.CHIPMATE_DIAGNOSTICS_SALT,
  }
  window.showSaveDialog = async () => uri(target)
  storage.writeFile = async (file, data) => writeFile(file.fsPath, data)
  storage.rename = async (before, after) => rename(before.fsPath, after.fsPath)
  const context = {
    globalStorageUri: { fsPath: root },
    extension: { packageJSON: { version: "测试版本" } },
    subscriptions: [],
    secrets: { onDidChange: () => ({ dispose() {} }) },
  } as unknown as vscode.ExtensionContext
  const store = initializeDiagnostics(context)
  process.env.CHIPMATE_DIAGNOSTICS_SALT = store.context.salt
  const detach = Log.onDiagnostic((level, event, data) => {
    if (data.service === "provider.chat") store.append(String(event), data, level, "cli.provider.chat")
  })
  const service = new DiagnosticsService(context, {
    getServerConfig: () => undefined,
    getConnectionState: () => "disconnected",
  } as unknown as ChipMateConnectionService)
  try {
    const trace = new RequestTrace({
      operationId: "逻辑聊天请求",
      sessionID: "子会话",
      rootSessionID: "主会话",
      parentSessionID: "父会话",
      providerID: "测试提供商",
      modelID: "测试模型",
      directory,
      attempt: 2,
      limit: 3,
    })
    const failure = new TypeError("fetch failed", {
      cause: new AggregateError(
        [
          Object.assign(new Error("连接失败 qa-arbitrary-secret"), {
            code: "ECONNREFUSED",
            errno: -61,
            syscall: "connect",
            address: "192.0.2.10",
            port: 8443,
          }),
          Object.assign(new Error("另一地址超时"), { code: "ETIMEDOUT" }),
        ],
        "多个地址失败",
      ),
    })
    await expect(
      trace.transport(
        async () => {
          throw failure
        },
        "https://private.example.test:8443/v1/chat/completions",
        { headers: { Authorization: "Bearer qa-arbitrary-secret" }, body: "聊天正文哨兵" },
        [{ stage: "连接与首字节", budget: 1500, enabled: true }],
      ),
    ).rejects.toBe(failure)
    trace.close()
    // 同一 CLI 的其他工作树记录不得混入本次导出。
    const other = new RequestTrace({
      sessionID: "另一工作树会话",
      providerID: "测试",
      modelID: "测试",
      directory: root,
    })
    other.close()
    await store.flush()
    const messages: DiagnosticResponse[] = []
    await service.handle(
      {
        type: "diagnostics.start",
        options: {
          requestId: "导出聊天请求",
          mode: "export",
          hours: 1,
          description: "聊天失败阶段和底层异常链验收",
          includeSession: false,
        },
      },
      { directory, post: (message) => messages.push(message) },
    )
    expect(messages.at(-1)).toMatchObject({ type: "diagnostics.state", state: { phase: "saved" } })
    expect((await readFile(target)).length).toBeGreaterThan(0)
    const zip = Bun.spawnSync(["unzip", "-p", target, "日志/cli.provider.chat.jsonl"])
    expect(zip.exitCode).toBe(0)
    const text = zip.stdout.toString()
    for (const item of [
      "逻辑聊天请求",
      trace.requestId,
      "连接与响应头",
      "ECONNREFUSED",
      "ETIMEDOUT",
      '"errno":-61',
      '"syscall":"connect"',
      '"port":8443',
      '"budget":1500',
      "父会话",
      "主会话",
    ])
      expect(text).toContain(item)
    for (const item of ["聊天正文哨兵", "qa-arbitrary-secret", "private.example.test", "192.0.2.10", "另一工作树会话"])
      expect(text).not.toContain(item)
  } finally {
    detach()
    if (original.salt === undefined) delete process.env.CHIPMATE_DIAGNOSTICS_SALT
    else process.env.CHIPMATE_DIAGNOSTICS_SALT = original.salt
    window.showSaveDialog = original.save
    storage.writeFile = original.write
    storage.rename = original.rename
    service.dispose()
    context.subscriptions.forEach((item) => item.dispose())
    await rm(root, { recursive: true, force: true })
  }
})
