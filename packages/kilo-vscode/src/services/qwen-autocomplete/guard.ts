import path from "node:path"
import * as vscode from "vscode"
import { FileIgnoreController } from "../autocomplete/shims/FileIgnoreController"

const guards = new Map<string, Promise<FileIgnoreController>>()

export type QwenSafetyGuard = (document: vscode.TextDocument) => boolean | Promise<boolean>

export async function shouldGuardQwenDocument(document: vscode.TextDocument): Promise<boolean> {
  if (document.uri.scheme !== "file") return true
  const root = workspaceRootFor(document)
  if (!root) return true
  const controller = await controllerFor(root)
  return !controller.validateAccess(document.uri.fsPath)
}

export function resetQwenSafetyGuardsForTests(): void {
  for (const guard of guards.values()) {
    void guard.then((controller) => controller.dispose())
  }
  guards.clear()
}

async function controllerFor(root: string): Promise<FileIgnoreController> {
  const cached = guards.get(root)
  if (cached) return cached

  const guard = (async () => {
    const controller = new FileIgnoreController(root)
    await controller.initialize()
    return controller
  })()
  guards.set(root, guard)
  return guard
}

function workspaceRootFor(document: vscode.TextDocument): string | undefined {
  const file = path.resolve(document.uri.fsPath)
  const roots = vscode.workspace.workspaceFolders
    ?.map((folder) => path.resolve(folder.uri.fsPath))
    .filter((root) => contains(root, file))
    .sort((a, b) => b.length - a.length)

  return roots?.[0]
}

function contains(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
