import { describe, expect, it, mock } from "bun:test"
import { restoreMainEditorAfterSettings, SettingsPanelReturnState } from "../../src/settings-panel-return"
import type { SessionSurfaceKey, SessionSurfaceState } from "../../src/shared/session-surface"

describe("SettingsPanelReturnState", () => {
  it("活动 Settings 关闭后恢复最后一个有效来源", async () => {
    const restoreFirst = mock(() => undefined)
    const restoreLast = mock(() => undefined)
    const state = new SettingsPanelReturnState()
    state.setTarget({ id: "main:first", restore: restoreFirst })
    state.setTarget({ id: "main:last", restore: restoreLast })
    state.setActive(true)

    await state.consume(false)?.restore()

    expect(restoreFirst).not.toHaveBeenCalled()
    expect(restoreLast).toHaveBeenCalledTimes(1)
    expect(state.consume(false)).toBeUndefined()
  })

  it("后台关闭 Settings 不抢占当前代码编辑器", () => {
    const state = new SettingsPanelReturnState()
    state.setTarget({ id: "main:a", restore: () => undefined })
    state.setActive(false)

    expect(state.consume(false)).toBeUndefined()
  })

  it("页面关闭请求即使先失焦也会恢复来源", () => {
    const state = new SettingsPanelReturnState()
    const target = { id: "main:a", restore: () => undefined }
    state.setTarget(target)
    state.setActive(true)
    state.requestClose()
    state.setActive(false)

    expect(state.consume(false)).toBe(target)
  })

  it("扩展退出时不恢复来源面板", () => {
    const state = new SettingsPanelReturnState()
    state.setTarget({ id: "main:a", restore: () => undefined })
    state.setActive(true)
    state.requestClose()

    expect(state.consume(true)).toBeUndefined()
  })

  it("无主编辑区来源时清除旧返回目标", () => {
    const state = new SettingsPanelReturnState()
    state.setTarget({ id: "main:old", restore: () => undefined })
    state.setTarget(undefined)
    state.setActive(true)

    expect(state.consume(false)).toBeUndefined()
  })

  it("连续一百次打开关闭都只恢复当次来源", async () => {
    const restore = mock(() => undefined)
    const state = new SettingsPanelReturnState()

    for (let index = 0; index < 100; index++) {
      state.setTarget({ id: `main:${index}`, restore })
      state.setActive(true)
      const target = state.consume(false)
      expect(target?.id).toBe(`main:${index}`)
      await target?.restore()
      expect(state.consume(false)).toBeUndefined()
    }

    expect(restore).toHaveBeenCalledTimes(100)
  })
})

describe("restoreMainEditorAfterSettings", () => {
  const key: SessionSurfaceKey = { kind: "session", id: "session-a" }
  const surface = (ownerSurfaceId = "main:a"): SessionSurfaceState => ({
    key,
    phase: "main",
    ownerSurfaceId,
    token: { generation: "generation-a", surfaceId: ownerSurfaceId, epoch: 7 },
    draftRevision: 12,
    mode: "deepseek-harness",
    taskId: "task-a",
    dshLease: true,
  })

  it("恢复原编辑组并重发既有会话投影，不改变 owner", async () => {
    const reveal = mock(() => undefined)
    const postMessage = mock(() => undefined)
    const bindSurface = mock(() => undefined)
    const panel = { viewColumn: 3 as import("vscode").ViewColumn, reveal }
    const provider = {
      getPinnedSurfaceKey: () => key,
      waitForReady: async () => undefined,
      postMessage,
    }
    const sessionSurfaces = {
      stateForSurface: () => surface(),
      bindSurface,
    }

    await restoreMainEditorAfterSettings({
      panel,
      provider,
      key,
      ownerSurfaceId: "main:a",
      tabPanels: new Map([[panel, provider]]),
      sessionSurfaces,
    })

    expect(reveal).toHaveBeenCalledWith(3, false)
    expect(postMessage).toHaveBeenNthCalledWith(1, { type: "navigate", view: "newTask" })
    expect(postMessage).toHaveBeenNthCalledWith(2, { type: "sessionSurface.select", key })
    expect(bindSurface).toHaveBeenCalledWith("main:a", key)
    expect(sessionSurfaces.stateForSurface()).toEqual(surface())
  })

  it("来源面板已关闭或 owner 已变化时不恢复", async () => {
    const reveal = mock(() => undefined)
    const postMessage = mock(() => undefined)
    const bindSurface = mock(() => undefined)
    const panel = { viewColumn: 2 as import("vscode").ViewColumn, reveal }
    const provider = {
      getPinnedSurfaceKey: () => key,
      waitForReady: async () => undefined,
      postMessage,
    }
    const sessionSurfaces = {
      stateForSurface: () => surface("sidebar"),
      bindSurface,
    }

    await restoreMainEditorAfterSettings({
      panel,
      provider,
      key,
      ownerSurfaceId: "main:a",
      tabPanels: new Map(),
      sessionSurfaces,
    })
    await restoreMainEditorAfterSettings({
      panel,
      provider,
      key,
      ownerSurfaceId: "main:a",
      tabPanels: new Map([[panel, provider]]),
      sessionSurfaces,
    })

    expect(reveal).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()
    expect(bindSurface).not.toHaveBeenCalled()
  })

  it("等待来源面板就绪期间 owner 变化时停止恢复", async () => {
    const reveal = mock(() => undefined)
    const postMessage = mock(() => undefined)
    const bindSurface = mock(() => undefined)
    const panel = { viewColumn: 2 as import("vscode").ViewColumn, reveal }
    let ownerSurfaceId = "main:a"
    const provider = {
      getPinnedSurfaceKey: () => key,
      waitForReady: async () => {
        ownerSurfaceId = "main:b"
      },
      postMessage,
    }
    const sessionSurfaces = {
      stateForSurface: () => surface(ownerSurfaceId),
      bindSurface,
    }

    await restoreMainEditorAfterSettings({
      panel,
      provider,
      key,
      ownerSurfaceId: "main:a",
      tabPanels: new Map([[panel, provider]]),
      sessionSurfaces,
    })

    expect(reveal).toHaveBeenCalledWith(2, false)
    expect(postMessage).not.toHaveBeenCalled()
    expect(bindSurface).not.toHaveBeenCalled()
  })
})
