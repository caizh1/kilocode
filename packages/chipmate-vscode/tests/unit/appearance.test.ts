import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as vscode from "vscode"
import { bindAppearance, disposeAppearance, readAppearance, saveAppearance } from "../../src/appearance"
import { DEFAULT_APPEARANCE, resolveAppearance, validAppearance } from "../../src/shared/appearance"
import { buildAutocompleteSettingMessages } from "../../webview-ui/src/context/autocomplete-settings"

describe("未来风外观保存与多页面同步", () => {
  const state = new Map<string, unknown>()
  const listeners = new Set<(event: vscode.ConfigurationChangeEvent) => void>()
  let fail = false
  let configure: ReturnType<typeof spyOn>
  let subscribe: ReturnType<typeof spyOn>
  const changed = () => {
    for (const listener of listeners) listener({ affectsConfiguration: () => true } as vscode.ConfigurationChangeEvent)
  }
  beforeEach(() => {
    state.clear()
    fail = false
    configure = spyOn(vscode.workspace, "getConfiguration").mockImplementation(
      () =>
        ({
          get: (key: string) => state.get(key),
          inspect: (key: string) => ({ globalValue: state.get(key) }),
          update: async (key: string, value: unknown) => {
            if (fail && key === "motion" && value === "subtle") throw new Error("模拟设置文件写入失败")
            if (value === undefined) state.delete(key)
            else state.set(key, value)
            changed()
          },
        }) as vscode.WorkspaceConfiguration,
    )
    subscribe = spyOn(vscode.workspace, "onDidChangeConfiguration").mockImplementation((listener) => {
      listeners.add(listener)
      return new vscode.Disposable(() => listeners.delete(listener))
    })
  })
  afterEach(() => {
    disposeAppearance()
    configure.mockRestore()
    subscribe.mockRestore()
    listeners.clear()
  })
  function page(viewType = "chipmate.v2.settingsPanel") {
    const messages: unknown[] = []
    let receive: (message: unknown) => void = () => {}
    let close: () => void = () => {}
    const owner = {
      viewType,
      webview: {
        postMessage: async (message: unknown) => {
          messages.push(message)
          return true
        },
        onDidReceiveMessage: (listener: typeof receive) => {
          receive = listener
          return new vscode.Disposable(() => {
            receive = () => {}
          })
        },
      },
      onDidDispose: (listener: typeof close) => {
        close = listener
        return new vscode.Disposable(() => {})
      },
    }
    bindAppearance(owner as unknown as vscode.WebviewPanel)
    return { messages, receive: (message: unknown) => receive(message), close: () => close() }
  }
  it("宿主隐藏和显示页面时发布可见性，关闭后移除监听", () => {
    const messages: unknown[] = []
    let changed: (() => void) | undefined
    const owner = {
      visible: true,
      webview: {
        postMessage: async (value: unknown) => {
          messages.push(value)
          return true
        },
        onDidReceiveMessage: () => new vscode.Disposable(() => {}),
      },
      onDidDispose: () => new vscode.Disposable(() => {}),
      onDidChangeVisibility: (listener: () => void) => {
        changed = listener
        return new vscode.Disposable(() => {
          changed = undefined
        })
      },
    }
    const binding = bindAppearance(owner as unknown as vscode.WebviewView)
    owner.visible = false
    changed!()
    owner.visible = true
    changed!()
    expect(messages).toEqual([
      { type: "appearanceVisibility", visible: false },
      { type: "appearanceVisibility", visible: true },
    ])
    binding.dispose()
    expect(changed).toBeUndefined()
  })
  it("无设置及非法值退回原皮肤，沉浸作为首次默认值", () => {
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
    state.set("skin", "unknown")
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
    expect(resolveAppearance({ skin: "night-city" }).motion).toBe("immersive")
    expect(validAppearance(null)).toBe(false)
    expect(validAppearance({ skin: "night-city", motion: "unknown" })).toBe(false)
  })
  it("从保存入口同步全部页面，只发布完整已保存快照", async () => {
    const first = page()
    const second = page()
    const appearance = { skin: "night-city", motion: "subtle" } as const
    await saveAppearance(appearance)
    const expected = [{ type: "appearanceChanged", appearance }]
    expect(first.messages).toEqual(expected)
    expect(second.messages).toEqual(expected)
    expect(readAppearance()).toEqual(appearance)
  })
  it("写入失败恢复原设置，不能把预览皮肤发布到已打开页面", async () => {
    const current = page()
    fail = true
    await expect(saveAppearance({ skin: "night-city", motion: "subtle" })).rejects.toThrow("模拟设置文件写入失败")
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
    expect(current.messages).toEqual([{ type: "appearanceChanged", appearance: DEFAULT_APPEARANCE }])
    expect(state.size).toBe(0)
  })
  it("新开页面读取最新设置，关闭后不再发送消息并释放配置订阅", async () => {
    await saveAppearance({ skin: "night-city", motion: "off" })
    const current = page()
    current.receive({ type: "requestAppearance" })
    expect(current.messages).toEqual([{ type: "appearanceChanged", appearance: { skin: "night-city", motion: "off" } }])
    current.close()
    await saveAppearance(DEFAULT_APPEARANCE)
    expect(current.messages).toHaveLength(1)
    expect(listeners.size).toBe(0)
  })
  it("外部设置更改同步；畸形消息和任意命令不会被执行", () => {
    const current = page()
    const command = spyOn(vscode.commands, "executeCommand")
    try {
      current.receive(null)
      current.receive({ type: "appearanceAction", action: "__proto__" })
      expect(command).not.toHaveBeenCalled()
      state.set("skin", "night-city")
      changed()
      expect(current.messages).toEqual([
        { type: "appearanceChanged", appearance: { skin: "night-city", motion: "immersive" } },
      ])
    } finally {
      command.mockRestore()
    }
  })
  it("并发保存串行完成，失败后仍可继续保存", async () => {
    fail = true
    const failed = saveAppearance({ skin: "night-city", motion: "subtle" }).catch(() => undefined)
    const saved = saveAppearance({ skin: "night-city", motion: "off" })
    await Promise.all([failed, saved])
    expect(readAppearance()).toEqual({ skin: "night-city", motion: "off" })
  })
  it("导航只给新会话传入来源，不能把来源误用为设置页签", () => {
    const current = page("chipmate.v2.AgentManagerPanel")
    const command = spyOn(vscode.commands, "executeCommand")
    try {
      current.receive({ type: "appearanceAction", action: "settings" })
      expect(command).toHaveBeenLastCalledWith("chipmate.v2.settingsButtonClicked")
      current.receive({ type: "appearanceAction", action: "new" })
      expect(command).toHaveBeenLastCalledWith("chipmate.v2.appearance.new", "chipmate.v2.AgentManagerPanel")
    } finally {
      command.mockRestore()
    }
  })
  it("设置草稿只产生一次独立外观请求，沿用请求标识，不触发模型配置", () => {
    expect(buildAutocompleteSettingMessages({ "appearance.skin": "night-city" }, {}, "保存一")).toEqual([
      { type: "updateAppearance", appearance: { skin: "night-city", motion: "immersive" }, requestId: "保存一" },
    ])
    expect(
      buildAutocompleteSettingMessages({ "appearance.motion": "off" }, { "appearance.skin": "night-city" }, "保存二"),
    ).toEqual([{ type: "updateAppearance", appearance: { skin: "night-city", motion: "off" }, requestId: "保存二" }])
    expect(buildAutocompleteSettingMessages({}, {}, "取消")).toEqual([])
  })
})
