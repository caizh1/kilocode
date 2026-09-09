import * as vscode from "vscode"
import { APPEARANCE_ACTIONS, resolveAppearance, validAppearance, type Appearance } from "./shared/appearance"

const bindings = new Map<vscode.Webview, vscode.Disposable>()
const listeners = new Set<() => void>()
let pending = Promise.resolve()
let saving = false

export function readAppearance(): Appearance {
  const config = vscode.workspace.getConfiguration("chipmate.v2.appearance")
  return resolveAppearance({ skin: config.get("skin"), motion: config.get("motion") })
}

export function disposeAppearance() {
  for (const item of [...bindings.values()]) item.dispose()
}

// 两项外观作为同一次保存处理；写入失败时恢复原值，再发布有效快照。
export function saveAppearance(appearance: Appearance): Promise<void> {
  if (!validAppearance(appearance)) return Promise.reject(new Error("无效的界面皮肤设置。"))
  const operation = pending.then(async () => {
    const config = vscode.workspace.getConfiguration("chipmate.v2.appearance")
    const previous = {
      skin: config.inspect("skin")?.globalValue,
      motion: config.inspect("motion")?.globalValue,
    }
    saving = true
    try {
      await config.update("skin", appearance.skin, vscode.ConfigurationTarget.Global)
      await config.update("motion", appearance.motion, vscode.ConfigurationTarget.Global)
    } catch (error) {
      const restored = await Promise.allSettled([
        config.update("skin", previous.skin, vscode.ConfigurationTarget.Global),
        config.update("motion", previous.motion, vscode.ConfigurationTarget.Global),
      ])
      if (restored.some((result) => result.status === "rejected")) {
        throw new Error("外观保存失败，且未能完整恢复原设置。请检查 VS Code 设置文件是否可写。", { cause: error })
      }
      throw error
    } finally {
      saving = false
      for (const notify of listeners) notify()
    }
  })
  pending = operation.catch((error) => console.warn("[ChipMate New] 外观设置保存失败：", error))
  return operation
}

export function bindAppearance(
  owner: Pick<vscode.WebviewPanel, "webview" | "onDidDispose"> & {
    visible?: boolean
    onDidChangeViewState?: vscode.Event<vscode.WebviewPanelOnDidChangeViewStateEvent>
    onDidChangeVisibility?: vscode.Event<void>
  },
) {
  const webview = owner.webview
  bindings.get(webview)?.dispose()
  let disposed = false
  const post = (message: unknown) => {
    if (disposed) return
    void webview.postMessage(message).then(undefined, (error) => {
      if (!disposed) console.warn("[ChipMate New] 外观消息发送失败：", error)
    })
  }
  const visibility = () => {
    if (owner.visible !== undefined) post({ type: "appearanceVisibility", visible: owner.visible })
  }
  const notify = () => {
    post({ type: "appearanceChanged", appearance: readAppearance() })
    visibility()
  }
  const visible = owner.onDidChangeViewState?.(visibility) ?? owner.onDidChangeVisibility?.(visibility)
  listeners.add(notify)
  const changes = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!saving && event.affectsConfiguration("chipmate.v2.appearance")) notify()
  })
  const messages = webview.onDidReceiveMessage((message: { type?: string; action?: string }) => {
    if (!message || typeof message !== "object") return
    if (message.type === "requestAppearance") notify()
    if (message.type !== "appearanceAction" || !message.action) return
    if (!Object.hasOwn(APPEARANCE_ACTIONS, message.action)) return
    const command = APPEARANCE_ACTIONS[message.action as keyof typeof APPEARANCE_ACTIONS]
    const view = "viewType" in owner ? owner.viewType : "sidebar"
    void vscode.commands
      .executeCommand(command, ...(message.action === "new" ? [view] : []))
      .then(undefined, (error) => {
        console.warn("[ChipMate New] 皮肤导航执行失败：", error)
        void vscode.window.showErrorMessage("无法打开所选 ChipMate 页面，请重试。")
      })
  })
  const closed = owner.onDidDispose(() => binding.dispose())
  const binding = new vscode.Disposable(() => {
    disposed = true
    listeners.delete(notify)
    changes.dispose()
    visible?.dispose()
    messages.dispose()
    closed.dispose()
    bindings.delete(webview)
  })
  bindings.set(webview, binding)
  return binding
}
