import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { registerPatentRadar } from "../../src/patent-radar/register"
import { runPatentCenterAction } from "../../src/services/patent-center"
import type { PatentRadarScope } from "../../src/patent-radar/client"

const original = {
  register: vscode.commands.registerCommand,
  execute: vscode.commands.executeCommand,
  info: vscode.window.showInformationMessage,
  warning: vscode.window.showWarningMessage,
  folders: vscode.workspace.onDidChangeWorkspaceFolders,
}
afterEach(() => {
  vscode.commands.registerCommand = original.register
  vscode.commands.executeCommand = original.execute
  vscode.window.showInformationMessage = original.info
  vscode.window.showWarningMessage = original.warning
  vscode.workspace.onDidChangeWorkspaceFolders = original.folders
})

function setup(scope: PatentRadarScope, accepted = true, large = false) {
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const requests: Array<{ action: string; input: unknown }> = []
  const confirmed: string[] = []
  const run = { schemaVersion: 2, id: "run_原模块", workspace: "/repo", status: "CANCELLED", scope, candidates: [], sources: [], assessments: [] }
  const connection = {
    getClientAsync: async () => ({ patentRadar: {
      list: async () => ({ data: [] }),
      get: async (input: unknown) => { requests.push({ action: "get", input }); return { data: run } },
      previewScope: async (input: unknown) => {
        requests.push({ action: "preview", input })
        return { data: { scope, estimatedModelCalls: 2, coverage: { coreFiles: ["src/环形队列.c"], dependencyFiles: [], documentFiles: [], selectedEvidence: 1, workspaceEvidence: 5, workspacePercent: 0.2, warnings: [], requiresConfirmation: large } } }
      },
      scan: async (input: unknown) => { requests.push({ action: "scan", input }); return { data: { ...run, id: "run_重新开始", status: "SCANNING" } } },
    } }),
  }
  vscode.commands.registerCommand = (command, callback) => { commands.set(command, callback); return { dispose() {} } }
  vscode.commands.executeCommand = async <T>(command: string, ...args: unknown[]) => await commands.get(command)?.(...args) as T
  vscode.window.showInformationMessage = (async (message: string) => { confirmed.push(message); return accepted ? "扫描一次" : undefined }) as typeof vscode.window.showInformationMessage
  vscode.window.showWarningMessage = (async () => accepted ? "继续完整模块闭包" : undefined) as typeof vscode.window.showWarningMessage
  vscode.workspace.onDidChangeWorkspaceFolders = () => ({ dispose() {} })
  const context = { subscriptions: [], extensionUri: vscode.Uri.file("/测试扩展"), globalState: { update: async () => {}, get: (_key: string, fallback: unknown) => fallback } } as unknown as vscode.ExtensionContext
  registerPatentRadar(context, connection as never)
  const restart = () => runPatentCenterAction("scan", { providerID: "qa", modelID: "qa-model" }, "run_原模块")
  return { requests, confirmed, restart, dispose: () => context.subscriptions.forEach((value) => value.dispose()) }
}

describe("QA-038 从正式专利中心动作经过命令和客户端保留原扫描范围", () => {
  const scope = { kind: "module" as const, moduleId: "module_队列", corePaths: ["src/环形队列.c"], expansionPolicy: "quality-first" as const }
  it("取消后重启模块经过原运行回读和范围确认，不扩大为工作区", async () => {
    const state = setup(scope)
    try {
      const result = await state.restart()
      expect(result.run?.id).toBe("run_重新开始")
      expect(state.requests.map((value) => value.action)).toEqual(["get", "preview", "scan"])
      expect(state.requests[0]?.input).toEqual({ directory: "/repo", runID: "run_原模块" })
      expect(state.requests[1]?.input).toEqual({ directory: "/repo", body: scope })
      expect(state.requests[2]?.input).toMatchObject({ directory: "/repo", scope, confirmLargeClosure: false, analysisModel: { providerID: "qa", modelID: "qa-model" } })
      expect(state.confirmed).toHaveLength(1)
    } finally { state.dispose() }
  })
  it("拒绝重新确认范围时不启动扫描", async () => {
    const state = setup(scope, false)
    try {
      expect(await state.restart()).toEqual({ run: null, cancelled: true })
      expect(state.requests.map((value) => value.action)).toEqual(["get", "preview"])
    } finally { state.dispose() }
  })
  it("原范围已经是工作区时正常保留工作区", async () => {
    const state = setup({ kind: "workspace" })
    try {
      expect((await state.restart()).run?.id).toBe("run_重新开始")
      expect(state.requests.map((value) => value.action)).toEqual(["get", "scan"])
      expect(state.requests[1]?.input).toMatchObject({ scope: { kind: "workspace" } })
    } finally { state.dispose() }
  })
  it("大模块重新核对后保留完整模块和明确批准标识", async () => {
    const state = setup(scope, true, true)
    try {
      expect((await state.restart()).run?.id).toBe("run_重新开始")
      expect(state.requests[2]?.input).toMatchObject({ scope, confirmLargeClosure: true })
    } finally { state.dispose() }
  })
})
