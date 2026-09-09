import * as assert from "assert"
import { randomUUID } from "node:crypto"

import * as vscode from "vscode"

import type { ChipMateProvider } from "../ChipMateProvider"
import type { ChipMateConnectionService } from "../services/cli-backend/connection-service"
import type { SessionSurfaceCoordinator } from "../services/session-surface/coordinator"

const VIEW_TYPE = "chipmate.v2.TabPanel"

function mainEditorTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(VIEW_TYPE))
}

function tabSummary(): string {
  return JSON.stringify(
    vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.map((tab) => {
        const input = tab.input
        return {
          label: tab.label,
          active: tab.isActive,
          inputType: typeof input === "object" && input !== null ? input.constructor.name : typeof input,
          viewType: input instanceof vscode.TabInputWebview ? input.viewType : undefined,
        }
      }),
    ),
  )
}

async function waitUntil(check: () => boolean, message: string, timeout = 15_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(message)
}

async function closeMainEditorTabs(): Promise<void> {
  const deadline = Date.now() + 15_000
  let emptySince = 0
  while (Date.now() < deadline) {
    const tabs = mainEditorTabs()
    if (tabs.length === 0) {
      if (!emptySince) emptySince = Date.now()
      if (Date.now() - emptySince >= 2500) return
    } else {
      emptySince = 0
      for (const tab of tabs) {
        if (!mainEditorTabs().includes(tab)) continue
        await vscode.window.tabGroups.close(tab, true).then(undefined, () => undefined)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(`主编辑区标签关闭后仍反复出现，当前标签：${tabSummary()}`)
}

type SessionSurfaceTestApi = {
  connectionService: ChipMateConnectionService
  provider: ChipMateProvider
  sessionSurfaces: SessionSurfaceCoordinator
}

async function waitForConnection(api: SessionSurfaceTestApi, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (api.connectionService.getConnectionState() !== "connected" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.strictEqual(api.connectionService.getConnectionState(), "connected", "本地 CLI 服务连接超时")
}

function sessionSurfaceTestApi(): SessionSurfaceTestApi {
  const extension = vscode.extensions.getExtension("chipmate.chipmate")
  assert.ok(extension, "测试宿主中未找到 ChipMate 扩展")
  const exported = extension.exports as { __sessionSurfaceTest?: SessionSurfaceTestApi }
  assert.ok(exported.__sessionSurfaceTest, "测试宿主未提供会话界面测试接口")
  return exported.__sessionSurfaceTest
}

async function waitForSessionStatus(
  api: SessionSurfaceTestApi,
  sessionID: string,
  expected: "busy" | "idle",
  timeout = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await api.connectionService.getClient().session.status({ directory: "/Users/archer/Work/kilocode" })
    const status = result.data?.[sessionID]?.type ?? "idle"
    if (status === expected) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.fail(`会话状态未在限定时间内变为 ${expected}`)
}

async function createStreamingSession(api: SessionSurfaceTestApi): Promise<string> {
  await vscode.commands.executeCommand("chipmate.v2.SidebarProvider.focus")
  await api.provider.waitForReady()
  await waitForConnection(api)
  const directory = "/Users/archer/Work/kilocode"
  const client = api.connectionService.getClient()
  const result = await client.session.create({ directory }, { throwOnError: true })
  api.provider.setSessionDirectory(result.data.id, directory)
  api.provider.registerSession(result.data, true)
  const key = { kind: "session" as const, id: result.data.id }
  await api.provider.loadMessages(result.data.id)
  api.provider.postMessage({ type: "sessionSurface.select", key })
  api.sessionSurfaces.bindSurface("sidebar", key)
  const draftRevision = await api.sessionSurfaces.loadDraftRevision(key)
  await api.sessionSurfaces.waitForSurfaceReady("sidebar", key, draftRevision)
  const claimed = api.sessionSurfaces.claimSidebar(key)
  await api.sessionSurfaces.waitForSurfaceReady("sidebar", key, draftRevision, claimed.token?.epoch)
  return result.data.id
}

async function startStreaming(api: SessionSurfaceTestApi, sessionID: string): Promise<void> {
  await api.connectionService.getClient().session.promptAsync(
    {
      sessionID,
      directory: "/Users/archer/Work/kilocode",
      agent: "build",
      model: { providerID: "surface-local", modelID: "surface-stream" },
      parts: [{ type: "text", text: "请只回复本机流式切换测试文本，不要使用工具。" }],
    },
    { throwOnError: true },
  )
  await waitForSessionStatus(api, sessionID, "busy")
}

suite("主编辑区真实扩展宿主切换", () => {
  suiteSetup(async function () {
    this.timeout(30_000)
    const extension = vscode.extensions.getExtension("chipmate.chipmate")
    assert.ok(extension, "测试宿主中未找到 ChipMate 扩展")
    await extension.activate()
    await closeMainEditorTabs()
  })

  teardown(async function () {
    this.timeout(20_000)
    await closeMainEditorTabs()
  })

  test("没有对话时可以直接打开主编辑区并收回侧栏", async function () {
    this.timeout(60_000)
    const draftID = `main-pending:host-empty-${randomUUID()}`

    await vscode.commands.executeCommand("chipmate.v2.openInTab", { draftID })
    await waitUntil(() => mainEditorTabs().length === 1, `空白对话未打开主编辑区，当前标签：${tabSummary()}`)
    assert.strictEqual(mainEditorTabs()[0]?.isActive, true, "新建的主编辑区标签未激活")

    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")
    await vscode.commands.executeCommand("chipmate.v2.returnToSidebar")
    await waitUntil(() => mainEditorTabs().length === 0, "空白对话未成功收回侧栏")
    await waitForConnection(sessionSurfaceTestApi())
  })

  test("同一空白对话并发重复打开时只创建一个主编辑区", async function () {
    this.timeout(30_000)
    const draftID = `main-pending:host-duplicate-${randomUUID()}`

    await Promise.all(
      Array.from({ length: 8 }, () => vscode.commands.executeCommand("chipmate.v2.openInTab", { draftID })),
    )
    console.log("[主编辑区宿主测试] 并发打开后的标签", tabSummary())
    await waitUntil(() => mainEditorTabs().length === 1, "并发打开后没有得到唯一主编辑区标签")
    assert.strictEqual(mainEditorTabs().length, 1, "同一对话产生了重复主编辑区标签")
  })

  test("原生关闭主编辑区后可以用同一对话重新打开", async function () {
    this.timeout(30_000)
    const draftID = `main-pending:host-reopen-${randomUUID()}`

    await vscode.commands.executeCommand("chipmate.v2.openInTab", { draftID })
    console.log("[主编辑区宿主测试] 原生关闭并重开后的标签", tabSummary())
    await waitUntil(() => mainEditorTabs().length === 1, "首次打开主编辑区失败")
    await vscode.window.tabGroups.close(mainEditorTabs()[0]!, true)
    await waitUntil(() => mainEditorTabs().length === 0, "原生关闭主编辑区失败")

    await vscode.commands.executeCommand("chipmate.v2.openInTab", { draftID })
    await waitUntil(() => mainEditorTabs().length === 1, "原生关闭后无法重新打开同一对话")
  })

  test("连续十次打开和收回不会残留重复标签", async function () {
    this.timeout(90_000)
    const draftID = `main-pending:host-loop-${randomUUID()}`

    for (let index = 0; index < 10; index++) {
      await vscode.commands.executeCommand("chipmate.v2.openInTab", { draftID })
      await waitUntil(() => mainEditorTabs().length === 1, `第 ${index + 1} 次打开失败`)
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")
      await vscode.commands.executeCommand("chipmate.v2.returnToSidebar")
      console.log(`[主编辑区宿主测试] 第 ${index + 1} 次收回后的标签`, tabSummary())
      await waitUntil(() => mainEditorTabs().length === 0, `第 ${index + 1} 次收回失败`)
    }
  })

  test("收回侧栏后立即再次打开同一空白对话", async function () {
    this.timeout(45_000)
    const draftID = `main-pending:host-immediate-reopen-${randomUUID()}`

    await vscode.commands.executeCommand("chipmate.v2.openInTab", { draftID })
    await waitUntil(() => mainEditorTabs().length === 1, "首次打开主编辑区失败")
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")
    await vscode.commands.executeCommand("chipmate.v2.returnToSidebar")
    await waitUntil(() => mainEditorTabs().length === 0, "首次收回侧栏失败")

    const startedAt = Date.now()
    await vscode.commands.executeCommand("chipmate.v2.openInTab", { draftID })
    console.log(`[主编辑区宿主测试] 立即二次打开耗时 ${Date.now() - startedAt} 毫秒，当前标签 ${tabSummary()}`)
    await waitUntil(() => mainEditorTabs().length === 1, "收回侧栏后立即再次打开失败")
  })

  test("两个不同空白对话可以各自打开且只收回当前对话", async function () {
    this.timeout(45_000)
    const first = `main-pending:host-first-${randomUUID()}`
    const second = `main-pending:host-second-${randomUUID()}`

    await vscode.commands.executeCommand("chipmate.v2.openInTab", { draftID: first })
    await vscode.commands.executeCommand("chipmate.v2.openInTab", { draftID: second })
    console.log("[主编辑区宿主测试] 两个不同对话打开后的标签", tabSummary())
    await waitUntil(() => mainEditorTabs().length === 2, "不同对话未分别创建主编辑区标签")

    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")
    await vscode.commands.executeCommand("chipmate.v2.returnToSidebar")
    await waitUntil(() => mainEditorTabs().length === 1, "收回当前对话时错误影响了其他主编辑区标签")
  })

  test("模型输出过程中可以从主编辑区收回侧栏并保留完整回复", async function () {
    this.timeout(60_000)
    const api = sessionSurfaceTestApi()
    const sessionID = await createStreamingSession(api)

    await vscode.commands.executeCommand("chipmate.v2.openInTab", { sessionID })
    console.log("[主编辑区宿主测试] 流式输出前打开主区后的标签", tabSummary())
    await waitUntil(() => mainEditorTabs().length === 1, "真实会话未打开主编辑区")
    await startStreaming(api, sessionID)
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")
    await vscode.commands.executeCommand("chipmate.v2.returnToSidebar")
    await waitUntil(() => mainEditorTabs().length === 0, "模型输出过程中无法收回侧栏")
    await waitForSessionStatus(api, sessionID, "idle")

    const messages = await api.connectionService
      .getClient()
      .session.messages({ sessionID, directory: "/Users/archer/Work/kilocode" }, { throwOnError: true })
    assert.match(JSON.stringify(messages.data), /本机.*流式.*输出.*切换/s, "切换后模型回复不完整")
  })

  test("模型输出过程中可以从侧栏打开主编辑区并继续完成回复", async function () {
    this.timeout(60_000)
    const api = sessionSurfaceTestApi()
    const sessionID = await createStreamingSession(api)

    await startStreaming(api, sessionID)
    await vscode.commands.executeCommand("chipmate.v2.openInTab", { sessionID })
    await waitUntil(() => mainEditorTabs().length === 1, "模型输出过程中无法打开主编辑区")
    await waitForSessionStatus(api, sessionID, "idle")

    const messages = await api.connectionService
      .getClient()
      .session.messages({ sessionID, directory: "/Users/archer/Work/kilocode" }, { throwOnError: true })
    assert.match(JSON.stringify(messages.data), /本机.*流式.*输出.*切换/s, "主编辑区没有保留完整模型回复")
  })
})
