import * as vscode from "vscode"
import type { KiloProvider } from "../../KiloProvider"
import type { AgentManagerProvider } from "../../agent-manager/AgentManagerProvider"
import { getEditorContext } from "./editor-utils"
import { createPrompt } from "./support-prompt"

function inline(value: string): string {
  const width = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length)) + 1
  const fence = "`".repeat(width)
  return `${fence}${value}${fence}`
}

async function references(resource?: vscode.Uri, selected?: vscode.Uri[]): Promise<string[]> {
  const resources = selected?.length ? selected : resource ? [resource] : []
  const settled = await Promise.allSettled(
    resources.map(async (uri) => {
      if (!vscode.workspace.getWorkspaceFolder(uri)) return
      const stat = await vscode.workspace.fs.stat(uri)
      const path = vscode.workspace.asRelativePath(uri).replaceAll("\\", "/").replace(/\/+$/, "")
      const folder = (stat.type & vscode.FileType.Directory) !== 0
      if (!path) return folder ? "./" : undefined
      return folder ? `${path}/` : path
    }),
  )
  const seen = new Set<string>()
  const paths: string[] = []
  for (const result of settled) {
    if (result.status !== "fulfilled" || !result.value || seen.has(result.value)) continue
    seen.add(result.value)
    paths.push(result.value)
  }
  return paths
}

export function registerCodeActions(
  context: vscode.ExtensionContext,
  provider: KiloProvider,
  agentManager?: AgentManagerProvider,
  activeTabProvider?: () => KiloProvider | undefined,
): void {
  const target = () => (agentManager?.isActive() ? agentManager : (activeTabProvider?.() ?? provider))
  const reveal = async () => {
    await vscode.commands.executeCommand("chipmate.v2.SidebarProvider.focus")
    await provider.waitForReady()
  }
  // Only the sidebar `provider` branch used to await readiness before
  // posting. An editor-tab webview or the Agent Manager panel can still be
  // opening/restoring when one of these commands fires, and postMessage()
  // does not queue — it silently drops the message if the webview hasn't
  // installed its listener yet. Wait for the selected target's own
  // readiness too before posting to it.
  //
  // AgentManagerProvider.waitForReady() resolves `false` instead of hanging
  // forever when the selected panel closes or is replaced while waiting.
  // Propagate that so callers skip posting instead of delivering the
  // message to whatever panel happens to be active by the time the wait
  // settles.
  const revealTarget = async (view: KiloProvider | AgentManagerProvider): Promise<boolean> => {
    if (view === provider) {
      await reveal()
      return true
    }
    if (view === agentManager) {
      return agentManager.waitForReady()
    }
    await view.waitForReady()
    return true
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("chipmate.v2.explainCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("EXPLAIN", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        selectedText: ctx.selectedText,
        userInput: "",
      })
      await reveal()
      provider.postMessage({ type: "triggerTask", text: prompt })
    }),

    vscode.commands.registerCommand("chipmate.v2.fixCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("FIX", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        selectedText: ctx.selectedText,
        diagnostics: ctx.diagnostics,
        userInput: "",
      })
      await reveal()
      provider.postMessage({ type: "triggerTask", text: prompt })
    }),

    vscode.commands.registerCommand("chipmate.v2.improveCode", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("IMPROVE", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        selectedText: ctx.selectedText,
        userInput: "",
      })
      await reveal()
      provider.postMessage({ type: "triggerTask", text: prompt })
    }),

    vscode.commands.registerCommand("chipmate.v2.addToContext", async () => {
      const ctx = getEditorContext()
      if (!ctx) return
      const prompt = createPrompt("ADD_TO_CONTEXT", {
        filePath: ctx.filePath,
        startLine: String(ctx.startLine),
        endLine: String(ctx.endLine),
        selectedText: ctx.selectedText,
      })
      const view = target()
      if (!(await revealTarget(view))) return
      view.postMessage({ type: "appendChatBoxMessage", text: prompt })
    }),

    vscode.commands.registerCommand(
      "chipmate.v2.addExplorerPathsToQa",
      async (resource?: vscode.Uri, selected?: vscode.Uri[]) => {
        const paths = await references(resource, selected)
        if (paths.length === 0) {
          void vscode.window.showInformationMessage("未找到可引用的工作区文件或文件夹。")
          return
        }
        const view = target()
        if (!(await revealTarget(view))) return
        view.postMessage({ type: "appendChatBoxMessage", text: paths.map(inline).join("\n") })
      },
    ),

    vscode.commands.registerCommand("chipmate.v2.focusChatInput", async () => {
      const view = target()
      if (!(await revealTarget(view))) return
      view.postMessage({ type: "action", action: "focusInput" })
    }),

    // Command Palette only — no keybinding. A keybinding would need to
    // route through VS Code's keybinding-to-focused-webview forwarding,
    // which doesn't reliably reach a webview whose own input already has
    // focus; invoking straight from the palette sidesteps that path
    // entirely, the same way terminalAddToContext etc. do. Toggles: the
    // webview closes the search bar itself if it's already open.
    vscode.commands.registerCommand("chipmate.v2.toggleChatSearch", async () => {
      const view = target()
      if (!(await revealTarget(view))) return
      view.postMessage({ type: "action", action: "focusSearch" })
    }),
  )
}
